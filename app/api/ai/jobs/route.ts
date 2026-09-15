import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { isImageRemixConfigured } from "@/lib/ai/image-gen";
import {
  DECK_CARDS_DAILY_LIMIT,
  REMIX_DAILY_LIMIT,
  checkAiRateLimit,
  checkDailyActionLimit,
  checkRandomCardDailyLimit,
  getFreshCreditBalance,
  logAiCall,
} from "@/lib/ai/rate-limit";
import {
  BATCH_CARD_LIMIT,
  batchCardLimit,
  clampBatchSize,
} from "@/lib/ai/generation-limits";
import {
  SET_GENERATION_ENABLED,
  createCardGenerationJob,
  createCardRemixJob,
  createDeckGenerationJob,
  createDeckRemixJob,
  createSetGenerationJob,
} from "@/lib/ai/generation-jobs";
import { FRAME_TEMPLATE_VALUES, RARITY_VALUES } from "@/types/card";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";
import { AI_DECK_FORMATS } from "@/lib/ai/deck-design";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getEntitlements } from "@/lib/billing/entitlements";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs — create an AI batch-generation job and run its PLAN
// step (concept + every card's text in one cohesive batch). The client then
// advances the job one step at a time via /api/ai/jobs/[id]/step.
//
// Card count is clamped to the caller's batch limit (lib/ai/generation-
// limits.ts): the 100-step steppable ceiling when billing is on — credits are
// the only limiter (owner decision, 2026-07-28) — or 3 on billing-off
// deployments where images aren't credit-charged.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

// The 9 standard card types the options dialog offers (matches the legacy
// random-card route; layouts are frame choices, not designs).
const AI_CARD_TYPE_VALUES = [
  "creature",
  "instant",
  "sorcery",
  "artifact",
  "enchantment",
  "land",
  "planeswalker",
  "battle",
  "token",
] as const;

const requestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("set"),
    theme: z.string().trim().max(300).optional(),
    style: z.string().trim().max(200).optional(),
    size: z.coerce.number().optional(),
    set_id: z.string().uuid().optional(),
  }),
  z.object({
    kind: z.literal("deck"),
    theme: z.string().trim().max(300).optional(),
    style: z.string().trim().max(200).optional(),
    size: z.coerce.number().optional(),
    // Optional when deck_id is set (the deck's own format applies).
    format: z.enum(AI_DECK_FORMATS).optional(),
    // Present = generate ADDITIONAL cards into this existing deck.
    deck_id: z.string().uuid().optional(),
    // The wizard's starting point + power level (lib/decks/deck-types.ts).
    deck_type: z.string().trim().max(60).optional(),
    bracket: z.coerce.number().int().min(1).max(5).optional(),
  }),
  z.object({
    kind: z.literal("deck_remix"),
    deck_id: z.string().uuid(),
    style: z.string().trim().min(1, "Pick a style.").max(200),
    theme: z.string().trim().max(300).optional(),
  }),
  // Single card from the creator's AI dialog — same options the legacy
  // /api/ai/random-card route took; the job pipeline replaced its long
  // synchronous request (migration 0061).
  z.object({
    kind: z.literal("card"),
    theme: z.string().trim().max(300).optional(),
    style: z.string().trim().max(200).optional(),
    card_type: z.enum(AI_CARD_TYPE_VALUES).optional(),
    frame: z
      .union([z.literal("random"), z.enum(FRAME_TEMPLATE_VALUES)])
      .optional(),
    rarity: z.enum(RARITY_VALUES).optional(),
    /** Pro: design the card for one of the caller's decks and add it there. */
    deck_id: z.string().uuid().optional(),
  }),
  // AI remix of one card — fork with identical mechanics, new AI identity +
  // restyled art. Replaced the synchronous /api/ai/remix-card request
  // (migration 0062), which had the same infra-cut/double-charge failure
  // mode the single-card route did.
  z.object({
    kind: z.literal("card_remix"),
    card_id: z.string().uuid(),
    style: z.string().trim().min(1, "Pick a style.").max(200),
    theme: z.string().trim().max(300).optional(),
  }),
]);

/**
 * GET /api/ai/jobs — the caller's most recent resumable job (status
 * "generating" with pending steps), or job: null. Powers the provider's
 * auto-resume after a closed tab.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, job: null }, { status: 200 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: true, job: null }, { status: 200 });
  }
  const supabase = await (await import("@/lib/supabase/server")).createClient();
  // Lazy expiry: a job that hasn't progressed in 24h has no live client and
  // never will be resumed usefully — close it instead of surfacing zombie
  // "generating" rows forever. Job rows aren't owner-writable any more
  // (migration 0073), so this runs with the service role, scoped to the
  // caller's own rows by the explicit owner_id filter. Best-effort.
  await (await import("@/lib/supabase/admin")).createAdminClient()
    .from("ai_generation_jobs")
    .update({ status: "cancelled", error: "Expired — no progress for 24 hours." })
    .eq("owner_id", user.id)
    .eq("status", "generating")
    .lt("updated_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
  const { data } = await supabase
    .from("ai_generation_jobs")
    .select("*")
    .eq("status", "generating")
    .order("created_at", { ascending: false })
    .limit(5);
  const resumable = (data ?? []).find((row) => {
    const steps = Array.isArray(row.steps) ? (row.steps as Array<{ status?: string }>) : [];
    // "running" counts too: a step claimed by a tab that has since died
    // stays running until the 5-minute stale window lapses — the resumed
    // client polls it and reclaims once it goes stale (migration 0066).
    return steps.some(
      (step) => step?.status === "pending" || step?.status === "running",
    );
  });
  return NextResponse.json({ ok: true, job: resumable ?? null }, { status: 200 });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Supabase isn't configured." },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Sign in to generate a set." },
      { status: 401 },
    );
  }
  if (!isDesignAiConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI generation isn't configured on this deployment." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid generation request." },
      { status: 400 },
    );
  }

  const limit = await batchCardLimit();
  let size: number;
  if (parsed.data.kind === "card" || parsed.data.kind === "card_remix") {
    size = 1;
  } else if (parsed.data.kind === "deck_remix") {
    // Remix runs min(batch limit, remixable entries) — size the credit
    // pre-check on what will actually run, not the ceiling (with the 100-step
    // limit, sizing on the ceiling would demand 101 credits to remix a
    // 5-card deck). RLS hides decks that aren't the caller's; the count
    // then reads 0 and createDeckRemixJob rejects ownership downstream.
    const supabase = await createClient();
    const { count } = await supabase
      .from("deck_cards")
      .select("*", { count: "exact", head: true })
      .eq("deck_id", parsed.data.deck_id)
      .or("card_id.not.is.null,scryfall_id.not.is.null");
    size = Math.max(1, Math.min(limit, count ?? limit));
  } else {
    // A missing size defaults to the classic 3-card batch, never the
    // ceiling — the UI always sends an explicit size; a bare API call
    // shouldn't get a 100-card (and 101-credit) job by omission.
    size = clampBatchSize(parsed.data.size ?? BATCH_CARD_LIMIT, limit);
  }

  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: rate.message },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  // Per-flow daily image ceilings apply ONLY while billing is off (previews,
  // local): there images aren't credit-charged, so the caps are what protect
  // AI spend. With billing on, credits are the sole limiter (owner decision,
  // 2026-07-28) — a user can generate as many cards as they hold credits.
  const dailyCapsActive = !isBillingEnabled();
  if (parsed.data.kind === "card" && dailyCapsActive) {
    const daily = await checkRandomCardDailyLimit(user.id);
    if (!daily.ok) {
      return NextResponse.json(
        { ok: false, error: daily.message },
        {
          status: 429,
          headers: { "Retry-After": String(daily.retryAfterSeconds) },
        },
      );
    }
  }
  // Card remixes need the image-to-image model on top of the design model.
  if (parsed.data.kind === "card_remix") {
    if (!isImageRemixConfigured()) {
      return NextResponse.json(
        { ok: false, error: "AI remix isn't configured on this deployment." },
        { status: 503 },
      );
    }
    if (dailyCapsActive) {
      const daily = await checkDailyActionLimit(
        user.id,
        "remix_card",
        REMIX_DAILY_LIMIT,
        "AI remix",
      );
      if (!daily.ok) {
        return NextResponse.json(
          { ok: false, error: daily.message },
          {
            status: 429,
            headers: { "Retry-After": String(daily.retryAfterSeconds) },
          },
        );
      }
    }
  }

  // Deck/set batch flows share one per-day image ceiling (admins exempt).
  if (
    dailyCapsActive &&
    (parsed.data.kind === "deck" ||
      parsed.data.kind === "deck_remix" ||
      parsed.data.kind === "set")
  ) {
    const daily = await checkDailyActionLimit(
      user.id,
      "generate_deck_cards",
      DECK_CARDS_DAILY_LIMIT,
      "deck/set card",
    );
    if (!daily.ok) {
      return NextResponse.json(
        { ok: false, error: daily.message },
        {
          status: 429,
          headers: { "Retry-After": String(daily.retryAfterSeconds) },
        },
      );
    }
  }

  // Credits are metered per card as steps complete; pre-check the balance so
  // a user doesn't burn a plan call they can't afford (billing off → ∞).
  // Covers are free (owner decision, 2026-09-15) — only the cards cost
  // credits. A set still charges for its icon, so count that one extra
  // rather than let the job run out one step from the finish line.
  if (isBillingEnabled()) {
    const needed = parsed.data.kind === "set" ? size + 1 : size;
    const entitlements = await getEntitlements();
    if (entitlements.credits < needed) {
      return NextResponse.json(
        {
          ok: false,
          error: `You need ${needed} credit${needed === 1 ? "" : "s"} for this generation — ${size} card${size === 1 ? "" : "s"}${needed > size ? " plus the set icon" : ""} (you have ${entitlements.credits}).`,
          code: "INSUFFICIENT_CREDITS",
          balance: entitlements.credits,
          needed,
        },
        { status: 402 },
      );
    }
  }

  // Live balance for the client's credit displays — planning itself spends
  // nothing (steps do), so this is the pre-generation number the runner can
  // project the job's cost against. Null when billing is off / admin.
  const credits = await getFreshCreditBalance();

  if (parsed.data.kind === "card") {
    // Deck-aware design is a Pro perk (owner decision 2026-09-15 — the one
    // AI feature that is tier-gated; every other AI tool stays open to all).
    if (parsed.data.deck_id) {
      try {
        await requireTier("pro");
      } catch (error) {
        if (error instanceof UpgradeRequiredError) {
          return NextResponse.json(
            {
              ok: false,
              error: "Designing a card for a specific deck is a Pro feature.",
              code: "UPGRADE_REQUIRED",
            },
            { status: 403 },
          );
        }
        throw error;
      }
    }
    const result = await createCardGenerationJob({
      theme: parsed.data.theme,
      style: parsed.data.style,
      cardType: parsed.data.card_type,
      frame: parsed.data.frame,
      rarity: parsed.data.rarity,
      deckId: parsed.data.deck_id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json(
      { ok: true, job: result.job, cardLimit: limit, credits },
      { status: 200 },
    );
  }

  if (parsed.data.kind === "card_remix") {
    const result = await createCardRemixJob({
      cardId: parsed.data.card_id,
      style: parsed.data.style,
      theme: parsed.data.theme,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json(
      { ok: true, job: result.job, cardLimit: limit, credits },
      { status: 200 },
    );
  }

  await logAiCall(user.id, "generate_deck");

  if (parsed.data.kind === "set") {
    if (!SET_GENERATION_ENABLED) {
      return NextResponse.json(
        { ok: false, error: "AI set generation is coming soon." },
        { status: 403 },
      );
    }
    const result = await createSetGenerationJob({
      theme: parsed.data.theme ?? "",
      style: parsed.data.style,
      size,
      setId: parsed.data.set_id,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json(
      { ok: true, job: result.job, setSlug: result.setSlug, cardLimit: limit, credits },
      { status: 200 },
    );
  }

  if (parsed.data.kind === "deck") {
    if (!parsed.data.format && !parsed.data.deck_id) {
      return NextResponse.json({ ok: false, error: "Pick a format." }, { status: 400 });
    }
    const result = await createDeckGenerationJob({
      theme: parsed.data.theme ?? "",
      style: parsed.data.style,
      format: parsed.data.format ?? "commander",
      size,
      deckId: parsed.data.deck_id,
      deckType: parsed.data.deck_type,
      bracket: parsed.data.bracket,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
    }
    return NextResponse.json(
      { ok: true, job: result.job, deckSlug: result.deckSlug, cardLimit: limit, credits },
      { status: 200 },
    );
  }

  const result = await createDeckRemixJob({
    deckId: parsed.data.deck_id,
    style: parsed.data.style,
    theme: parsed.data.theme,
    limit,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }
  return NextResponse.json(
    { ok: true, job: result.job, deckSlug: result.deckSlug, cardLimit: limit, credits },
    { status: 200 },
  );
}
