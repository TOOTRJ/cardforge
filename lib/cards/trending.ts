// ---------------------------------------------------------------------------
// Trending scoring — quantifies "hot this week" for a card.
//
// Score = w_like * likes_7d
//       + w_comment * comments_7d
//       + w_remix * remixes_7d
//       + w_fresh * (created within the freshness window ? 1 : 0)
//
// Engagement counts EXCLUDE actions by the card's own owner (a user liking
// or commenting on their own card isn't an external signal). Remix counts
// only fold in children whose owner differs from the parent's owner.
//
// Weights live here so they're (a) tunable in one place and (b) directly
// referenceable from the unit test that locks the formula in.
// ---------------------------------------------------------------------------

export const TRENDING_WINDOW_DAYS = 7;
export const TRENDING_FRESHNESS_WINDOW_DAYS = 3;

export const TRENDING_WEIGHTS = {
  like: 3,
  comment: 2,
  remix: 4,
  freshness: 5,
} as const;

export type TrendingSignals = {
  likes_7d: number;
  comments_7d: number;
  remixes_7d: number;
  is_fresh: boolean;
};

export function trendingScore(signals: TrendingSignals): number {
  return (
    TRENDING_WEIGHTS.like * signals.likes_7d +
    TRENDING_WEIGHTS.comment * signals.comments_7d +
    TRENDING_WEIGHTS.remix * signals.remixes_7d +
    (signals.is_fresh ? TRENDING_WEIGHTS.freshness : 0)
  );
}

export type TrendingRanked<T> = {
  card: T;
  score: number;
  likesTotal: number;
  createdAt: string;
};

/**
 * Stable trending sort with tiebreakers: score desc → total likes desc →
 * created_at desc. Exposed so the unit test can hit it without standing up
 * a Supabase fixture.
 */
export function sortTrending<T>(
  rows: ReadonlyArray<TrendingRanked<T>>,
): TrendingRanked<T>[] {
  return [...rows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.likesTotal !== a.likesTotal) return b.likesTotal - a.likesTotal;
    return (
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  });
}
