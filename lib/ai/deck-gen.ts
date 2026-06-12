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
// AI set generator (Pro feature).
//
// One structured GPT call drafts a COHESIVE themed mini-set: a title + blurb
// plus N original cards that share a flavor/mechanical identity. We deliberately
// generate text only (no art) so the whole set comes back in a single, fast,
// affordable call — the user can then generate or upload art per card. Each
// generated card costs credits (see DECK_CARD_CREDIT_COST), metered by the
// route. Same IP guardrails as the random-card generator: original names only,
// no Wizards-owned proper nouns.
// ---------------------------------------------------------------------------

export const MIN_DECK_SIZE = 3;
export const MAX_DECK_SIZE = 12;
export const DEFAULT_DECK_SIZE = 8;
export const DECK_CARD_CREDIT_COST = 1;

function modelId(): string {
  return process.env.OPENAI_RANDOM_CARD_MODEL?.trim() || "gpt-4o";
}

const deckCardSchema = z
  .object({
    title: z.string().min(1).max(80),
    cost: z.string().min(1).max(40),
    card_type: z.enum(CARD_TYPE_VALUES),
    supertype: z.string().max(64).nullable(),
    subtypes: z.array(z.string().max(40)).max(6),
    rarity: z.enum(RARITY_VALUES),
    color_identity: z.array(z.enum(COLOR_IDENTITY_VALUES)).min(1).max(6),
    rules_text: z.string().min(1).max(800),
    flavor_text: z.string().max(280).nullable(),
    power: z.string().max(8).nullable(),
    toughness: z.string().max(8).nullable(),
    loyalty: z.string().max(8).nullable(),
    defense: z.string().max(8).nullable(),
  })
  .strict();

export const deckSchema = z
  .object({
    set_title: z.string().min(1).max(80),
    set_description: z.string().max(300),
    cards: z.array(deckCardSchema).min(1).max(MAX_DECK_SIZE),
  })
  .strict();

export type DeckCardOutput = z.infer<typeof deckCardSchema>;
export type DeckOutput = z.infer<typeof deckSchema>;

export function clampDeckSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DECK_SIZE;
  return Math.max(MIN_DECK_SIZE, Math.min(MAX_DECK_SIZE, Math.round(value)));
}

const SYSTEM_PROMPT = `You design ORIGINAL Magic: The Gathering-style cards for a homebrew tool called PipGlyph.

Your job: draft a COHESIVE themed mini-set — a small group of cards that clearly belong together (shared mechanics, color identity, world, and flavor), with a mix of rarities and card types that feels like a real expansion slice.

DESIGN VOCABULARY YOU MAY USE FREELY:
- Standard MTG keyword abilities (Flying, Trample, Deathtouch, Lifelink, Vigilance, Hexproof, Menace, Ward, Cascade, Convoke, Flashback, …).
- Curly-brace mana templating: {W} {U} {B} {R} {G} {C} {X}, hybrid {W/U}, Phyrexian {W/P}, generics like {2}.
- Standard rules templating ("When …", "Whenever …", "At the beginning of …", "Target creature…"). Reminder text in (parentheses).

HARD RULES:
- NEVER copy a published Magic card name verbatim or near-verbatim. Every title must be ORIGINAL.
- NEVER use Wizards-owned proper nouns (planeswalker names, plane names, set names) as card identity.
- NEVER reference unrelated real-world brands or franchises.

PER-CARD OUTPUT:
- Fill power/toughness only for creatures + tokens; loyalty only for planeswalkers; defense only for battles; otherwise null.
- color_identity must reflect the mana cost and any color-restricted abilities.
- Keep the set internally balanced and coherent around the requested theme.
- Output ONLY the structured fields requested — no preamble.`;

export async function generateDeck(input: {
  theme: string;
  size: number;
}): Promise<DeckOutput> {
  const size = clampDeckSize(input.size);
  const theme =
    input.theme.trim().slice(0, 300) ||
    "a balanced, flavorful original expansion slice — surprise me";

  const { object } = await generateObject({
    model: openai(modelId()),
    schema: deckSchema,
    system: SYSTEM_PROMPT,
    prompt: [
      `Theme: ${theme}`,
      `Generate exactly ${size} cards that form a cohesive mini-set.`,
      `Give the set an original title and a one-sentence description.`,
    ].join("\n"),
    temperature: 0.9,
  });

  // The model may overshoot the requested count; cap to what was asked for.
  return { ...object, cards: object.cards.slice(0, size) };
}
