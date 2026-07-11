import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import {
  clampedText,
  designCards,
  ensureUniqueTitles,
  type DesignedCard,
  type DesignSlot,
} from "@/lib/ai/card-design";
import { judgeModel } from "@/lib/ai/provider";
import { buildDeckSkeleton, type DeckSlot } from "@/lib/ai/mtg-rules";
import type { ColorIdentity } from "@/types/card";
import type { DeckFormat } from "@/types/deck";

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

// Prose lengths are clamped, never hard-failed — see clampedText.
const deckConceptSchema = z
  .object({
    deck_title: clampedText(80).describe("Original deck name."),
    deck_description: clampedText(300, 0).describe(
      "One-sentence pitch: what the deck does and how it wins.",
    ),
    strategy: clampedText(600, 0).describe(
      "A short strategy paragraph (under 90 words) card designers build from: game plan, key mechanics, recurring faction/world names. Original names only.",
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

// One line of real deck-construction rules per format — mirrored from
// lib/decks/format-rules.ts FORMAT_SPECS so generated cards respect the
// format they're joining (add-mode uses the deck's OWN format, which can be
// any of the twelve).
const FORMAT_NOTES: Record<DeckFormat, string> = {
  commander:
    "Commander (singleton, 100 cards incl. the LEGENDARY commander): every card is a one-of and must fit inside the commander's color identity.",
  brawl:
    "Brawl (singleton, 100 cards incl. commander): Commander structure at a Standard-ish power level — every card a one-of inside the commander's colors.",
  standard_brawl:
    "Standard Brawl (singleton, 60 cards incl. commander): compact singleton decks inside the commander's colors.",
  oathbreaker:
    "Oathbreaker (singleton, 60 cards): a planeswalker leads the deck; every card is a one-of inside its color identity.",
  standard:
    "Standard (60 cards, up to 4 copies of a card): efficient, focused designs that reward playing multiples.",
  pioneer:
    "Pioneer (60 cards, up to 4 copies): efficient, synergy-driven designs slightly above Standard power.",
  modern:
    "Modern (60 cards, up to 4 copies): fast, mana-efficient designs — cheap interaction and low curves win.",
  legacy:
    "Legacy (60 cards, up to 4 copies): high-power eternal format — efficient one-mana plays are normal.",
  vintage:
    "Vintage (60 cards, up to 4 copies): the most powerful format — push efficiency, but keep designs fair for casual play.",
  pauper:
    "Pauper (60 cards, up to 4 copies, COMMONS ONLY): every design MUST be common rarity — simple, clean effects.",
  limited:
    "Limited (40 cards): simple, self-contained designs that play well without deep synergy.",
  casual:
    "Casual (anything goes): prioritize fun, flavor, and table talk over raw power.",
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

/** Summary of a card already in the deck — the synergy context for
 *  "generate more cards". Kept terse: a 100-card deck is still only a few
 *  thousand tokens (~pennies) in the plan call. */
export type ExistingDeckCard = {
  name: string;
  type_line: string | null;
  rules_text: string | null;
};

export type ExistingDeckContext = {
  title: string;
  description: string | null;
  cards: ExistingDeckCard[];
  hasCommander: boolean;
};

function existingCardLines(cards: ExistingDeckCard[]): string {
  return cards
    .slice(0, 120)
    .map((card) => {
      const parts = [card.name];
      if (card.type_line) parts.push(`(${card.type_line})`);
      if (card.rules_text) parts.push(`— ${card.rules_text.replace(/\n/g, " / ").slice(0, 220)}`);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}

export async function generateDeckPlan(input: {
  theme: string;
  style?: string;
  /** New decks offer AI_DECK_FORMATS; add-mode passes the deck's own
   *  format, which can be any of the twelve. */
  format: DeckFormat;
  size: number;
  /** Present when ADDING cards to an existing deck: the new cards must
   *  synergize with what's already there, and the concept anchors on the
   *  deck's existing identity instead of inventing a new one. */
  existing?: ExistingDeckContext;
}): Promise<DeckDesignResult> {
  const theme =
    input.theme.trim().slice(0, 300) ||
    (input.existing
      ? "extend the deck's existing theme"
      : "a flavorful, fun-to-pilot original deck — surprise me");

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
      input.existing
        ? [
            `IMPORTANT: this is an EXISTING deck called "${input.existing.title}"${
              input.existing.description ? ` — ${input.existing.description}` : ""
            }. Keep its identity (deck_title should echo it) and infer the strategy and colors FROM its current cards:`,
            existingCardLines(input.existing.cards),
          ].join("\n")
        : null,
      `${input.size} ${input.existing ? "ADDITIONAL" : ""} cards will be designed.`,
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0.9,
  });

  let slots = buildDeckSkeleton(input.format, input.size);
  // Adding to a deck that already has a commander → never design another.
  if (input.existing?.hasCommander) {
    slots = slots.map((slot) =>
      slot.role === "commander"
        ? { ...slot, role: "creature" as const }
        : slot,
    );
  }

  const designSlots = slots.map((slot, index) =>
    slotFromDeckSlot(slot, concept.colors, index),
  );
  // Pauper is commons-only — the format rule, not a suggestion.
  const finalSlots =
    input.format === "pauper"
      ? designSlots.map((slot) => ({ ...slot, rarity: "common" as const }))
      : designSlots;

  const { cards } = await designCards({
    theme,
    style: input.style,
    slots: finalSlots,
    context: [
      `These cards form the deck "${concept.deck_title}" — ${concept.deck_description}`,
      `Strategy: ${concept.strategy}`,
      `Format rules: ${FORMAT_NOTES[input.format]}`,
      input.existing
        ? [
            "The deck ALREADY CONTAINS these cards — the new designs must SYNERGIZE with them (shared mechanics, tribal/keyword overlap, curve gaps filled) and stay inside their color identity. NEVER reuse one of their names, and NEVER design a near-duplicate of a card the deck already has — every new card must add something the deck currently lacks:",
            existingCardLines(input.existing.cards),
          ].join("\n")
        : null,
      "The cards must play together: shared mechanics, recurring names, a coherent game plan. Every card title in this batch must be unique.",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  // Hard guarantee on names: no collisions with the deck's existing cards
  // or within the batch (the model occasionally reuses a name it liked).
  const { cards: uniqueCards } = await ensureUniqueTitles(
    cards,
    input.existing?.cards.map((card) => card.name) ?? [],
  );

  return { concept, cards: uniqueCards, slots };
}
