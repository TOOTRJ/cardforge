import { buildTypeLine } from "@/lib/cards/card-display";
import { manaValueOfCost } from "@/lib/cards/mana-value";
import { deckEntryStatus, type StatusCard, type StatusEntry } from "@/lib/decks/entry-status";
import type { CardType, ColorIdentity } from "@/types/card";
import type { DeckEntryStatus } from "@/types/deck";

// ---------------------------------------------------------------------------
// An entry's EFFECTIVE fields (TODO DK2.7) — its type line, cost, colour
// letters and mana value as the deck should count it. A deck entry carries
// the Scryfall printing's values (copied at import, 0055) and may link a
// PipGlyph card with values of its own; the two disagree as soon as the
// card is edited (a creature turned instant, a new cost, another colour).
//
// ONE rule, read by the deck list's grouping and rows, the pop-up, the
// deck's breakdown (lib/decks/analytics.ts) and the report: the card's own
// values WIN wherever the viewer reads the card and it is not an unchanged
// import (status "imported", whose printing is the authority — Scryfall's
// colour identity, its split card's summed mana value); the entry's values
// win otherwise, each falling back to the other side when its own is empty.
// The type line of a card is built by buildTypeLine (never by hand) from the
// front face, as the card prints it. Pure and client-safe.
// ---------------------------------------------------------------------------

export type EntryColorLetter = "W" | "U" | "B" | "R" | "G";

export type EffectiveEntryFields = {
  typeLine: string | null;
  cost: string | null;
  manaValue: number | null;
  /** WUBRG letters; empty = colourless (or a gold card that names none —
   *  `multicolorOnly`). */
  colors: EntryColorLetter[];
  /** A PipGlyph card saved as "multicolor" without naming its colours: gold,
   *  never colourless. */
  multicolorOnly: boolean;
};

type EffectiveEntry = StatusEntry & {
  type_line?: string | null;
  mana_cost?: string | null;
  mana_value?: number | null;
  color_identity?: readonly string[] | null;
};

type EffectiveCard = StatusCard & {
  supertype?: string | null;
  card_type?: CardType | string | null;
  subtypes?: readonly string[] | null;
  printed_types?: string | null;
  cost?: string | null;
  color_identity?: readonly (ColorIdentity | string)[] | null;
};

const WORD_LETTER: Readonly<Record<string, EntryColorLetter>> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

const LETTERS: ReadonlySet<string> = new Set(["W", "U", "B", "R", "G"]);

function cardTypeLine(card: EffectiveCard): string | null {
  if (!card.card_type && !card.supertype && !(card.subtypes ?? []).some(Boolean) && typeof card.printed_types !== "string") {
    return null;
  }
  return (
    buildTypeLine({
      supertype: card.supertype,
      cardType: (card.card_type || null) as CardType | null,
      subtypes: card.subtypes,
      printedTypes: card.printed_types,
    }) || null
  );
}

function cardLetters(card: EffectiveCard): EntryColorLetter[] {
  return (card.color_identity ?? []).map((word) => WORD_LETTER[word]).filter((letter): letter is EntryColorLetter => Boolean(letter));
}

function entryLetters(entry: EffectiveEntry): EntryColorLetter[] {
  return (entry.color_identity ?? []).filter((letter): letter is EntryColorLetter => LETTERS.has(letter));
}

export function effectiveEntryFields(
  entry: EffectiveEntry,
  card: EffectiveCard | null | undefined,
  status: DeckEntryStatus = deckEntryStatus(entry, card),
): EffectiveEntryFields {
  const cardWins = Boolean(card) && status !== "imported";
  const fromCard = card
    ? {
        typeLine: cardTypeLine(card),
        cost: card.cost?.trim() ? card.cost : null,
        manaValue: manaValueOfCost(card.cost),
        colors: cardLetters(card),
        multicolorOnly: (card.color_identity ?? []).includes("multicolor"),
      }
    : null;
  const fromEntry = {
    typeLine: entry.type_line?.trim() ? entry.type_line : null,
    cost: entry.mana_cost?.trim() ? entry.mana_cost : null,
    manaValue:
      entry.mana_value !== null && entry.mana_value !== undefined ? Number(entry.mana_value) : manaValueOfCost(entry.mana_cost),
    colors: entryLetters(entry),
  };

  if (fromCard && cardWins) {
    // The card's colours are the card's whole answer (colourless included);
    // its type line, cost and mana value fall back to the entry's only when
    // the card has none to give.
    return {
      typeLine: fromCard.typeLine ?? fromEntry.typeLine,
      cost: fromCard.cost ?? (fromCard.typeLine ? null : fromEntry.cost),
      manaValue: fromCard.manaValue ?? (fromCard.typeLine ? null : fromEntry.manaValue),
      colors: fromCard.colors,
      multicolorOnly: fromCard.colors.length === 0 && fromCard.multicolorOnly,
    };
  }
  const colors = fromEntry.colors.length > 0 || !fromCard ? fromEntry.colors : fromCard.colors;
  return {
    typeLine: fromEntry.typeLine ?? fromCard?.typeLine ?? null,
    cost: fromEntry.cost ?? fromCard?.cost ?? null,
    manaValue: fromEntry.manaValue ?? fromCard?.manaValue ?? null,
    colors,
    multicolorOnly: colors.length === 0 && fromEntry.colors.length === 0 && Boolean(fromCard?.multicolorOnly),
  };
}
