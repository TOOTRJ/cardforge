// ---------------------------------------------------------------------------
// Deck domain types — narrowed from the generated Supabase rows, same
// convention as types/card.ts: downstream code imports these, never the raw
// generated rows, so enum-typed text columns stay honest.
// ---------------------------------------------------------------------------

import type {
  Deck as DeckRow,
  DeckCard as DeckCardRow,
} from "@/types/supabase";
import { VISIBILITY_VALUES, type Visibility } from "@/types/card";

// Play formats — mirrors the decks_format_valid CHECK in migration 0055.
export const DECK_FORMAT_VALUES = [
  "commander",
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "pauper",
  "brawl",
  "standard_brawl",
  "oathbreaker",
  "limited",
  "casual",
] as const;

export type DeckFormat = (typeof DECK_FORMAT_VALUES)[number];

export const DECK_FORMAT_LABELS: Record<DeckFormat, string> = {
  commander: "Commander",
  standard: "Standard",
  pioneer: "Pioneer",
  modern: "Modern",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
  brawl: "Brawl",
  standard_brawl: "Standard Brawl",
  oathbreaker: "Oathbreaker",
  limited: "Limited (40-card)",
  casual: "Casual",
};

// Boards — mirrors the deck_cards_board_valid CHECK in migration 0055.
export const DECK_BOARD_VALUES = [
  "main",
  "side",
  "maybe",
  "commander",
  "companion",
] as const;

export type DeckBoard = (typeof DECK_BOARD_VALUES)[number];

export const DECK_BOARD_LABELS: Record<DeckBoard, string> = {
  main: "Mainboard",
  side: "Sideboard",
  maybe: "Maybeboard",
  commander: "Commander",
  companion: "Companion",
};

export function isDeckFormat(value: unknown): value is DeckFormat {
  return (
    typeof value === "string" &&
    (DECK_FORMAT_VALUES as readonly string[]).includes(value)
  );
}

export function isDeckBoard(value: unknown): value is DeckBoard {
  return (
    typeof value === "string" &&
    (DECK_BOARD_VALUES as readonly string[]).includes(value)
  );
}

export function isDeckVisibility(value: unknown): value is Visibility {
  return (
    typeof value === "string" &&
    (VISIBILITY_VALUES as readonly string[]).includes(value)
  );
}

// Narrowed rows.
export type Deck = Omit<DeckRow, "visibility" | "format"> & {
  visibility: Visibility;
  format: DeckFormat;
};

export type DeckCardEntry = Omit<DeckCardRow, "board"> & {
  board: DeckBoard;
};

/**
 * Derived remix state of a deck entry (no status column in the DB — see the
 * 0055 migration header):
 *   real     — references a real card, no custom proxy yet
 *   remixed  — real card with a linked custom proxy
 *   custom   — one of the owner's cards added directly (no real-card source)
 *   unresolved — import placeholder kept by name only
 */
export type DeckEntryState = "real" | "remixed" | "custom" | "unresolved";

export function deckEntryState(entry: {
  scryfall_id: string | null;
  card_id: string | null;
}): DeckEntryState {
  if (entry.scryfall_id) return entry.card_id ? "remixed" : "real";
  return entry.card_id ? "custom" : "unresolved";
}
