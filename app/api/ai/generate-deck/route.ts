import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { checkAiRateLimit, logAiCall, spendCredits } from "@/lib/ai/rate-limit";
import { requireTier, UpgradeRequiredError } from "@/lib/billing/entitlements";
import {
  SET_CARD_CREDIT_COST,
  clampSetSize,
  generateSet,
} from "@/lib/ai/set-gen";
import { createSetAction } from "@/lib/sets/actions";
import { createCardAction } from "@/lib/cards/actions";

// ---------------------------------------------------------------------------
// /api/ai/generate-deck — Pro-only "generate a whole set with AI".
//
// One GPT call drafts a cohesive themed set (text only); we then create a
// private set + a card per result (cards bake lazily — they're private). Each
// generated card costs credits. Returns the new set's slug so the client can
// jump straight into editing it.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

// Same bounds generateSet/clampSetSize enforce internally, but rejected at
// the boundary with a 400 instead of silently truncated.
const deckRequestSchema = z.object({
  theme: z.string().trim().max(300).optional(),
  style: z.string().trim().max(200).optional(),
  size: z.coerce.number().optional(),
});

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
      {
        ok: false,
        error: "AI generation isn't configured on this deployment.",
      },
      { status: 503 },
    );
  }

  // Pro-only feature.
  let entitlements;
  try {
    entitlements = await requireTier("pro");
  } catch (error) {
    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        {
          ok: false,
          error: "AI set generation is a Pro feature.",
          code: "UPGRADE_REQUIRED",
        },
        { status: 403 },
      );
    }
    throw error;
  }

  // Burst guard (shared with the rest of the AI surface).
  const limit = await checkAiRateLimit(user.id);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: limit.message },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
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
  const parsed = deckRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Theme must be a string of at most 300 characters." },
      { status: 400 },
    );
  }
  const theme = parsed.data.theme ?? "";
  const style = parsed.data.style;
  const size = clampSetSize(parsed.data.size ?? 8);

  // Credit pre-check for the whole batch.
  const cost = size * SET_CARD_CREDIT_COST;
  if (entitlements.credits < cost) {
    return NextResponse.json(
      {
        ok: false,
        error: `You need ${cost} credits to generate ${size} cards (you have ${entitlements.credits}).`,
        code: "INSUFFICIENT_CREDITS",
        balance: entitlements.credits,
        needed: cost,
      },
      { status: 402 },
    );
  }

  // Resolve the active game system the cards belong to.
  const supabase = await createClient();
  const { data: gameSystem } = await supabase
    .from("game_systems")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!gameSystem) {
    return NextResponse.json(
      { ok: false, error: "No game system is configured." },
      { status: 500 },
    );
  }

  // Generate the set (text).
  let deck;
  try {
    deck = await generateSet({ theme, style, size });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json(
      { ok: false, error: `AI set generation failed: ${detail}` },
      { status: 502 },
    );
  }

  await logAiCall(user.id, "generate_deck");

  // Create the set (private by default; the user publishes when ready).
  const setResult = await createSetAction(
    {
      title: deck.set_title,
      description: deck.set_description,
      visibility: "private",
    },
    { redirectAfterCreate: false },
  );
  if (!setResult.ok) {
    return NextResponse.json(
      { ok: false, error: "Couldn't create the set." },
      { status: 500 },
    );
  }

  // Create a card per result. Passing primary_set_id makes createCardAction add
  // each card to the set (membership + denormalized symbol). Private cards skip
  // the bake, so this stays fast.
  const cardIds: string[] = [];
  for (const card of deck.cards) {
    const result = await createCardAction(
      {
        title: card.title,
        game_system_id: gameSystem.id,
        cost: card.cost ?? undefined,
        color_identity: card.color_identity,
        supertype: card.supertype ?? undefined,
        card_type: card.card_type,
        subtypes: card.subtypes,
        rarity: card.rarity,
        rules_text: card.rules_text ?? undefined,
        flavor_text: card.flavor_text ?? undefined,
        power: card.power ?? undefined,
        toughness: card.toughness ?? undefined,
        loyalty: card.loyalty ?? undefined,
        defense: card.defense ?? undefined,
        visibility: "private",
        primary_set_id: setResult.setId,
      },
      { redirectAfterCreate: false },
    );
    if (result.ok) cardIds.push(result.cardId);
  }

  // Charge for the cards we actually created.
  const created = cardIds.length;
  let creditsRemaining: number | null = entitlements.credits - cost;
  if (created > 0) {
    const spend = await spendCredits(created * SET_CARD_CREDIT_COST, "generate_deck");
    creditsRemaining = spend.ok && Number.isFinite(spend.balance)
      ? spend.balance
      : entitlements.credits - created * SET_CARD_CREDIT_COST;
  }

  return NextResponse.json(
    {
      ok: true,
      setId: setResult.setId,
      setSlug: setResult.slug,
      count: created,
      creditsRemaining: Number.isFinite(creditsRemaining)
        ? creditsRemaining
        : null,
    },
    { status: 200 },
  );
}
