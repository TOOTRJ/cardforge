import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import {
  designCards,
  type DesignedCard,
  type DesignSlot,
} from "@/lib/ai/card-design";
import { judgeModel } from "@/lib/ai/provider";
import { buildDeckSkeleton, type DeckSlot } from "@/lib/ai/mtg-rules";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// AI deck design — concept + card batch for "generate a whole deck".
//
// Same two-step shape as set generation: a cheap concept call picks the
// deck's name, colors, and strategy; the shared card-design engine then
// fills a format-aware skeleton (commander slot, land share, 55/45
// creature/spell split along a real mana curve — lib/ai/mtg-rules.ts).
// All cards are ORIGINAL customs; the deck ships private.
// ---------------------------------------------------------------------------

export const AI_DECK_FORMATS = ["commander", "standard", "limited"] as const;
export type AiDeckFormat = (typeof AI_DECK_FORMATS)[number];

const deckConceptSchema = z
  .object({
    deck_title: z.string().min(1).max(80).describe("Original deck name."),
    deck_description: z
      .string()
      .max(300)
      .describe("One-sentence pitch: what the deck does and how it wins."),
    strategy: z
      .string()
      .max(600)
      .describe(
        "A short strategy paragraph card designers build from: game plan, key mechanics, recurring faction/world names. Original names only.",
      ),
    colors: z
      .array(z.enum(["white", "blue", "black", "red", "green"]))
      .min(1)
      .max(3)
      .describe("The deck's 1-3 colors."),
  })
  .strict();

export type DeckConcept = z.infer<typeof deckConceptSchema>;

const DECK_CONCEPT_SYSTEM = `You pitch ORIGINAL Magic: The Gathering-style decks for a homebrew tool. Given a theme and format, invent a deck name, a one-sentence pitch, a strategy paragraph (game plan, key mechanics, world/faction names), and pick 1-3 colors that fit. Everything must be original — never Wizards-owned proper nouns, never real-world brands.`;

const FORMAT_NOTES: Record<AiDeckFormat, string> = {
  commander:
    "Commander (singleton, 100 cards): every card is a one-of; the first card is the deck's LEGENDARY commander and every other card must fit inside the commander's color identity.",
  standard:
    "Standard (60 cards, up to 4 copies): efficient, focused designs that reward playing multiples.",
  limited:
    "Limited (40 cards): simple, self-contained designs that play well without deep synergy.",
};

function slotFromDeckSlot(
  slot: DeckSlot,
  colors: ColorIdentity[],
  index: number,
): DesignSlot {
  const colorHint = colors[index % colors.length];
  if (slot.role === "commander") {
    return {
      cardType: "creature",
      rarity: "mythic",
      colorHint: colors.length > 1 ? "multicolor" : colorHint,
      note: "This is the deck's LEGENDARY COMMANDER (supertype Legendary) — the strategy's centerpiece.",
    };
  }
  if (slot.role === "land") {
    return {
      cardType: "land",
      rarity: "rare",
      colorHint,
      note: "A nonbasic land supporting the deck's colors and strategy.",
    };
  }
  return {
    cardType: slot.role === "creature" ? "creature" : undefined,
    roleHint: slot.role,
    colorHint,
    note:
      slot.manaValueHint != null
        ? `Target mana value ≈ ${slot.manaValueHint}.`
        : undefined,
  };
}

export type DeckDesignResult = {
  concept: DeckConcept;
  cards: DesignedCard[];
  /** Parallel to `cards`: the skeleton slot each card fills. */
  slots: DeckSlot[];
};

export async function generateDeckPlan(input: {
  theme: string;
  style?: string;
  format: AiDeckFormat;
  size: number;
}): Promise<DeckDesignResult> {
  const theme =
    input.theme.trim().slice(0, 300) ||
    "a flavorful, fun-to-pilot original deck — surprise me";

  const { object: concept } = await generateObject({
    model: judgeModel(),
    schema: deckConceptSchema,
    system: DECK_CONCEPT_SYSTEM,
    prompt: [
      `Theme: ${theme}`,
      `Format: ${FORMAT_NOTES[input.format]}`,
      input.style?.trim()
        ? `Art/tone style: ${input.style.trim().slice(0, 200)}`
        : null,
      `${input.size} cards will be designed.`,
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0.9,
  });

  const slots = buildDeckSkeleton(input.format, input.size);
  const { cards } = await designCards({
    theme,
    style: input.style,
    slots: slots.map((slot, index) =>
      slotFromDeckSlot(slot, concept.colors, index),
    ),
    context: [
      `These cards form the deck "${concept.deck_title}" — ${concept.deck_description}`,
      `Strategy: ${concept.strategy}`,
      `Format rules: ${FORMAT_NOTES[input.format]}`,
      "The cards must play together: shared mechanics, recurring names, a coherent game plan.",
    ].join("\n"),
  });

  return { concept, cards, slots };
}
