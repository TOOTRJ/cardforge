// ---------------------------------------------------------------------------
// Deck activity (TODO DK7.4, Pro): a deck's views and likes over the last
// 7 / 30 / 90 days, for its OWNER — pure, over the per-day rows the database
// hands out (0151's deck_views_by_day, 0154's deck_likes_by_day: every UTC
// day of a span, oldest first, zeros included).
//
// The action asks for TWICE the period so one read gives both the period
// and the one before it: the last `days` rows are "this period", the
// `days` before them "the previous period", and the change is between their
// totals. Whatever the rows hold, the series is rebuilt day by day from
// `today` back (a missing day is 0, a day outside the span is dropped), so a
// short or reordered answer can't shift a bar onto the wrong date.
//
// What a bar is: one day on 7 and 30 days; on 90 a WEEK (13 bars of 7 days,
// the last ending today — 91 days would leave a 1-day stub, so the first bar
// of 90 covers 6 days). The table twin lists the same bars.
//
// Clones are not counted: "Clone deck" is DK5.16 and nothing records one yet.
// ---------------------------------------------------------------------------

export const ACTIVITY_PERIODS = [7, 30, 90] as const;
export type ActivityPeriod = (typeof ACTIVITY_PERIODS)[number];
export const DEFAULT_ACTIVITY_PERIOD: ActivityPeriod = 30;

export function isActivityPeriod(value: unknown): value is ActivityPeriod {
  return typeof value === "number" && (ACTIVITY_PERIODS as readonly number[]).includes(value);
}

export type ActivityMetric = "views" | "likes";
export const ACTIVITY_METRICS: readonly ActivityMetric[] = ["views", "likes"];

/** One row as the database returns it: a UTC day (YYYY-MM-DD) and its count. */
export type DayCount = { day: string; count: number };

/** One bar: the days it covers (inclusive, UTC) and their count. */
export type ActivityBucket = { start: string; end: string; count: number };

export type ActivityChange =
  | { kind: "none" } // both periods empty
  | { kind: "new" } // nothing before, something now
  | { kind: "change"; delta: number; percent: number };

export type ActivitySeries = {
  metric: ActivityMetric;
  days: ActivityPeriod;
  total: number;
  previousTotal: number;
  change: ActivityChange;
  /** The bars, oldest first. */
  buckets: ActivityBucket[];
  /** Days per bar (1, or 7 on 90 days). */
  bucketDays: number;
};

export type DeckActivity = {
  days: ActivityPeriod;
  /** The last day of the period (UTC, YYYY-MM-DD). */
  today: string;
  views: ActivitySeries;
  likes: ActivitySeries;
};

const DAY_MS = 86_400_000;

/** A UTC calendar day as YYYY-MM-DD. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `day` moved by `offset` whole days (UTC). */
export function addDays(day: string, offset: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS));
}

/** The span the action reads: the period and the one before it. */
export function activityReadDays(days: ActivityPeriod): number {
  return days * 2;
}

/** Days per bar for a period. */
export function bucketDaysFor(days: ActivityPeriod): number {
  return days === 90 ? 7 : 1;
}

/** The change from the previous period's total to this one's. */
export function activityChange(total: number, previousTotal: number): ActivityChange {
  if (previousTotal <= 0) return total > 0 ? { kind: "new" } : { kind: "none" };
  const delta = total - previousTotal;
  return { kind: "change", delta, percent: Math.round((delta / previousTotal) * 100) };
}

/** The change in words: "+25%", "−40%", "No change", "New", "—". */
export function activityChangeLabel(change: ActivityChange): string {
  if (change.kind === "none") return "—";
  if (change.kind === "new") return "New";
  if (change.delta === 0) return "No change";
  const sign = change.delta > 0 ? "+" : "−";
  const percent = Math.abs(change.percent);
  return `${sign}${percent === 0 ? "<1" : percent}%`;
}

/** The change as a sentence for a screen reader and the tile's title. */
export function activityChangeSentence(change: ActivityChange, previousTotal: number, days: ActivityPeriod): string {
  const previous = `the previous ${days} days`;
  if (change.kind === "none") return `None in ${previous} either.`;
  if (change.kind === "new") return `None in ${previous}.`;
  if (change.delta === 0) return `The same as ${previous} (${previousTotal}).`;
  const direction = change.delta > 0 ? "up" : "down";
  return `${activityChangeLabel(change).replace(/^[+−]/, "")} ${direction} on ${previous} (${previousTotal}).`;
}

/** Day → count over the rows, a malformed row dropped, a repeated day summed. */
function countsByDay(rows: readonly DayCount[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.day !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(row.day)) continue;
    const n = Number(row.count);
    if (!Number.isFinite(n) || n <= 0) continue;
    const day = row.day.slice(0, 10);
    out.set(day, (out.get(day) ?? 0) + Math.round(n));
  }
  return out;
}

/** One metric's series for the period ending `today`. */
export function buildActivitySeries(
  metric: ActivityMetric,
  rows: readonly DayCount[],
  days: ActivityPeriod,
  today: string,
): ActivitySeries {
  const counts = countsByDay(rows);
  const first = addDays(today, -(days - 1));
  let total = 0;
  let previousTotal = 0;
  for (let offset = 0; offset < days; offset++) {
    total += counts.get(addDays(first, offset)) ?? 0;
    previousTotal += counts.get(addDays(first, -(offset + 1))) ?? 0;
  }

  const bucketDays = bucketDaysFor(days);
  const buckets: ActivityBucket[] = [];
  // Bars are cut from the END (today) back, so the last bar is always a
  // whole one; the first takes what's left.
  for (let end = today; end >= first; end = addDays(end, -bucketDays)) {
    const startCandidate = addDays(end, -(bucketDays - 1));
    const start = startCandidate < first ? first : startCandidate;
    let count = 0;
    for (let day = start; day <= end; day = addDays(day, 1)) count += counts.get(day) ?? 0;
    buckets.unshift({ start, end, count });
  }

  return {
    metric,
    days,
    total,
    previousTotal,
    change: activityChange(total, previousTotal),
    buckets,
    bucketDays,
  };
}

/** Both series for a period, from the two functions' raw rows. */
export function buildDeckActivity(
  input: { views: readonly DayCount[]; likes: readonly DayCount[] },
  days: ActivityPeriod,
  today: string,
): DeckActivity {
  return {
    days,
    today,
    views: buildActivitySeries("views", input.views, days, today),
    likes: buildActivitySeries("likes", input.likes, days, today),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 29" — a UTC day, short (the same on server and client: no locale). */
export function shortDayLabel(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${date}`;
}

/** A bar's dates: "Oct 29", or "Oct 23 – Oct 29" for a week. */
export function bucketLabel(bucket: ActivityBucket): string {
  return bucket.start === bucket.end ? shortDayLabel(bucket.start) : `${shortDayLabel(bucket.start)} – ${shortDayLabel(bucket.end)}`;
}

export const ACTIVITY_METRIC_LABELS: Record<ActivityMetric, { title: string; one: string; many: string }> = {
  views: { title: "Views", one: "view", many: "views" },
  likes: { title: "Likes", one: "like", many: "likes" },
};

export function countNoun(metric: ActivityMetric, count: number): string {
  const label = ACTIVITY_METRIC_LABELS[metric];
  return `${count} ${count === 1 ? label.one : label.many}`;
}
