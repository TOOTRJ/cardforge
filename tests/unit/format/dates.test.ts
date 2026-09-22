import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatRelativeTime, formatShortDate } from "@/lib/format/dates";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");
  it("drops the year inside the current year and keeps it otherwise", () => {
    expect(formatRelativeTime("2026-08-01T12:00:00Z", now)).toBe("Aug 1");
    expect(formatRelativeTime("2025-08-01T12:00:00Z", now)).toBe("Aug 1, 2025");
    expect(formatRelativeTime("2026-09-14T11:30:00Z", now)).toBe("30m ago");
  });
});

describe("formatShortDate", () => {
  it("formats a timestamp as a short date", () => {
    expect(formatShortDate("2026-09-14T12:00:00Z")).toBe("Sep 14, 2026");
  });
  it("never throws on a non-date — Intl would — and returns the fallback", () => {
    expect(formatShortDate("garbage", "—")).toBe("—");
    expect(formatShortDate("garbage")).toBe("garbage");
  });
});

describe("formatCalendarDate", () => {
  it("formats a YYYY-MM-DD frontmatter date in UTC so it never shifts a day", () => {
    expect(formatCalendarDate("2026-09-14")).toBe("September 14, 2026");
    expect(formatCalendarDate("2026-01-01")).toBe("January 1, 2026");
  });
});
