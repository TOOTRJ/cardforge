// ---------------------------------------------------------------------------
// Trending cards — "Hot this week / month / year / all time".
//
// The SCORE lives in ONE place, the database: migration 0166's
// list_trending_cards(range, limit). Per public card of a real creator, every
// engagement event in the range — one per person per card per kind, the
// card owner's own never — weighted by kind and decayed by its age:
//
//     score = Σ TRENDING_WEIGHTS[kind] · 0.5 ^ (age_days / half_life)
//
// then one card per creator, ties by distinct people → lifetime likes →
// newest → id. A card with no event in the range is not hot: the row may be
// short or empty, never padded. This module is the app's vocabulary for it
// (the ranges, their words) and a mirror of the SQL's numbers that the unit
// test holds to the migration — change both together.
// ---------------------------------------------------------------------------

export const TRENDING_RANGES = ["week", "month", "year", "all"] as const;
export type TrendingRange = (typeof TRENDING_RANGES)[number];

/** The gallery's default (owner 2026-11-03). */
export const DEFAULT_TRENDING_RANGE: TrendingRange = "month";

/** Mirror of 0166's weights (unchanged from the in-app score it replaced). */
export const TRENDING_WEIGHTS = {
  like: 3,
  comment: 2,
  remix: 4,
} as const;

/** Mirror of 0166's windows and half-lives; `null` = every event, no decay. */
export const TRENDING_RANGE_RULES: Record<
  TrendingRange,
  { windowDays: number | null; halfLifeDays: number | null }
> = {
  week: { windowDays: 7, halfLifeDays: 3 },
  month: { windowDays: 30, halfLifeDays: 10 },
  year: { windowDays: 365, halfLifeDays: 90 },
  all: { windowDays: null, halfLifeDays: null },
};

/** The words a range prints: the tab, the heading, the tiles' "this …". */
export const TRENDING_RANGE_WORDS: Record<
  TrendingRange,
  { tab: string; heading: string; period: string; empty: string }
> = {
  week: {
    tab: "Week",
    heading: "Hot this week",
    period: "this week",
    empty: "Nothing has heated up this week yet.",
  },
  month: {
    tab: "Month",
    heading: "Hot this month",
    period: "this month",
    empty: "Nothing has heated up this month yet.",
  },
  year: {
    tab: "Year",
    heading: "Hot this year",
    period: "this year",
    empty: "Nothing has heated up this year yet.",
  },
  all: {
    tab: "All time",
    heading: "Hottest of all time",
    period: "all time",
    empty: "No card has been liked, discussed or remixed yet.",
  },
};

export function isTrendingRange(value: unknown): value is TrendingRange {
  return typeof value === "string" && (TRENDING_RANGES as readonly string[]).includes(value);
}

/** One event's weight at `ageDays` in `range` — the SQL's term, for tests
 *  and for anyone reasoning about the order. */
export function trendingEventWeight(
  kind: keyof typeof TRENDING_WEIGHTS,
  ageDays: number,
  range: TrendingRange,
): number {
  const { windowDays, halfLifeDays } = TRENDING_RANGE_RULES[range];
  if (windowDays !== null && ageDays > windowDays) return 0;
  const decay = halfLifeDays === null ? 1 : 0.5 ** (Math.max(ageDays, 0) / halfLifeDays);
  return TRENDING_WEIGHTS[kind] * decay;
}

/** A card created this recently wears the "fresh" velocity badge on its
 *  page (getCardTrendingSignals) — a badge only, never part of the score. */
export const TRENDING_FRESHNESS_WINDOW_DAYS = 3;
