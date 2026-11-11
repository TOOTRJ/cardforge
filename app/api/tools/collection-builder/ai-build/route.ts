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
import { aiBuildCommanderDeck } from "@/lib/tools/collection/ai-build";
import {
  endCollectionAiResult,
  keepCollectionAiResult,
  startCollectionAiResult,
  withCollectionAiRecord,
  type CollectionAiCall,
} from "@/lib/tools/collection/ai-results";
import { AI_MIN_POOL, aiCandidates } from "@/lib/tools/collection/ai-candidates";
import { commanderReason, eligiblePool } from "@/lib/tools/collection/builder";
import { choiceError, draftPlanFor, refusalFloor } from "@/lib/tools/collection/archetypes";
import { getBracketCards } from "@/lib/tools/collection/bracket-cards";
import { COLLECTION_TOOL_SLUG } from "@/lib/tools/collection/limits";
import { getCollectionCard, listBuilderPool } from "@/lib/tools/collection/queries";
import { draftSchema } from "@/lib/tools/collection/schemas";

// ---------------------------------------------------------------------------
// POST /api/tools/collection-builder/ai-build — the Collection Deck
// Builder's "Build with AI" (1 credit, the card ideas route's rules: the
// tool's gate, the AI rate limit, the reconcile, the credit reserved before
// the call and SETTLED once the draft is delivered, refunded if it fails).
// A route, not a server action: it runs up to two minutes and its answer
// carries the credit balance. No deck is saved — the draft goes back to the
// page, where the owner reviews it and saves it as a deck (free) — but what
// became of the request is on record (migration 0198,
// lib/tools/collection/ai-results.ts): `running` before anything is charged,
// the answer KEPT before the credit is settled, `failed` / `refused`
// otherwise. A response that never reaches the page can be asked about
// (GET …/ai-result, by the request id the page sent).
//
// Recorded after the response (never awaited): `ai_build` with what it made
// and the `credits` charged, or `ai_build_failed` with a `reason` code for
// EVERY refusal and failure — and, once a credit was reserved, whether it
// came back (`refunded`).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120;

const LABEL = "build_collection_deck" as const;

/** The draft's choices plus the page's id for this request: its answer can
 *  be asked for again if the response is lost
 *  (lib/tools/collection/ai-results.ts). */
const bodySchema = draftSchema.extend({ requestId: z.string().uuid().nullish().catch(null) });

export function POST(request: Request) {
  // Whatever way the handler leaves, the request's row is given its ending.
  return withCollectionAiRecord("build", (call) => handle(request, call));
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
  /** A build that didn't happen, with why (a code — never a card's name). */
  const failed = (reason: string, props: Record<string, string | number | boolean> = {}) =>
    recordToolEventLater({
      slug: COLLECTION_TOOL_SLUG,
      userId: access.userId,
      event: "ai_build_failed",
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    failed("invalid");
    return NextResponse.json({ ok: false, error: "Pick a commander first." }, { status: 400 });
  }

  // Everything that can refuse without the AI refuses BEFORE the charge.
  const { commanderId, requestId, ...choice } = parsed.data;
  /** What the build was asked for, beside every reason from here on. */
  const asked = {
    ...(choice.deckType ? { deck_type: choice.deckType } : {}),
    ...(choice.bracket ? { bracket: choice.bracket } : {}),
  };

  // On record BEFORE anything is charged (0198): from here a page whose
  // response is lost can ask what became of this request — so "no record"
  // can only mean it never got this far. A request that can't be put on
  // record is refused: one that may be charged always has a row.
  const recorded = await startCollectionAiResult(access.userId, "build", requestId);
  if (recorded === "failed") {
    failed("not_recorded", asked);
    return NextResponse.json(
      { ok: false, error: "The AI build couldn't start right now, and nothing was charged. Try again in a moment." },
      { status: 503 },
    );
  }
  if (recorded === "started") call.requestId = requestId ?? null;
  const refused = choiceError(choice);
  if (refused) {
    failed("invalid_choice", asked);
    return NextResponse.json({ ok: false, error: refused }, { status: 400 });
  }
  const commander = await getCollectionCard(commanderId);
  if (!commander) {
    failed("commander_gone", asked);
    return NextResponse.json({ ok: false, error: "That commander isn't in your collection any more." }, { status: 404 });
  }
  const why = commanderReason(commander);
  if (why) {
    failed("commander_ineligible", asked);
    return NextResponse.json({ ok: false, error: `${commander.name} ${why}.` }, { status: 400 });
  }
  const [pool, bracketCards] = await Promise.all([listBuilderPool(commander), choice.bracket ? getBracketCards() : null]);
  const plan = draftPlanFor(choice, bracketCards);
  // A deck type (or creature type) the collection can't begin to fill is
  // refused before the charge — below HALF its floor; below the floor the
  // build runs and the draft says what's short.
  const eligible = plan ? eligiblePool(commander, pool.cards, plan) : null;
  for (const part of [plan?.type, plan?.tribe]) {
    if (!part || !eligible) continue;
    const have = eligible.filter((card) => part.matches(card)).length;
    if (have < refusalFloor(part.floor)) {
      failed("theme_too_thin", { ...asked, have, floor: part.floor, pool: pool.cards.length });
      return NextResponse.json(
        {
          ok: false,
          code: "THEME_TOO_THIN",
          error: `Your collection has ${have} ${part.label} card${have === 1 ? "" : "s"} in ${commander.name}'s colours — too few to build a ${part.label} deck around (it wants about ${part.floor}). Pick another deck type, or draft one for free.`,
        },
        { status: 400 },
      );
    }
  }
  if (aiCandidates(commander, pool.cards, { plan }).length < AI_MIN_POOL) {
    failed("pool_too_small", { ...asked, pool: pool.cards.length });
    return NextResponse.json(
      {
        ok: false,
        code: "POOL_TOO_SMALL",
        error: `Your collection has too few cards in ${commander.name}'s colours for the AI to choose from (it needs ${AI_MIN_POOL}). The free draft still works.`,
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

  const ref = `spend:collection-build:${randomUUID()}`;
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
    const draft = await withAiTimeBudget(startedAt, maxDuration, () =>
      aiBuildCommanderDeck({ commander, collection: pool.cards, choice, bracketCards }),
    );
    // The draft is what the user paid for: KEPT first (a response that never
    // arrives must not lose it — 0198), then settled, so the reconcile sweep
    // leaves the charge alone. A credit is settled only for an answer that
    // was kept: one that could not be (the write failed twice) leaves its
    // credit unsettled — the sweep returns it — and its row without an
    // answer, so a page that lost this response is told the truth.
    const kept = await keepCollectionAiResult(access.userId, "build", requestId, { draft, truncated: pool.truncated });
    const settled = spend.charged && kept !== "failed";
    if (settled) await settleSpend(ref);
    else if (spend.charged) console.error("[collection] AI build answer not kept: its credit is left unsettled.");
    call.ended = kept !== "failed";
    recordToolEventLater({
      slug: COLLECTION_TOOL_SLUG,
      userId: access.userId,
      event: "ai_build",
      access: access.via,
      props: {
        pool: draft.poolSize,
        total: draft.total,
        ai_picks: draft.picks.filter((p) => p.fromAi).length,
        colours: commander.colorIdentity.join("") || "C",
        ...(choice.deckType ? { deck_type: choice.deckType } : {}),
        ...(choice.tribe ? { tribe: choice.tribe } : {}),
        ...(choice.bracket ? { bracket: choice.bracket } : {}),
        // 0 where nothing is charged (an admin, billing off) or settled.
        credits: settled ? 1 : 0,
        ...(spend.charged && !settled ? { unsettled: true } : {}),
        ms: Date.now() - startedAt,
      },
    });
    return NextResponse.json({ ok: true, draft, truncated: pool.truncated, credits: await getFreshCreditBalance() });
  } catch (error) {
    const landed = spend.charged ? await refundCredits(access.userId, 1, LABEL, `refund:${ref}`) : true;
    await endCollectionAiResult(access.userId, "build", requestId, "failed");
    call.ended = true;
    const detail = error instanceof Error ? error.message : String(error);
    const code: AiFailureKind =
      error instanceof Error && (error.name === "AiOutputError" || error.name === "AI_NoObjectGeneratedError")
        ? "design_unreadable"
        : designFailureKind(classifyProviderError(detail));
    console.error(`[ai:design] collection build failed (${code}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
    failed(code, {
      ...asked,
      pool: pool.cards.length,
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
