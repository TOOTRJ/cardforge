import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import {
  checkAiRateLimit,
  getFreshCreditBalance,
  logAiCall,
  refundCredits,
  settleSpend,
  spendCredits,
} from "@/lib/ai/rate-limit";
import { withAiTimeBudget } from "@/lib/ai/structured-output";
import { aiFailureMessage, classifyProviderError, designFailureKind, type AiFailureKind } from "@/lib/ai/failure";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { reconcileUserSpends } from "@/lib/billing/credit-reconcile";
import { isBillingEnabled } from "@/lib/billing/flags";
import { rateLimitedResponse } from "@/lib/api/responses";
import { checkToolAccess } from "@/lib/tools/queries";
import { recordToolEventLater } from "@/lib/tools/events";
import { COLLECTION_DECK_TYPE_IDS } from "@/lib/tools/collection/archetypes";
import { COLLECTION_TOOL_SLUG } from "@/lib/tools/collection/limits";
import { listCollectionCardsById, listOwnedCommanders, listScoringCards } from "@/lib/tools/collection/queries";
import { SUGGEST_MIN_COMMANDERS, suggestShortlist } from "@/lib/tools/collection/suggest-shortlist";
import { suggestCommanders } from "@/lib/tools/collection/ai-suggest";
import {
  endCollectionAiResult,
  keepCollectionAiResult,
  startCollectionAiResult,
  withCollectionAiRecord,
  type CollectionAiCall,
} from "@/lib/tools/collection/ai-results";

// ---------------------------------------------------------------------------
// POST /api/tools/collection-builder/suggest — "Suggest a commander" (1
// credit; owner decision 2026-11-09, migration 0194's label). The AI build's
// path exactly: the tool's gate, everything that can refuse refusing BEFORE
// the charge (too few commanders, nothing in the wanted colours), the AI
// rate limit, the reconcile, the credit reserved before the call and
// SETTLED once the answer is delivered, refunded if anything fails. Nothing
// is saved: the answer goes back to the page, which keeps it in the browser.
//
// Recorded after the response (never awaited): `ai_suggest` with its counts
// and the `credits` charged, or `ai_suggest_failed` with a `reason` code for
// EVERY refusal and failure — and, once a credit was reserved, whether it
// came back (`refunded`).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120;

const LABEL = "suggest_collection_commander" as const;

const bodySchema = z.object({
  deckType: z.enum(COLLECTION_DECK_TYPE_IDS).nullish(),
  bracket: z.number().int().min(1).max(5).nullish(),
  colours: z.array(z.enum(["W", "U", "B", "R", "G", "C"])).max(6).optional(),
  // The page's id for this request: its answer can be asked for again if
  // the response is lost (lib/tools/collection/ai-results.ts).
  requestId: z.string().uuid().nullish().catch(null),
});

export function POST(request: Request) {
  // Whatever way the handler leaves, the request's row is given its ending.
  return withCollectionAiRecord("suggest", (call) => handle(request, call));
}

async function handle(request: Request, call: CollectionAiCall): Promise<Response> {
  const startedAt = Date.now();
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const access = await checkToolAccess(COLLECTION_TOOL_SLUG);
  if (!access) {
    return NextResponse.json({ ok: false, error: "The Collection Deck Builder isn't open to you." }, { status: 404 });
  }
  call.userId = access.userId;
  /** Suggestions that didn't happen, with why (a code, never a name). */
  const failed = (reason: string, props: Record<string, string | number | boolean> = {}) =>
    recordToolEventLater({
      slug: COLLECTION_TOOL_SLUG,
      userId: access.userId,
      event: "ai_suggest_failed",
      access: access.via,
      props: { reason, ...props },
    });
  if (!isDesignAiConfigured()) {
    failed("ai_unavailable");
    return NextResponse.json({ ok: false, error: "AI design isn't configured on this deployment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    failed("invalid");
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    failed("invalid");
    return NextResponse.json({ ok: false, error: "Those preferences couldn't be read." }, { status: 400 });
  }
  const { requestId, ...preferences } = parsed.data;
  /** What was asked for, beside every reason from here on. */
  const asked = {
    ...(preferences.deckType ? { deck_type: preferences.deckType } : {}),
    ...(preferences.bracket ? { bracket: preferences.bracket } : {}),
    colour_filter: preferences.colours?.length ?? 0,
  };

  // On record BEFORE anything is charged (0198): from here a page whose
  // response is lost can ask what became of this request — so "no record"
  // can only mean it never got this far. A request that can't be put on
  // record is refused: one that may be charged always has a row.
  const recorded = await startCollectionAiResult(access.userId, "suggest", requestId);
  if (recorded === "failed") {
    failed("not_recorded", asked);
    return NextResponse.json(
      { ok: false, error: "The suggestions couldn't start right now, and nothing was charged. Try again in a moment." },
      { status: 503 },
    );
  }
  if (recorded === "started") call.requestId = requestId ?? null;

  // Everything that can refuse without the AI refuses BEFORE the charge.
  let commanders;
  let cards;
  try {
    [commanders, cards] = await Promise.all([listOwnedCommanders({ throwOnError: true }), listScoringCards()]);
  } catch (error) {
    console.error("[collection] suggest read failed:", error instanceof Error ? error.message : error);
    failed("collection_unreadable", asked);
    return NextResponse.json({ ok: false, error: "Your collection couldn't be read just now. Try again." }, { status: 503 });
  }
  const legal = commanders.filter((c) => c.commanderLegal);
  if (legal.length < SUGGEST_MIN_COMMANDERS) {
    failed("too_few_commanders", { ...asked, commanders: legal.length });
    return NextResponse.json(
      {
        ok: false,
        code: "TOO_FEW_COMMANDERS",
        error: `With ${legal.length} commander${legal.length === 1 ? "" : "s"} there's nothing to rank — pick one from your list.`,
      },
      { status: 400 },
    );
  }
  const shortlist = suggestShortlist({ commanders: legal, cards, preferences });
  if (shortlist.length < SUGGEST_MIN_COMMANDERS) {
    failed("too_few_in_colours", { ...asked, commanders: legal.length, shortlist: shortlist.length });
    return NextResponse.json(
      {
        ok: false,
        code: "TOO_FEW_COMMANDERS",
        error: "Fewer than three of your commanders are in those colours — widen the colours, or pick one from your list.",
      },
      { status: 400 },
    );
  }

  const rate = await checkAiRateLimit(access.userId);
  if (!rate.ok) {
    failed("rate_limited", asked);
    return rateLimitedResponse(rate);
  }

  if (isBillingEnabled() && isAdminConfigured()) {
    await reconcileUserSpends(createAdminClient(), access.userId);
  }

  const ref = `spend:collection-suggest:${randomUUID()}`;
  const spend = await spendCredits(1, LABEL, { failClosed: true, ref });
  if (!spend.ok) {
    failed(spend.reason === "insufficient_credits" ? "insufficient_credits" : "credit_check_failed", asked);
    return NextResponse.json(
      {
        ok: false,
        error: spend.message,
        code: spend.reason === "insufficient_credits" ? "INSUFFICIENT_CREDITS" : "CREDIT_CHECK_FAILED",
        balance: Number.isFinite(spend.balance) ? spend.balance : undefined,
      },
      { status: spend.reason === "insufficient_credits" ? 402 : 503 },
    );
  }
  call.charged = true;
  await logAiCall(access.userId, LABEL);

  try {
    const result = await withAiTimeBudget(startedAt, maxDuration, () =>
      suggestCommanders({ shortlist, cards, preferences }),
    );
    // The key cards' pictures (the user's own rows — RLS); a failed read
    // only leaves the names.
    const keyIds = [...new Set(result.suggestions.flatMap((s) => s.keyCards.map((k) => k.id)))];
    const pictures = new Map((await listCollectionCardsById(keyIds)).map((row) => [row.id, row.imageUrl]));
    const suggestions = result.suggestions.map((s) => ({
      ...s,
      keyCards: s.keyCards.map((k) => ({ ...k, imageUrl: pictures.get(k.id) ?? null })),
    }));
    // The answer is what the user paid for: KEPT first (a response that
    // never arrives must not lose it — 0198), then settled, so the reconcile
    // sweep leaves the charge alone.
    const answer = { overview: result.overview, suggestions };
    // Settled only for an answer that was kept (see the AI build's route).
    const kept = await keepCollectionAiResult(access.userId, "suggest", requestId, answer);
    const settled = spend.charged && kept !== "failed";
    if (settled) await settleSpend(ref);
    else if (spend.charged) console.error("[collection] AI suggestions not kept: their credit is left unsettled.");
    call.ended = kept !== "failed";
    recordToolEventLater({
      slug: COLLECTION_TOOL_SLUG,
      userId: access.userId,
      event: "ai_suggest",
      access: access.via,
      props: {
        commanders: legal.length,
        shortlist: shortlist.length,
        suggested: suggestions.length,
        ...(preferences.deckType ? { deck_type: preferences.deckType } : {}),
        ...(preferences.bracket ? { bracket: preferences.bracket } : {}),
        // 0 where nothing is charged (an admin, billing off) or settled.
        credits: settled ? 1 : 0,
        ...(spend.charged && !settled ? { unsettled: true } : {}),
        ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json({
      ok: true,
      result: answer,
      credits: await getFreshCreditBalance(),
    });
  } catch (error) {
    const landed = spend.charged ? await refundCredits(access.userId, 1, LABEL, `refund:${ref}`) : true;
    await endCollectionAiResult(access.userId, "suggest", requestId, "failed");
    call.ended = true;
    const detail = error instanceof Error ? error.message : String(error);
    const code: AiFailureKind =
      error instanceof Error && (error.name === "AiOutputError" || error.name === "AI_NoObjectGeneratedError")
        ? "design_unreadable"
        : designFailureKind(classifyProviderError(detail));
    console.error(`[ai:design] collection suggest failed (${code}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
    failed(code, {
      ...asked,
      commanders: legal.length,
      shortlist: shortlist.length,
      // The credit this call took is back (or still owed: the reconcile
      // sweep returns it) — never counted as spent.
      refunded: spend.charged && landed,
      refund_pending: spend.charged && !landed,
      ms: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: false,
        code,
        error: aiFailureMessage(code, spend.charged && landed ? 1 : 0, spend.charged && !landed),
        credits: await getFreshCreditBalance(),
      },
      { status: 502 },
    );
  }
}
