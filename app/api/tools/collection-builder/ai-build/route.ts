import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
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
import { recordToolEvent } from "@/lib/tools/events";
import { aiBuildCommanderDeck } from "@/lib/tools/collection/ai-build";
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
// carries the credit balance. Nothing is saved — the draft goes back to the
// page, where the owner reviews it and saves it as a deck (free).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 120;

const LABEL = "build_collection_deck" as const;

export async function POST(request: Request) {
  const startedAt = Date.now();
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Supabase isn't configured." }, { status: 503 });
  }
  const access = await checkToolAccess(COLLECTION_TOOL_SLUG);
  if (!access) {
    return NextResponse.json({ ok: false, error: "The Collection Deck Builder isn't open to you." }, { status: 404 });
  }
  if (!isDesignAiConfigured()) {
    return NextResponse.json({ ok: false, error: "AI design isn't configured on this deployment." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Pick a commander first." }, { status: 400 });
  }

  // Everything that can refuse without the AI refuses BEFORE the charge.
  const { commanderId, ...choice } = parsed.data;
  const refused = choiceError(choice);
  if (refused) return NextResponse.json({ ok: false, error: refused }, { status: 400 });
  const commander = await getCollectionCard(commanderId);
  if (!commander) {
    return NextResponse.json({ ok: false, error: "That commander isn't in your collection any more." }, { status: 404 });
  }
  const why = commanderReason(commander);
  if (why) {
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
  if (!rate.ok) return rateLimitedResponse(rate);

  if (isBillingEnabled() && isAdminConfigured()) {
    await reconcileUserSpends(createAdminClient(), access.userId);
  }

  const ref = `spend:collection-build:${randomUUID()}`;
  const spend = await spendCredits(1, LABEL, { failClosed: true, ref });
  if (!spend.ok) {
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
  await logAiCall(access.userId, LABEL);

  try {
    const draft = await withAiTimeBudget(startedAt, maxDuration, () =>
      aiBuildCommanderDeck({ commander, collection: pool.cards, choice, bracketCards }),
    );
    // The draft is what the user paid for: settled, so the reconcile sweep
    // leaves the charge alone.
    if (spend.charged) await settleSpend(ref);
    await recordToolEvent({
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
      },
    });
    return NextResponse.json({ ok: true, draft, truncated: pool.truncated, credits: await getFreshCreditBalance() });
  } catch (error) {
    const landed = spend.charged ? await refundCredits(access.userId, 1, LABEL, `refund:${ref}`) : true;
    const detail = error instanceof Error ? error.message : String(error);
    const code: AiFailureKind =
      error instanceof Error && (error.name === "AiOutputError" || error.name === "AI_NoObjectGeneratedError")
        ? "design_unreadable"
        : designFailureKind(classifyProviderError(detail));
    console.error(`[ai:design] collection build failed (${code}): ${detail.replace(/\s+/g, " ").slice(0, 300)}`);
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
