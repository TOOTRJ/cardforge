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

// How an entry got into the deck — mirrors deck_cards_source_valid
// (migration 0144, TODO DK2.6). NULL on a row written before 0144 that its
// backfill couldn't place.
export const DECK_ENTRY_SOURCE_VALUES = [
  "import",
  "creator",
  "link",
  "ai_generate",
  "ai_remix",
  "manual",
] as const;

export type DeckEntrySource = (typeof DECK_ENTRY_SOURCE_VALUES)[number];

export function isDeckEntrySource(value: unknown): value is DeckEntrySource {
  return (
    typeof value === "string" &&
    (DECK_ENTRY_SOURCE_VALUES as readonly string[]).includes(value)
  );
}

export type DeckCardEntry = Omit<DeckCardRow, "board" | "source" | "featured_rank"> & {
  board: DeckBoard;
  /** Absent on a database 0144 has not reached. */
  source?: DeckEntrySource | null;
  /** The owner's cover pick, 1-5 (migration 0151, TODO DK6.4); null = not
   *  picked. Absent on a database 0151 has not reached. */
  featured_rank?: number | null;
};

/** Cover focal point (migration 0057) — {focalX, focalY} in 0..1, NULL =
 *  centered. Rendered as CSS object-position. */
export type DeckCoverPosition = {
  focalX: number;
  focalY: number;
};

export function coverObjectPosition(
  position: unknown,
): string | undefined {
  if (
    position &&
    typeof position === "object" &&
    typeof (position as DeckCoverPosition).focalX === "number" &&
    typeof (position as DeckCoverPosition).focalY === "number"
  ) {
    const { focalX, focalY } = position as DeckCoverPosition;
    return `${Math.round(focalX * 100)}% ${Math.round(focalY * 100)}%`;
  }
  return undefined;
}

/** Context threaded into the card creator by /create?deckCard=<id> — the
 *  deck entry being remixed into a custom proxy. */
export type DeckRemixContext = {
  deckCardId: string;
  scryfallId: string | null;
  deckSlug: string;
  deckTitle: string;
  entryName: string;
};

/**
 * A deck entry's status (owner vocabulary 2026-10-28, TODO DK2.6) — what the
 * entry IS today, derived from the entry and its card, never stored
 * (lib/decks/entry-status.ts deckEntryStatus, the one answer):
 *   imported   a real card, not changed yet (a Scryfall printing alone, or
 *              a PipGlyph card that still prints what it was imported as);
 *   edited     an import whose card was changed;
 *   remix      a card started from another PipGlyph card;
 *   original   a card made from scratch;
 *   not_found  a pasted name that matched no card.
 */
export const DECK_ENTRY_STATUS_VALUES = [
  "imported",
  "edited",
  "remix",
  "original",
  "not_found",
] as const;

export type DeckEntryStatus = (typeof DECK_ENTRY_STATUS_VALUES)[number];

/** A status as one entry's badge says it. */
export const DECK_ENTRY_STATUS_LABELS: Record<DeckEntryStatus, string> = {
  imported: "Imported",
  edited: "Edited",
  remix: "Remix",
  original: "Original",
  not_found: "Not found",
};

/** A status as a COUNT of cards says it (the deck's breakdown, the report). */
export const DECK_ENTRY_STATUS_COUNT_LABELS: Record<DeckEntryStatus, string> = {
  imported: "Imported, not changed yet",
  edited: "Edited imports",
  remix: "Remixes",
  original: "Originals",
  not_found: "Not found",
};
