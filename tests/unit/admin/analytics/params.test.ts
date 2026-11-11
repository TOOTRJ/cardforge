import { describe, expect, it } from "vitest";
import {
  ADMIN_FILTER_TABS,
  ANALYTICS_PATH,
  ANALYTICS_RANGES,
  ANALYTICS_TABS,
  analyticsHref,
  analyticsPeriod,
  parseAnalyticsParams,
  type AnalyticsParams,
} from "@/lib/admin/analytics/params";

// ---------------------------------------------------------------------------
// /admin/analytics — the address is the state (the 2026-11 analytics audit).
// A tab, a period and "Include admins" are links; a view can be bookmarked
// and sent, and nothing a visitor types reaches a query unparsed.
// ---------------------------------------------------------------------------

const USER = "5b0c6c0e-7d0b-4a52-9f3e-0c1d2e3f4a5b";
const base: AnalyticsParams = { tab: "overview", days: 30, admins: false, tool: null, user: null, page: 1 };

describe("parseAnalyticsParams", () => {
  it("the plain page is the Overview, the last 30 days, admins left out", () => {
    expect(parseAnalyticsParams({})).toEqual(base);
  });

  it("reads a whole view from the address", () => {
    expect(parseAnalyticsParams({ tab: "tools", days: "90", admins: "1", tool: "token-kit", user: USER.toUpperCase(), page: "3" })).toEqual({
      tab: "tools",
      days: 90,
      admins: true,
      tool: "token-kit",
      user: USER,
      page: 3,
    });
  });

  it.each([
    [{ tab: "nope" }, { tab: "overview" }],
    [{ days: "365" }, { days: 30 }],
    [{ days: "7; drop table" }, { days: 30 }],
    [{ admins: "yes" }, { admins: false }],
    [{ tool: "Token Kit" }, { tool: null }],
    [{ tool: "../users" }, { tool: null }],
    [{ user: "me" }, { user: null }],
    [{ page: "0" }, { page: 1 }],
    [{ page: "-4" }, { page: 1 }],
    [{ page: "2.5" }, { page: 1 }],
    [{ page: "999999999" }, { page: 1 }],
    [{ tab: ["funnel", "tools"] }, { tab: "funnel" }],
  ])("anything it does not know falls back to the default: %j", (raw, expected) => {
    expect(parseAnalyticsParams(raw as Record<string, string | string[]>)).toMatchObject(expected);
  });

  it("every tab id and every range parses to itself", () => {
    for (const tab of ANALYTICS_TABS) expect(parseAnalyticsParams({ tab: tab.id }).tab).toBe(tab.id);
    for (const days of ANALYTICS_RANGES) expect(parseAnalyticsParams({ days: String(days) }).days).toBe(days);
  });
});

describe("analyticsHref", () => {
  it("leaves defaults out: the plain page has no query", () => {
    expect(analyticsHref(base)).toBe(ANALYTICS_PATH);
    expect(analyticsHref(base, { tab: "funnel" })).toBe("/admin/analytics?tab=funnel");
    expect(analyticsHref(base, { days: 7, admins: true })).toBe("/admin/analytics?days=7&admins=1");
  });

  it("the period and the admin switch follow a visitor from tab to tab", () => {
    const view: AnalyticsParams = { ...base, tab: "funnel", days: 90, admins: true };
    expect(analyticsHref(view, { tab: "tools" })).toBe("/admin/analytics?tab=tools&days=90&admins=1");
  });

  it("changing the tab drops the tab's own selection; changing the tool drops the user", () => {
    const view: AnalyticsParams = { ...base, tab: "tools", tool: "token-kit", user: USER, page: 4 };
    expect(analyticsHref(view, { tab: "revenue" })).toBe("/admin/analytics?tab=revenue");
    expect(analyticsHref(view, { tool: "pip-forge" })).toBe("/admin/analytics?tab=tools&tool=pip-forge");
    expect(analyticsHref(view, { user: null })).toBe("/admin/analytics?tab=tools&tool=token-kit");
  });

  it("anything but a page change goes back to page 1; a page change keeps the view", () => {
    const view: AnalyticsParams = { ...base, tab: "referrals", page: 3 };
    expect(analyticsHref(view, { days: 7 })).toBe("/admin/analytics?tab=referrals&days=7");
    expect(analyticsHref(view, { page: 4 })).toBe("/admin/analytics?tab=referrals&page=4");
    expect(analyticsHref(view, { page: 1 })).toBe("/admin/analytics?tab=referrals");
  });

  it("what it writes, it reads back", () => {
    const view: AnalyticsParams = { tab: "tools", days: 7, admins: true, tool: "re-art-deck", user: USER, page: 2 };
    const url = new URL(analyticsHref(view, { page: 2 }), "http://x");
    expect(parseAnalyticsParams(Object.fromEntries(url.searchParams))).toEqual(view);
  });
});

describe("analyticsPeriod", () => {
  const now = new Date("2026-11-11T15:30:00Z");

  it("is the last N UTC days, today included, starting at a UTC midnight", () => {
    const period = analyticsPeriod(7, now);
    expect(period.since.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    expect(period.until).toBe(now);
    expect(period.dayKeys).toEqual(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  it("is compared with the SAME stretch N days earlier — exactly as long, cut at the same time of day", () => {
    for (const days of ANALYTICS_RANGES) {
      const period = analyticsPeriod(days, now);
      expect(period.dayKeys).toHaveLength(days);
      expect(period.since.getTime() - period.previousSince.getTime()).toBe(days * 86_400_000);
      expect(period.until.getTime() - period.previousUntil.getTime()).toBe(days * 86_400_000);
      // Equal lengths: a steady number reads "no change" at any hour.
      expect(period.previousUntil.getTime() - period.previousSince.getTime()).toBe(period.until.getTime() - period.since.getTime());
    }
    expect(analyticsPeriod(7, now).previousUntil.toISOString()).toBe("2026-11-04T15:30:00.000Z");
  });

  it("never compares a part-day with whole days: in the small hours the 7-day view is 6 days 2 hours against 6 days 2 hours", () => {
    const early = analyticsPeriod(7, new Date("2026-11-11T02:00:00Z"));
    const hours = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;
    expect(hours(early.since, early.until)).toBe(6 * 24 + 2);
    expect(hours(early.previousSince, early.previousUntil)).toBe(6 * 24 + 2);
    // The rest of that earlier day belongs to neither period.
    expect(early.previousUntil.getTime()).toBeLessThan(early.since.getTime());
  });
});

describe("the admin switch", () => {
  it("shows only where it changes a number: revenue is money whoever paid it, a referral is a referral", () => {
    expect([...ADMIN_FILTER_TABS].sort()).toEqual(["content", "credits", "funnel", "overview", "tools"]);
  });
});
