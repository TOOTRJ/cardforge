import { describe, expect, it } from "vitest";
import { changeOf, changeText, countByDay, fillDays, formatCount, formatMoney, formatRate, utcDayKey } from "@/lib/admin/analytics/series";

// ---------------------------------------------------------------------------
// The analytics tabs' shared arithmetic: a zero-filled day series, a change
// against the previous period, and how a number is written.
// ---------------------------------------------------------------------------

const DAYS = ["2026-11-09", "2026-11-10", "2026-11-11"];

describe("a day series", () => {
  it("has one point per day of the period, 0 where nothing happened", () => {
    expect(fillDays(DAYS, [{ day: "2026-11-10", value: 4 }])).toEqual([
      { day: "2026-11-09", value: 0 },
      { day: "2026-11-10", value: 4 },
      { day: "2026-11-11", value: 0 },
    ]);
  });

  it("adds up several rows of one day, reads a timestamp's day, and leaves out days outside the period", () => {
    expect(
      fillDays(DAYS, [
        { day: "2026-11-11", value: 2 },
        { day: "2026-11-11T08:00:00+00:00", value: 3 },
        { day: "2026-11-01", value: 99 },
        { day: "2026-11-09", value: Number.NaN },
      ]).map((p) => p.value),
    ).toEqual([0, 0, 5]);
  });

  it("counts timestamps by their UTC day — 23:30 in New York is already tomorrow", () => {
    expect(utcDayKey("2026-11-10T23:30:00-05:00")).toBe("2026-11-11");
    expect(countByDay(DAYS, ["2026-11-10T01:00:00Z", "2026-11-10T23:59:59Z", "2026-11-10T23:30:00-05:00"]).map((p) => p.value)).toEqual([0, 2, 1]);
  });
});

describe("a change against the previous period", () => {
  it.each([
    [150, 100, "+50%"],
    [92, 100, "−8%"],
    [103, 100, "+3%"],
    [100.4, 100, "+0.4%"],
    [5, 0, "new"],
    [0, 0, "no change"],
    [7, 7, "no change"],
    [0, 4, "−100%"],
  ])("%d against %d reads %s", (current, previous, text) => {
    expect(changeText(changeOf(current, previous))).toBe(text);
  });

  it("says which way it went, and never divides by nothing", () => {
    expect(changeOf(5, 0)).toEqual({ ratio: null, direction: "up" });
    expect(changeOf(0, 0)).toEqual({ ratio: null, direction: "flat" });
    expect(changeOf(1, 4).direction).toBe("down");
  });
});

describe("how numbers are written", () => {
  it("counts in full, rates with one decimal under 10%, and '—' when there is nothing to divide by", () => {
    expect(formatCount(12840)).toBe("12,840");
    expect(formatRate(109, 174)).toBe("63%");
    expect(formatRate(3, 174)).toBe("1.7%");
    expect(formatRate(0, 174)).toBe("0%");
    expect(formatRate(4, 0)).toBe("—");
  });

  it("money in the payment's own currency, from cents", () => {
    expect(formatMoney(128450, "usd")).toBe("$1,284.50");
    expect(formatMoney(900, "EUR")).toBe("€9.00");
    expect(formatMoney(100, "not-a-currency")).toBe("1.00 NOT-A-CURRENCY");
  });
});
