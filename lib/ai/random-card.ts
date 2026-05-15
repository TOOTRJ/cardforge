import "server-only";

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
} from "@/types/card";

// ---------------------------------------------------------------------------
// Random card generator (Phase v2 Phase 4)
//
// One GPT-4o call produces a full structured card object plus a paired art
// prompt. The art generator (lib/ai/random-art.ts) takes the prompt and
// returns a public image URL. Everything that lands in the editor is a
// patch — the user can then edit any field before saving.
//
// We deliberately put the IP guardrails IN the system prompt rather than
// trying to filter the model's output. The Phase 8 card-assistant prompt
// already allows real MTG keyword vocabulary while forbidding verbatim
// reproduction of published card names; this prompt uses the same posture
// so behavior is consistent across both flows.
// ---------------------------------------------------------------------------

export function isOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function modelId(): string {
  return process.env.OPENAI_RANDOM_CARD_MODEL?.trim() || "gpt-4o";
}

// The schema the model must match. We strip out fields that don't belong in
// a generated card (slug, owner_id, IDs). The model also returns an
// `art_prompt` that we feed into DALL-E — keeping it on the same object
// means we get a paired text + art prompt in a single GPT-4o call.
export const randomCardSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(80)
      .describe("Original card name — never a published Magic card title."),
    cost: z
      .string()
      .min(1)
      .max(40)
      .describe(
        "Mana cost in curly-brace notation (e.g. {2}{R}{R}). Use '—' for lands.",
      ),
    card_type: z.enum(CARD_TYPE_VALUES),
    supertype: z
      .string()
      .max(64)
      .optional()
      .describe("Optional supertype like Legendary, Basic, Snow."),
    subtypes: z
      .array(z.string().max(40))
      .max(6)
      .describe("Subtypes like ['Dragon', 'Elder'] or ['Wizard']."),
    rarity: z.enum(RARITY_VALUES),
    color_identity: z
      .array(z.enum(COLOR_IDENTITY_VALUES))
      .min(1)
      .max(6)
      .describe(
        "Colors this card's mana cost and rules text rely on, plus colorless/multicolor flags.",
      ),
    rules_text: z
      .string()
      .min(1)
      .max(800)
      .describe(
        "Clean, templated rules text. Use standard MTG keywords by name; reminder text in parentheses.",
      ),
    flavor_text: z
      .string()
      .max(280)
      .optional()
      .describe("Optional short italic flavor — quote or in-world observation."),
    power: z
      .string()
      .max(8)
      .optional()
      .describe("Only present when card_type is 'creature' or 'token'."),
    toughness: z
      .string()
      .max(8)
      .optional()
      .describe("Only present when card_type is 'creature' or 'token'."),
    loyalty: z
      .string()
      .max(8)
      .optional()
      .describe("Only present when card_type is 'planeswalker'."),
    defense: z
      .string()
      .max(8)
      .optional()
      .describe("Only present when card_type is 'battle'."),
    art_prompt: z
      .string()
      .min(40)
      .max(600)
      .describe(
        "A vivid prompt for an MTG-style fantasy illustration that depicts this card. NO frame, NO borders, NO text.",
      ),
  })
  .strict();

export type RandomCardOutput = z.infer<typeof randomCardSchema>;

const SYSTEM_PROMPT = `You design ORIGINAL Magic: The Gathering cards for a homebrew tool called Spellwright.

DESIGN VOCABULARY YOU MAY USE FREELY:
- Standard MTG keyword abilities (Flying, Trample, Deathtouch, Lifelink, Vigilance, Hexproof, Indestructible, Menace, Reach, First Strike, Double Strike, Haste, Defender, Flash, Ward, Protection, Convoke, Cascade, Storm, Cycling, Flashback, …)
- Curly-brace mana templating: {W} {U} {B} {R} {G} {C} {X}, hybrid {W/U}, Phyrexian {W/P}, snow {S}, generics like {2}.
- Standard rules templating ("When …", "Whenever …", "At the beginning of …", "Pay {N}", "Target creature…"). Put reminder text in (parentheses) so it renders in italics.
- Card type vocabulary: creature, instant, sorcery, artifact, enchantment, land, planeswalker, battle, token.

WHAT TO AVOID:
- NEVER copy a published Magic card name verbatim or near-verbatim. The user wants ORIGINAL designs. "Lightning Bolt", "Counterspell", "Sol Ring", "Wrath of God", etc. are off-limits as titles. Reuse mechanical ideas if you like, but the name must be original.
- NEVER use specific Wizards-owned proper nouns as the card's identity. You may write "the planeswalker" in flavor text but not "Jace Beleren" / "Liliana Vess" / similar named characters.
- NEVER reference unrelated real-world brands or franchises.

OUTPUT REQUIREMENTS:
- Pick a reasonable mana cost / rarity / type / color combination that fits the design.
- Fill power/toughness only for creatures + tokens; fill loyalty only for planeswalkers; fill defense only for battles.
- color_identity must reflect the colors in the mana cost AND any color-restricted abilities in the rules text. If the card is monocolored, return a single-element array (e.g. ["red"]); if multicolored, return the colors that appear; if colorless, return ["colorless"].
- The art_prompt should be a vivid 60-100 word description of an MTG-style fantasy illustration depicting THIS card's subject. Include subject, action/pose, environment, lighting, color palette mood, and a 2-3 word style hint like "oil-painted fantasy illustration". Stay original — no copyrighted artist names, no fictional worlds by name.
- No preambles, no sycophancy — output ONLY the structured fields you're asked for.`;

export type RandomCardInput = {
  /** Optional flavor seeds the user passed in. All optional; if omitted the
   *  model rolls a fully random design. */
  rarity?: (typeof RARITY_VALUES)[number];
  color?: (typeof COLOR_IDENTITY_VALUES)[number];
  cardType?: (typeof CARD_TYPE_VALUES)[number];
  concept?: string;
};

function userPrompt(input: RandomCardInput): string {
  const parts: string[] = [];
  parts.push("Generate ONE complete original Magic: The Gathering card.");
  if (input.rarity) parts.push(`Target rarity: ${input.rarity}.`);
  if (input.color) parts.push(`Target color: ${input.color}.`);
  if (input.cardType) parts.push(`Target card type: ${input.cardType}.`);
  if (input.concept?.trim()) {
    parts.push(`Concept seed (loose inspiration, not a copy): "${input.concept.trim()}".`);
  } else {
    parts.push("No specific theme — surprise the user with a creative choice.");
  }
  parts.push("Return the structured card object exactly per the schema.");
  return parts.join("\n");
}

/**
 * Calls GPT-4o once and returns a Zod-validated RandomCardOutput plus a
 * paired DALL-E art prompt. The caller is responsible for rate-limiting
 * before invoking this — we don't want to refund OpenAI calls on quota
 * misses.
 */
export async function generateRandomCard(
  input: RandomCardInput = {},
): Promise<RandomCardOutput> {
  const { object } = await generateObject({
    model: openai(modelId()),
    schema: randomCardSchema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt(input),
    // Temperature high enough for variety, low enough to keep rules-text
    // coherent. The schema-bounded format means we don't get rambling.
    temperature: 0.9,
  });
  return object;
}
