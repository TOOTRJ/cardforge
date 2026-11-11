import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /admin/analytics — the Revenue tab: it reads the period the address names
// and draws it; a read that failed is said, never drawn as "no revenue".
// (What the panel shows from a summary: tests/unit/components/
// revenue-panel.test.tsx. How a summary is made: tests/unit/admin/
// revenue-queries.test.ts.)
// ---------------------------------------------------------------------------

const loader = vi.hoisted(() => ({ summary: vi.fn() }));

vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));
vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));
vi.mock("@/lib/admin/revenue-queries", async (original) => ({
  ...(await original<typeof import("@/lib/admin/revenue-queries")>()),
  getRevenueSummary: loader.summary,
}));

import { RevenueTab } from "@/components/admin/analytics/tabs/revenue-tab";
import { analyticsPeriod, ADMIN_FILTER_TABS, type AnalyticsParams } from "@/lib/admin/analytics/params";
import { summarizeRevenue, type RevenuePeriod } from "@/lib/admin/revenue-queries";

const params: AnalyticsParams = { tab: "revenue", days: 30, admins: false, tool: null, user: null, page: 1 };
const NOW = new Date("2026-11-10T15:00:00Z");

const payment = (id: string, paidAt: string, cents: number) => ({
  invoice_id: id,
  user_id: "u1",
  amount_cents: cents,
  currency: "usd",
  billing_reason: "subscription_cycle",
  tier: "pro",
  billing_interval: "month",
  paid_at: paidAt,
  invoice_number: null,
  hosted_invoice_url: null,
});

beforeEach(() => {
  loader.summary.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  return () => vi.useRealTimers();
});

describe("RevenueTab", () => {
  it.each([7, 30, 90] as const)("reads the last %i days — the page's own period — and draws it", async (days) => {
    const rows = { payments: [payment("in_1", "2026-11-09T10:00:00Z", 1500), payment("in_old", "2026-01-05T10:00:00Z", 1500)], packs: [] };
    loader.summary.mockImplementation(async (period: RevenuePeriod) => summarizeRevenue(rows, period, new Map([["u1", "payer"]])));
    const out = renderToStaticMarkup(await RevenueTab({ params: { ...params, days } })).replace(/<!-- -->/g, "");
    expect(loader.summary).toHaveBeenCalledTimes(1);
    const period = loader.summary.mock.calls[0][0] as RevenuePeriod;
    expect(period).toEqual(analyticsPeriod(days, NOW));
    expect(period.dayKeys).toHaveLength(days);
    expect(period.dayKeys.at(-1)).toBe("2026-11-10");
    expect(out).toContain("$15.00");
    expect(out).toContain(`vs the previous ${days} days`);
    expect(out).toContain("All time: $30.00 from 2 payments");
    expect(out).toContain("@payer");
    // One column a day of the period.
    expect(out.match(/rounded-t-\[4px\] bg-chart-1/g)).toHaveLength(days);
    expect(out).not.toContain('data-testid="admin-load-error"');
  });

  it("a read that failed says so — never a page of zeros", async () => {
    loader.summary.mockResolvedValue(null);
    const out = renderToStaticMarkup(await RevenueTab({ params }));
    expect(out).toContain('data-testid="admin-load-error"');
    expect(out).toContain("Couldn’t load revenue.");
    expect(out).not.toContain("$0.00");
    expect(out).not.toContain("No revenue in this period.");
  });

  it("revenue is money taken whoever paid it: the tab has no admin switch and ignores one in the address", async () => {
    expect(ADMIN_FILTER_TABS).not.toContain("revenue");
    loader.summary.mockResolvedValue(summarizeRevenue({ payments: [], packs: [] }, analyticsPeriod(30, NOW)));
    await RevenueTab({ params: { ...params, admins: true } });
    expect(loader.summary.mock.calls[0]).toHaveLength(1);
  });

  it("the dead 'capped' total is gone from the reader, the panel and the summary", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    for (const path of ["lib/admin/revenue-queries.ts", "components/admin/revenue-panel.tsx"]) {
      expect(read(path), path).not.toMatch(/allTimeCapped|const capped\b|All time \(newest/);
    }
    // The paged reads still stop at the safety cap (a longer log is a failed read).
    expect(read("lib/admin/revenue-queries.ts")).toContain("const paged = { maxRows: REVENUE_ROW_CAP };");
  });
});
