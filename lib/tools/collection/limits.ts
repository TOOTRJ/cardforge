// ---------------------------------------------------------------------------
// The Collection Deck Builder's numbers (migration 0185). Client-safe.
//
// COLLECTION_CARD_CAP mirrors SQL `public.collection_card_cap()` — the
// database enforces it (the `collection_cards_enforce_cap` trigger), the app
// writes only what fits and says so. A unit test holds the two equal; change
// both together (owner 2026-11-06: about 25,000 DIFFERENT cards a user —
// quantity never counts, every printing / finish / language is its own).
//
// A collection never counts toward the saved-card limit (CARD_CAPACITY):
// a slot is something you designed.
// ---------------------------------------------------------------------------

export const COLLECTION_TOOL_SLUG = "collection-builder" as const;

/** Different cards (rows) one user's collection may hold. */
export const COLLECTION_CARD_CAP = 25_000;

/** Copies of one printing in one finish and language (the column's CHECK). */
export const MAX_COLLECTION_QUANTITY = 9_999;

/** A file or paste the import reads at most (characters). A 25,000-row
 *  ManaBox export is about 4 MB. */
export const MAX_IMPORT_CHARS = 6_000_000;

/** Lines one import reads at most (a little past the cap: duplicates and
 *  lines that won't match are common). */
export const MAX_IMPORT_LINES = 30_000;

/** Lines the browser sends the server per request: 4 Scryfall collection
 *  calls (75 each) at Scryfall's 2 a second, plus a fallback pass — a few
 *  seconds a request. */
export const IMPORT_CHUNK_LINES = 300;

/** The collection page's grid. */
export const COLLECTION_PAGE_SIZE = 60;

/** A Commander deck: the commander and 99. */
export const COMMANDER_DECK_SIZE = 100;
