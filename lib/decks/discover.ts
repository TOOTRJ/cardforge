// ---------------------------------------------------------------------------
// "Discover" on /decks (owner request 2026-11-03) — the gallery's Discover
// draw (lib/cards/discover.ts) over public decks, in place of the old
// "Newest public decks" row (which ordered by updated_at: every edit moved
// a deck to the front).
//
// The ranking runs in SQL (migration 0167, list_discover_decks):
//   weight = size · (1 + 2·ln(1 + 0.05·views + 1·likes))
//   size   = 3 for a deck of 10 or more cards (the stored card_count — the
//            maybeboard never counts), else 1
//   key    = −ln(u) / weight, u uniform in (0, 1) from deck id + seed
//   order by key ascending (Efraimidis–Spirakis weighted sampling)
// A heavier deck comes up earlier more often; every non-empty deck can come
// up. The pool is trending's: public, non-empty, a real creator's
// (owner_is_creator, 0149). `deckDiscoverWeight` mirrors the SQL so the
// weighting is unit-tested and documented in one place; the seed is the
// gallery's (`discoverSeedNow`), fresh at each ISR bake of the landing.
// ---------------------------------------------------------------------------

/** A deck this size or bigger is weighted up (the owner's "10 or more"). */
export const DISCOVER_BIG_DECK_CARDS = 10;
/** How much more often a big deck comes up, all else equal. */
export const DISCOVER_BIG_DECK_BOOST = 3;

const DECK_DISCOVER_WEIGHTS = { view: 0.05, like: 1 } as const;

export type DeckDiscoverSignals = {
  /** decks.card_count (0143): physical cards, maybeboard out. */
  cards: number;
  views: number;
  likes: number;
};

export function deckDiscoverWeight(s: DeckDiscoverSignals): number {
  const size = s.cards >= DISCOVER_BIG_DECK_CARDS ? DISCOVER_BIG_DECK_BOOST : 1;
  const engagement = DECK_DISCOVER_WEIGHTS.view * s.views + DECK_DISCOVER_WEIGHTS.like * s.likes;
  return size * (1 + 2 * Math.log(1 + Math.max(0, engagement)));
}

/** The landing's Discover grid: one page, the same 24 the browse grid shows. */
export const DISCOVER_DECKS_MAX = 24;
