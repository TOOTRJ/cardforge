import { supertypeHasWord } from "@/lib/cards/card-display";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// Where a new deck's FIRST card goes — "Build a deck around this card" (TODO
// DK8.3; createDeckAction's `firstCardId`). A legendary creature leads a
// deck played with a commander: Commander, Brawl and Standard Brawl put it
// in the commander zone, as their rules name a deck's commander. Anything
// else goes on the main board (add_custom_deck_entry's board): an
// Oathbreaker deck's leader is a planeswalker with its signature spell (not
// a legendary creature), a non-legendary card is no commander, and a token
// or an emblem is never one. Pure; what a card IS reads `card_type` and
// `supertype`, never its printed type line (CLAUDE.md "The type line").
// ---------------------------------------------------------------------------

/** Formats whose commander is a legendary creature — every format with a
 *  commander zone (format-rules.ts) but Oathbreaker. */
const LEGENDARY_CREATURE_LEADS: ReadonlySet<DeckFormat> = new Set(["commander", "brawl", "standard_brawl"]);

export type FirstCardFacts = {
  card_type: string | null;
  supertype: string | null;
};

/** A legendary creature card: "Legendary" in its supertype, and a creature
 *  by its card type or a "Creature" word beside another type ("Legendary
 *  Artifact Creature"). Never a token or an emblem. */
export function isLegendaryCreature(card: FirstCardFacts): boolean {
  if (card.card_type === "token" || card.card_type === "emblem") return false;
  if (!supertypeHasWord(card.supertype, "Legendary")) return false;
  return card.card_type === "creature" || supertypeHasWord(card.supertype, "Creature");
}

/** The board the first card of a new deck of `format` goes on. */
export function firstCardBoard(format: DeckFormat, card: FirstCardFacts): "commander" | "main" {
  return LEGENDARY_CREATURE_LEADS.has(format) && isLegendaryCreature(card)
    ? "commander"
    : "main";
}
