// ---------------------------------------------------------------------------
// Similar decks (TODO DK5.16) — the rule migration 0164's
// list_similar_decks() states, in words and numbers the app shares (a test
// holds the SQL to them): for a PUBLIC deck, other public non-empty decks of
// real creators that share its commander, or its colour identity and at
// least SIMILAR_DECKS_MIN_SHARED cards — matched only by what every visitor
// reads (a printing by its real card's name, a public PipGlyph card by its
// id), never a basic land, the sideboard or the maybeboard. The deck page's
// row (components/decks/similar-decks-row.tsx) reads it cookie-free and is
// hidden when nothing is similar.
// ---------------------------------------------------------------------------

/** Cards two decks of one colour identity share before they are "similar". */
export const SIMILAR_DECKS_MIN_SHARED = 4;

/** How many the row asks for (one row of tiles). */
export const SIMILAR_DECKS_LIMIT = 4;
