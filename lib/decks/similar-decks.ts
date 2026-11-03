// ---------------------------------------------------------------------------
// Similar decks (TODO DK5.16) — the rule migration 0164's
// list_similar_decks() states, in words and numbers the app shares (a test
// holds the SQL to them): for a PUBLIC deck, other public non-empty decks of
// real creators that share its commander, or its colour identity and at
// least SIMILAR_DECKS_MIN_SHARED cards — matched only by what every visitor
// reads (a printing by its real card's name, a public PipGlyph card by its
// id), never a basic land, the sideboard, the maybeboard or a STAPLE (a card
// in more than SIMILAR_DECKS_STAPLE_SHARE of the public non-empty decks AND
// in more than SIMILAR_DECKS_STAPLE_MIN_DECKS of them — Sol Ring alone never
// makes two decks similar; a shared commander still does). The deck page's
// row (components/decks/similar-decks-row.tsx) reads it cookie-free, cached
// an hour per deck (listSimilarDecks), and is hidden when nothing is similar.
// ---------------------------------------------------------------------------

/** Cards two decks of one colour identity share before they are "similar". */
export const SIMILAR_DECKS_MIN_SHARED = 4;

/** How many the row asks for (one row of tiles). */
export const SIMILAR_DECKS_LIMIT = 4;

/** A card in more than this share of the public non-empty decks… */
export const SIMILAR_DECKS_STAPLE_SHARE = 0.1;

/** …and in more than this many of them is a staple: it never counts as a
 *  shared card (the floor keeps a small catalogue from calling every card a
 *  staple). */
export const SIMILAR_DECKS_STAPLE_MIN_DECKS = 20;

/** How long a deck's similar decks are kept in Next's data cache. */
export const SIMILAR_DECKS_CACHE_SECONDS = 3_600;

/** The cache tag of every deck's similar decks. */
export const SIMILAR_DECKS_TAG = "similar-decks";
