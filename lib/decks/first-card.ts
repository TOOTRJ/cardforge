import { supertypeHasWord } from "@/lib/cards/card-display";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// Where a new deck's FIRST card goes — "Build a deck around this card" (TODO
// DK8.3; createDeckAction's `firstCardId`). The card that leads a deck played
// with a commander zone (format-rules.ts `formatHasCommander`) starts THERE,
// as each format's rules name its leader:
//   • Commander — a legendary creature;
//   • Brawl and Standard Brawl — a legendary creature or a planeswalker;
//   • Oathbreaker — a planeswalker (the Oathbreaker; its signature spell is
//     the maker's to add). A legendary creature is no Oathbreaker.
// Anything else goes on the main board (add_custom_deck_entry's board): a
// card no rule lets lead, every format without a commander zone, and a token
// or an emblem, which is never one. validateDeck reads the commander zone
// the same way for all four (one or two entries there, never a type check),
// so a leader put there is no warning and anything else waits for its maker.
// Pure; what a card IS reads `card_type` and `supertype`, never its printed
// type line (CLAUDE.md "The type line").
// ---------------------------------------------------------------------------

export type FirstCardFacts = {
  card_type: string | null;
  supertype: string | null;
};

/** A token or an emblem leads nothing, whatever its words say. */
function neverLeads(card: FirstCardFacts): boolean {
  return card.card_type === "token" || card.card_type === "emblem";
}

/** A legendary creature card: "Legendary" in its supertype, and a creature
 *  by its card type or a "Creature" word beside another type ("Legendary
 *  Artifact Creature"). Never a token or an emblem. */
export function isLegendaryCreature(card: FirstCardFacts): boolean {
  if (neverLeads(card)) return false;
  if (!supertypeHasWord(card.supertype, "Legendary")) return false;
  return card.card_type === "creature" || supertypeHasWord(card.supertype, "Creature");
}

/** A planeswalker card: its card type, or a "Planeswalker" word beside
 *  another type — the importer keeps a land or a creature as the card type
 *  and the Planeswalker word in `supertype` (CARD_TYPE_PRECEDENCE). Every
 *  planeswalker printed since 2017 is legendary, so the word "Legendary" is
 *  not asked for (a maker may leave it off). Never a token or an emblem. */
export function isPlaneswalker(card: FirstCardFacts): boolean {
  if (neverLeads(card)) return false;
  return card.card_type === "planeswalker" || supertypeHasWord(card.supertype, "Planeswalker");
}

/** Whether `card` may lead a deck of `format` from its commander zone. */
export function leadsDeck(format: DeckFormat, card: FirstCardFacts): boolean {
  switch (format) {
    case "commander":
      return isLegendaryCreature(card);
    case "brawl":
    case "standard_brawl":
      return isLegendaryCreature(card) || isPlaneswalker(card);
    case "oathbreaker":
      return isPlaneswalker(card);
    default:
      return false;
  }
}

/** What the maker is told when the first card went in but its move to the
 *  commander zone was refused (createDeckAction's `firstCardNotice`). */
export const FIRST_CARD_NOT_COMMANDER =
  "Added to the deck, but it couldn't be set as the commander — set it from the deck page.";

/** The board the first card of a new deck of `format` goes on. */
export function firstCardBoard(format: DeckFormat, card: FirstCardFacts): "commander" | "main" {
  return leadsDeck(format, card) ? "commander" : "main";
}
