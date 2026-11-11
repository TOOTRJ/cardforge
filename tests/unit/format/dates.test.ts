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

// 2026-11-11: the date it prints from a week on was in the RUNTIME's zone —
// UTC on the server, the reader's in the browser — so one notification was
// "Oct 30" in the HTML and "Oct 29" in a Mountain-time browser: React's
// hydration error #418. The zone is now the caller's to name.
describe("formatRelativeTime — the zone of the date it prints", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const evening = "2026-10-30T05:23:51Z"; // 23:23 on Oct 29 in Denver

  it("prints the day of the zone it is given", () => {
    expect(formatRelativeTime(evening, now, "UTC")).toBe("Oct 30");
    expect(formatRelativeTime(evening, now, "America/Denver")).toBe("Oct 29");
    expect(formatRelativeTime(evening, now, "Asia/Tokyo")).toBe("Oct 30");
  });

  it("decides “this year” in that zone too", () => {
    const newYear = Date.parse("2026-01-10T12:00:00Z");
    const lastMinutes = "2025-12-31T23:30:00Z"; // already Jan 1, 2026 in Tokyo
    expect(formatRelativeTime(lastMinutes, newYear, "UTC")).toBe("Dec 31, 2025");
    expect(formatRelativeTime(lastMinutes, newYear, "Asia/Tokyo")).toBe("Jan 1");
  });

  it("the zone changes nothing under a week — only the clock is read", () => {
    const recent = "2026-11-08T05:00:00Z";
    for (const zone of ["UTC", "America/Denver", "Asia/Tokyo", undefined]) {
      expect(formatRelativeTime(recent, now, zone)).toBe("2d ago");
    }
  });

  it("with no zone it is the runtime's own, as it always was", () => {
    const runtime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(evening));
    expect(formatRelativeTime(evening, now)).toBe(runtime);
    expect(formatRelativeTime("not a date", now, "UTC")).toBe("not a date");
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
