import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import { REVENUE_RECENT_LIMIT, summarizeRevenue } from "@/lib/admin/revenue-queries";

const now = Date.parse("2026-09-23T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const row = (id: string, daysAgo: number, cents: number, userId: string | null = "u1") => ({
  invoice_id: id,
  user_id: userId,
  amount_cents: cents,
  currency: "usd",
  billing_reason: "subscription_cycle",
  tier: "pro",
  billing_interval: "month",
  paid_at: new Date(now - daysAgo * day).toISOString(),
  invoice_number: `N-${id}`,
  hosted_invoice_url: null,
});

describe("summarizeRevenue", () => {
  it("totals the last 30 days and all time, and lists the newest payments with usernames", () => {
    const rows = [row("a", 1, 1500), row("b", 29, 600), row("c", 31, 1500), row("d", 200, 2400, null)];
    const summary = summarizeRevenue(rows, new Map([["u1", "priya"]]), now);
    expect(summary).toMatchObject({ last30DaysCents: 2100, last30DaysCount: 2, allTimeCents: 6000, allTimeCount: 4 });
    expect(summary.recent.map((p) => p.invoiceId)).toEqual(["a", "b", "c", "d"]);
    expect(summary.recent[0]).toMatchObject({ username: "priya", amountCents: 1500, tier: "pro", interval: "month" });
    expect(summary.recent[3]).toMatchObject({ userId: null, username: null });
  });

  it("caps the recent list", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row(`i${i}`, i, 100));
    expect(summarizeRevenue(rows, new Map(), now).recent).toHaveLength(REVENUE_RECENT_LIMIT);
  });
});
