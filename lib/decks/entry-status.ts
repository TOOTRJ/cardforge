import {
  importEditStateOf,
  type FingerprintCard,
  type ImportProvenanceColumns,
} from "@/lib/cards/import-fingerprint";
import type { DeckEntrySource, DeckEntryStatus } from "@/types/deck";

// ---------------------------------------------------------------------------
// A deck entry's status (TODO DK2.6, owner vocabulary 2026-10-28) — the ONE
// answer every surface reads: the list's badges and filter, the pop-up, the
// deck's breakdown, the report PDF. Pure and client-safe (the fingerprint is
// its own synchronous SHA-256).
//
// `card` is the entry's PipGlyph card AS THIS VIEWER READ IT: null when the
// entry has none, and also when RLS hides it (another creator's card that
// went private, the owner's own private card in a visitor's view). In order:
//
//   a card the viewer reads
//     with a parent card              → remix (another PipGlyph card's,
//                                       anyone's: cards.parent_card_id)
//     with a tracked import (0144)    → imported while it still prints what
//                                       it was imported as, else edited
//                                       (lib/cards/import-fingerprint.ts)
//     untracked, but the entry knows its printing, or the card names a
//     source printing                 → edited: an import from before 0144
//                                       (the deck's customize flow saved a
//                                       card that stands in for the
//                                       printing), "not tracked" otherwise
//     anything else                   → original
//   a linked card the viewer can't read → edited when the entry has a
//                                       printing, else original: a PipGlyph
//                                       card stands in, unseen
//   no card: a printing               → imported (the real card)
//   no card, no printing              → not_found (a pasted name; also what
//                                       is left of a deleted card — its
//                                       label says "No longer available",
//                                       deckEntryUnavailable)
// ---------------------------------------------------------------------------

export type StatusEntry = {
  scryfall_id: string | null;
  card_id: string | null;
  source?: DeckEntrySource | string | null;
};

export type StatusCard = FingerprintCard &
  ImportProvenanceColumns & {
    parent_card_id?: string | null;
    source_scryfall_id?: string | null;
  };

export function deckEntryStatus(
  entry: StatusEntry,
  card: StatusCard | null | undefined,
): DeckEntryStatus {
  if (card) {
    if (card.parent_card_id) return "remix";
    const importState = importEditStateOf(card);
    if (importState === "unchanged") return "imported";
    if (importState === "edited") return "edited";
    if (entry.scryfall_id || card.source_scryfall_id) return "edited";
    return "original";
  }
  if (entry.card_id) return entry.scryfall_id ? "edited" : "original";
  return entry.scryfall_id ? "imported" : "not_found";
}

/** Which card a deck may link (owner decision D3, TODO DK2.9; the database's
 *  rule, migration 0144): the deck owner's own at any visibility, or
 *  another creator's PUBLIC card — never their private or unlisted one. */
export function canLinkIntoDeck(card: { owner_id: string; visibility: string }, deckOwnerId: string): boolean {
  return card.owner_id === deckOwnerId || card.visibility === "public";
}

/** The sources that bring a PipGlyph CARD into the deck (the RPC's list,
 *  add_custom_deck_entry, migration 0144). */
const CARD_SOURCES: ReadonlySet<string> = new Set(["creator", "link", "ai_generate", "ai_remix"]);

/**
 * Whether the entry's PipGlyph card is "No longer available" (D3, TODO
 * DK2.9): its name stays, the card behind it is gone.
 *   * linked but unreadable — for the deck's OWNER only, who reads every
 *     card of their own: it is another creator's card that went private. (A
 *     visitor can't tell that from the owner's own private card: no label.)
 *   * no card left, no printing, and the entry came WITH a card (its source
 *     says so) — the card was deleted (0055's ON DELETE SET NULL). An entry
 *     written before 0144 has no source and reads as a plain "Not found".
 * An entry with a printing is never unavailable: the real card is still
 * there to show (a deleted AI restyle reverts to its printing).
 */
export function deckEntryUnavailable(
  entry: StatusEntry,
  card: unknown,
  viewerIsOwner: boolean,
): boolean {
  if (card) return false;
  if (entry.card_id) return viewerIsOwner;
  return !entry.scryfall_id && typeof entry.source === "string" && CARD_SOURCES.has(entry.source);
}
