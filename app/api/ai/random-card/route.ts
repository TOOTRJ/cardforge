import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  checkAiRateLimit,
  checkRandomCardDailyLimit,
  logAiCall,
} from "@/lib/ai/rate-limit";
import {
  generateRandomCard,
  isOpenAiConfigured,
  randomCardSchema,
  type RandomCardInput,
} from "@/lib/ai/random-card";
import { generateRandomArt } from "@/lib/ai/random-art";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
} from "@/types/card";

// ---------------------------------------------------------------------------
// /api/ai/random-card
//
// Auth-required. Generates a fully-formed card (GPT-4o, schema-bounded) and
// an accompanying piece of original art (DALL-E 3 HD), uploads the art to
// the caller's card-art bucket folder, and returns both to the client so
// the editor can reset() its form with the result.
//
// Quota:
//   - Global per-user cap from lib/ai/rate-limit.ts (20/min, 200/day) applies.
//   - On top of that, a random-card-specific 10/day cap protects DALL-E
//     spend (the priciest piece of the request).
// ---------------------------------------------------------------------------

export const maxDuration = 90;

const requestSchema = z
  .object({
    rarity: z.enum(RARITY_VALUES).optional(),
    color: z.enum(COLOR_IDENTITY_VALUES).optional(),
    cardType: z.enum(CARD_TYPE_VALUES).optional(),
    concept: z.string().trim().max(280).optional(),
  })
  .strict()
  .default({});

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

  if (!isOpenAiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "AI random-card generator isn't configured on this deployment. Set OPENAI_API_KEY.",
      },
      { status: 503 },
    );
  }

  // ---- Validate input ----
  let payload: unknown = {};
  try {
    const text = await request.text();
    payload = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid request body.",
      },
      { status: 400 },
    );
  }
  const input = parsed.data as RandomCardInput;

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
  const dailyLimit = await checkRandomCardDailyLimit(user.id);
  if (!dailyLimit.ok) {
    return NextResponse.json(
      { ok: false, error: dailyLimit.message },
      {
        status: 429,
        headers: { "Retry-After": String(dailyLimit.retryAfterSeconds) },
      },
    );
  }

  // ---- Generate text first (cheaper; failures here mean we never burn
  //      a DALL-E call). Log the call ahead of the AI request so a noisy
  //      attacker can't trigger errors to evade the limit (matches the
  //      existing card-assistant pattern). ----
  await logAiCall(user.id, "generate_random_card");

  let cardObject;
  try {
    cardObject = await generateRandomCard(input);
  } catch (error) {
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
  await logAiCall(user.id, "generate_random_art");
  const art = await generateRandomArt(card.art_prompt);

  return NextResponse.json(
    {
      ok: true,
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
