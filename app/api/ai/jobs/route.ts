import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
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
import { batchCardLimit, clampBatchSize } from "@/lib/ai/generation-limits";
import {
  SET_GENERATION_ENABLED,
  createCardGenerationJob,
  createCardRemixJob,
  createDeckGenerationJob,
  createDeckRemixJob,
  createSetGenerationJob,
} from "@/lib/ai/generation-jobs";
import { FRAME_TEMPLATE_VALUES, RARITY_VALUES } from "@/types/card";
import { AI_DECK_FORMATS } from "@/lib/ai/deck-design";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getEntitlements } from "@/lib/billing/entitlements";

// ---------------------------------------------------------------------------
// POST /api/ai/jobs — create an AI batch-generation job and run its PLAN
// step (concept + every card's text in one cohesive batch). The client then
// advances the job one step at a time via /api/ai/jobs/[id]/step.
//
// Card count is clamped to the caller's batch limit: 3 for everyone until
// subscriptions launch, admins exempt (lib/ai/generation-limits.ts).
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
    format: z.enum(AI_DECK_FORMATS),
    // Present = generate ADDITIONAL cards into this existing deck.
    deck_id: z.string().uuid().optional(),
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
  const size =
    parsed.data.kind === "card" || parsed.data.kind === "card_remix"
      ? 1
      : parsed.data.kind === "deck_remix"
        ? limit // remix caps at the batch limit; entries beyond it are skipped
        : clampBatchSize(parsed.data.size ?? limit, limit);

  const rate = await checkAiRateLimit(user.id);
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: rate.message },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  // Single-card jobs keep the legacy flow's own daily ceiling as an
  // anti-abuse backstop (credits are the user-facing currency now).
  if (parsed.data.kind === "card") {
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
  // Card remixes likewise keep the legacy route's own daily ceiling, and need
  // the image-to-image model on top of the design model.
  if (parsed.data.kind === "card_remix") {
    if (!isImageRemixConfigured()) {
      return NextResponse.json(
        { ok: false, error: "AI remix isn't configured on this deployment." },
        { status: 503 },
      );
    }
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

  // Deck/set batch flows share one per-day image ceiling (admins exempt).
  if (
    parsed.data.kind === "deck" ||
    parsed.data.kind === "deck_remix" ||
    parsed.data.kind === "set"
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
  if (isBillingEnabled()) {
    const entitlements = await getEntitlements();
    if (entitlements.credits < size) {
      return NextResponse.json(
        {
          ok: false,
          error: `You need ${size} credits to generate ${size} cards (you have ${entitlements.credits}).`,
          code: "INSUFFICIENT_CREDITS",
          balance: entitlements.credits,
          needed: size,
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
    const result = await createCardGenerationJob({
      theme: parsed.data.theme,
      style: parsed.data.style,
      cardType: parsed.data.card_type,
      frame: parsed.data.frame,
      rarity: parsed.data.rarity,
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
    const result = await createDeckGenerationJob({
      theme: parsed.data.theme ?? "",
      style: parsed.data.style,
      format: parsed.data.format,
      size,
      deckId: parsed.data.deck_id,
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
