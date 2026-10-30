import { describe, expect, it } from "vitest";
import {
  activityChange,
  activityChangeLabel,
  activityChangeSentence,
  activityReadDays,
  addDays,
  bucketLabel,
  buildActivitySeries,
  buildDeckActivity,
  isActivityPeriod,
  type DayCount,
} from "@/lib/decks/deck-activity";

// ---------------------------------------------------------------------------
// Deck activity's period maths (TODO DK7.4): one read of twice the period,
// split into this period and the one before; bars of a day (7 / 30) or a
// week cut back from today (90); the change between the two totals.
// ---------------------------------------------------------------------------

const TODAY = "2026-10-29";

/** A full answer as the database gives it: every day of `span`, oldest first. */
function span(days: number, countOf: (day: string, index: number) => number): DayCount[] {
  const first = addDays(TODAY, -(days - 1));
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(first, i);
    return { day, count: countOf(day, i) };
  });
}

describe("periods and days", () => {
  it("knows its three periods and reads twice each", () => {
    expect([7, 30, 90].every(isActivityPeriod)).toBe(true);
    expect(isActivityPeriod(14)).toBe(false);
    expect(isActivityPeriod("30")).toBe(false);
    expect(activityReadDays(90)).toBe(180);
  });

  it("moves UTC days across a month and a year", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30"); // a DST weekend in Europe: UTC has none
  });
});

describe("buildActivitySeries", () => {
  it("splits the read into this period and the previous one", () => {
    // 14 days: the first 7 hold 1 each, the last 7 hold 2 each.
    const rows = span(14, (_, i) => (i < 7 ? 1 : 2));
    const series = buildActivitySeries("views", rows, 7, TODAY);
    expect(series.total).toBe(14);
    expect(series.previousTotal).toBe(7);
    expect(series.change).toEqual({ kind: "change", delta: 7, percent: 100 });
    expect(series.buckets).toHaveLength(7);
    expect(series.buckets[0]).toEqual({ start: "2026-10-23", end: "2026-10-23", count: 2 });
    expect(series.buckets.at(-1)).toEqual({ start: TODAY, end: TODAY, count: 2 });
  });

  it("fills a missing day with 0, sums a repeated one and drops days outside the span", () => {
    const rows: DayCount[] = [
      { day: TODAY, count: 3 },
      { day: TODAY, count: 1 },
      { day: "2026-10-27", count: 2 },
      { day: "2026-09-01", count: 50 }, // outside 2 × 7
      { day: "2026-11-02", count: 50 }, // after today
      { day: "not a day", count: 9 },
    ];
    const series = buildActivitySeries("likes", rows, 7, TODAY);
    expect(series.total).toBe(6);
    expect(series.previousTotal).toBe(0);
    expect(series.buckets.map((b) => b.count)).toEqual([0, 0, 0, 0, 2, 0, 4]);
  });

  it("is the same whatever order the rows come in", () => {
    const rows = span(60, (_, i) => i % 5);
    const forward = buildActivitySeries("views", rows, 30, TODAY);
    const backward = buildActivitySeries("views", [...rows].reverse(), 30, TODAY);
    expect(backward).toEqual(forward);
  });

  it("draws 90 days as 13 weeks ending today, the first one short", () => {
    const rows = span(180, () => 1);
    const series = buildActivitySeries("views", rows, 90, TODAY);
    expect(series.bucketDays).toBe(7);
    expect(series.buckets).toHaveLength(13);
    expect(series.buckets.at(-1)).toEqual({ start: "2026-10-23", end: TODAY, count: 7 });
    expect(series.buckets[0].start).toBe(addDays(TODAY, -89));
    expect(series.buckets[0].count).toBe(6);
    expect(series.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(series.total);
    expect(series.total).toBe(90);
    expect(series.previousTotal).toBe(90);
  });

  it("draws 30 days as 30 one-day bars whose sum is the total", () => {
    const series = buildActivitySeries("views", span(60, (_, i) => i), 30, TODAY);
    expect(series.buckets).toHaveLength(30);
    expect(series.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(series.total);
  });

  it("builds both series from the two functions' rows", () => {
    const activity = buildDeckActivity({ views: span(14, () => 1), likes: [] }, 7, TODAY);
    expect(activity.views.total).toBe(7);
    expect(activity.likes.total).toBe(0);
    expect(activity.likes.change).toEqual({ kind: "none" });
  });
});

describe("the change", () => {
  it("says new, none, the same, up and down", () => {
    expect(activityChange(0, 0)).toEqual({ kind: "none" });
    expect(activityChange(4, 0)).toEqual({ kind: "new" });
    expect(activityChange(5, 5)).toEqual({ kind: "change", delta: 0, percent: 0 });
    expect(activityChange(3, 4)).toEqual({ kind: "change", delta: -1, percent: -25 });
    expect(activityChangeLabel(activityChange(0, 0))).toBe("—");
    expect(activityChangeLabel(activityChange(4, 0))).toBe("New");
    expect(activityChangeLabel(activityChange(5, 5))).toBe("No change");
    expect(activityChangeLabel(activityChange(6, 4))).toBe("+50%");
    expect(activityChangeLabel(activityChange(3, 4))).toBe("−25%");
    expect(activityChangeLabel(activityChange(1001, 1000))).toBe("+<1%");
  });

  it("says it in a sentence for a screen reader", () => {
    expect(activityChangeSentence(activityChange(6, 4), 4, 30)).toBe("50% up on the previous 30 days (4).");
    expect(activityChangeSentence(activityChange(3, 4), 4, 7)).toBe("25% down on the previous 7 days (4).");
    expect(activityChangeSentence(activityChange(2, 0), 0, 7)).toBe("None in the previous 7 days.");
  });

  it("labels a bar by its dates", () => {
    expect(bucketLabel({ start: TODAY, end: TODAY, count: 1 })).toBe("Oct 29");
    expect(bucketLabel({ start: "2026-10-23", end: TODAY, count: 1 })).toBe("Oct 23 – Oct 29");
  });
});
