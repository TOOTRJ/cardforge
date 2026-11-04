// ---------------------------------------------------------------------------
// The card page's "most-liked" line (TODO CP3, migration 0168). The database
// ranks PUBLIC cards by the likes OTHER people gave them and says whether
// the place is shared (card_like_standing: 1 + the cards with more, so ties
// share the number); this decides whether the page says it at all and how.
// A rank means something only near the top: within the first
// LIKE_RANK_SHOWN_TOP places and with LIKE_RANK_MIN_LIKES likes or more —
// below that, most cards with a like or two would claim the same place. A
// shared place says so ("Tied for #2").
// ---------------------------------------------------------------------------

export type LikeStanding = { rank: number; tied: boolean; likes: number };

export const LIKE_RANK_SHOWN_TOP = 50;
export const LIKE_RANK_MIN_LIKES = 3;

/** The words the page shows for a card's standing, or null when it shows
 *  none. */
export function likeStandingText(standing: LikeStanding | null): string | null {
  if (!standing) return null;
  const { rank, tied, likes } = standing;
  if (!Number.isInteger(rank) || rank < 1 || rank > LIKE_RANK_SHOWN_TOP) return null;
  if (likes < LIKE_RANK_MIN_LIKES) return null;
  return tied ? `Tied for #${rank} most-liked card` : `#${rank} most-liked card`;
}
