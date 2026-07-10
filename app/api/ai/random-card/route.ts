import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  checkAiRateLimit,
  checkRandomCardDailyLimit,
  consumeAiCredits,
  logAiCall,
  refundAiCredits,
} from "@/lib/ai/rate-limit";
import { generateRandomCard, randomCardSchema } from "@/lib/ai/random-card";
import { isDesignAiConfigured } from "@/lib/ai/provider";
import { generateRandomArt } from "@/lib/ai/random-art";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";
import {
  colorHintsForFrame,
  resolveGeneratedFrame,
} from "@/lib/creator/frame-random";
import {
  FRAME_TEMPLATE_VALUES,
  RARITY_VALUES,
  type ColorIdentity,
} from "@/types/card";

// ---------------------------------------------------------------------------
// /api/ai/random-card
//
// Auth-required. Generates a fully-formed card (GPT-4o, schema-bounded) and
// an accompanying piece of original art (gpt-image-1 HD), uploads the art to
// the caller's card-art bucket folder, and returns both to the client so
// the editor can reset() its form with the result.
//
// Quota:
//   - Global per-user burst cap from lib/ai/rate-limit.ts (20/min, 200/day).
//   - AI credits: this flow costs credits (the priciest call we make). Free
//     users get a starting grant; paid tiers get a monthly allotment; everyone
//     can buy top-up packs. Returns 402 + code "INSUFFICIENT_CREDITS" when out.
// ---------------------------------------------------------------------------

export const maxDuration = 90;

// The 9 standard card types the options dialog offers (legacy "spell" and
// layout kinds excluded — layouts are frame choices, not designs).
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

// All fields optional: `{}` is the classic one-click "surprise me". The
// dialog only enables a specific frame once a card type is chosen, so a
// frame without a type degrades to "random" server-side.
const optionsSchema = z.object({
  theme: z.string().trim().max(300).optional(),
  style: z.string().trim().max(200).optional(),
  card_type: z.enum(AI_CARD_TYPE_VALUES).optional(),
  frame: z
    .union([z.literal("random"), z.enum(FRAME_TEMPLATE_VALUES)])
    .optional(),
  rarity: z.enum(RARITY_VALUES).optional(),
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
      { ok: false, error: "Sign in to generate a random card." },
      { status: 401 },
    );
  }

  // Body is optional (legacy clients POST `{}`); reject only malformed input.
  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    rawBody = {};
  }
  const optionsParse = optionsSchema.safeParse(rawBody ?? {});
  if (!optionsParse.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid generation options." },
      { status: 400 },
    );
  }
  const options = optionsParse.data;

  if (!isDesignAiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "AI card generation isn't configured on this deployment. Set AI_GATEWAY_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.",
      },
      { status: 503 },
    );
  }

  // ---- Rate-limit checks ----
  const globalLimit = await checkAiRateLimit(user.id);
  if (!globalLimit.ok) {
    return NextResponse.json(
      { ok: false, error: globalLimit.message },
      {
        status: 429,
        headers: { "Retry-After": String(globalLimit.retryAfterSeconds) },
      },
    );
  }
  // Dedicated per-user daily cap for the random-card flow (10/day). Image
  // generation is the priciest call we make, so it gets its own ceiling on
  // top of the global burst cap — and the UI advertises "10 random cards per
  // day", so this is what enforces that promise.
  const randomCardLimit = await checkRandomCardDailyLimit(user.id);
  if (!randomCardLimit.ok) {
    return NextResponse.json(
      { ok: false, error: randomCardLimit.message },
      {
        status: 429,
        headers: { "Retry-After": String(randomCardLimit.retryAfterSeconds) },
      },
    );
  }
  // ---- Reserve the credit up-front ----
  // The random-card flow (GPT text + gpt-image-1) is the priciest call we make,
  // so it costs an AI credit. We charge BEFORE generating (fail closed) so a
  // DB hiccup can never hand out a free generation and concurrent requests
  // serialize on consume_credits' row lock. Every failure path below refunds.
  const reserve = await consumeAiCredits("generate_random_card", {
    failClosed: true,
  });
  if (!reserve.ok) {
    const insufficient = reserve.reason === "insufficient_credits";
    return NextResponse.json(
      {
        ok: false,
        error: reserve.message,
        ...(insufficient
          ? { code: "INSUFFICIENT_CREDITS", balance: reserve.balance }
          : {}),
      },
      { status: insufficient ? 402 : 503 },
    );
  }
  // The credit is now spent; anything that fails from here must refund it.

  // ---- Generate text first (cheaper; failures here mean we never burn
  //      a gpt-image-1 call). Log the call ahead of the AI request so a noisy
  //      attacker can't trigger errors to evade the limit (matches the
  //      existing card-assistant pattern). ----
  await logAiCall(user.id, "generate_random_card");

  // When the user locked a specific frame, steer generation toward a color
  // that frame actually has published art for — otherwise the frame would
  // have to be dropped after the fact.
  const verifiedKeys = new Set(await getVerifiedFrameKeys());
  let colorHint: ColorIdentity | undefined;
  if (options.frame && options.frame !== "random" && options.card_type) {
    const hints = colorHintsForFrame(
      options.card_type,
      options.frame,
      verifiedKeys,
    );
    if (hints.length > 0) {
      colorHint = hints[Math.floor(Math.random() * hints.length)];
    }
  }

  let cardObject;
  try {
    cardObject = await generateRandomCard({
      theme: options.theme,
      style: options.style,
      cardType: options.card_type,
      rarity: options.rarity,
      colorHint,
    });
  } catch (error) {
    await refundAiCredits(user.id, "generate_random_card");
    const message =
      error instanceof Error ? error.message : "Random card generation failed.";
    return NextResponse.json(
      { ok: false, error: friendlyError(message) },
      { status: 502 },
    );
  }

  // Defensive: re-validate (generateObject already does, but if a future
  // refactor swaps the call this re-validates the wire output).
  const cardParse = randomCardSchema.safeParse(cardObject);
  if (!cardParse.success) {
    await refundAiCredits(user.id, "generate_random_card");
    return NextResponse.json(
      {
        ok: false,
        error:
          "AI returned an invalid card shape. Try regenerating — the random output may be off-template.",
      },
      { status: 502 },
    );
  }
  const card = cardParse.data;

  // ---- Generate the art ----
  // Art is a bonus on top of the card text the credit paid for: a safety-filter
  // trip still returns a usable card, so we keep the charge (no refund) and
  // surface a soft error instead.
  await logAiCall(user.id, "generate_random_art");
  const art = await generateRandomArt(card.art_prompt);

  // Resolve the frame AFTER generation — it depends on the card's final
  // colors. Null → the client keeps its era-default frame for the type.
  const frameTemplate = resolveGeneratedFrame({
    cardType: card.card_type,
    requested: options.frame,
    colorIdentity: card.color_identity,
    verifiedKeys,
  });

  const creditsRemaining = reserve.balance;

  return NextResponse.json(
    {
      ok: true,
      creditsRemaining: Number.isFinite(creditsRemaining)
        ? creditsRemaining
        : null,
      card: {
        title: card.title,
        cost: card.cost,
        card_type: card.card_type,
        supertype: card.supertype,
        subtypes: card.subtypes,
        rarity: card.rarity,
        color_identity: card.color_identity,
        rules_text: card.rules_text,
        flavor_text: card.flavor_text,
        power: card.power,
        toughness: card.toughness,
        loyalty: card.loyalty,
        defense: card.defense,
      },
      frame: frameTemplate ? { template: frameTemplate } : null,
      artPrompt: card.art_prompt,
      art: art.ok ? art : null,
      artError: art.ok ? null : art.error,
    },
    { status: 200 },
  );
}

function friendlyError(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "OpenAI is rate-limiting us. Wait a minute and try again.";
  }
  if (lower.includes("invalid api key") || lower.includes("401") || lower.includes("403")) {
    return "OpenAI rejected the API key. Double-check OPENAI_API_KEY.";
  }
  if (lower.includes("timeout")) {
    return "OpenAI took too long to respond. Try again.";
  }
  return `AI error: ${detail}`;
}
