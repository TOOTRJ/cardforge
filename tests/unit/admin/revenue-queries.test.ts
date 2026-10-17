import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import {
  REVENUE_RECENT_LIMIT,
  summarizeRevenue,
  type PackPaymentRow,
  type PaymentRow,
} from "@/lib/admin/revenue-queries";

const now = Date.parse("2026-09-23T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
const row = (
  id: string,
  daysAgo: number,
  cents: number,
  userId: string | null = "u1",
  extra: Partial<PaymentRow> = {},
): PaymentRow => ({
  invoice_id: id,
  user_id: userId,
  amount_cents: cents,
  currency: "usd",
  billing_reason: "subscription_cycle",
  tier: "pro",
  billing_interval: "month",
  paid_at: at(daysAgo),
  invoice_number: `N-${id}`,
  hosted_invoice_url: null,
  ...extra,
});
const pack = (id: string, daysAgo: number, cents: number, extra: Partial<PackPaymentRow> = {}): PackPaymentRow => ({
  checkout_session_id: id,
  user_id: "u2",
  amount_cents: cents,
  currency: "usd",
  pack: "small",
  credits: 30,
  paid_at: at(daysAgo),
  ...extra,
});
const summarize = (
  input: Parameters<typeof summarizeRevenue>[0],
  usernames = new Map<string, string | null>(),
) => summarizeRevenue(input, usernames, now);

describe("summarizeRevenue", () => {
  it("totals the last 30 days and all time, and lists the newest payments with usernames", () => {
    const payments = [row("a", 1, 1500), row("b", 29, 600), row("c", 31, 1500), row("d", 200, 2400, null)];
    const summary = summarize({ payments, packs: [] }, new Map([["u1", "priya"]]));
    expect(summary.last30Days).toEqual([{ currency: "usd", cents: 2100, count: 2 }]);
    expect(summary.allTime).toEqual([{ currency: "usd", cents: 6000, count: 4 }]);
    expect(summary).toMatchObject({ last30DaysCount: 2, allTimeCount: 4, trialStarts: 0, allTimeCapped: false });
    expect(summary.recent.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
    expect(summary.recent[0]).toMatchObject({ kind: "invoice", username: "priya", amountCents: 1500, tier: "pro", interval: "month" });
    expect(summary.recent[3]).toMatchObject({ userId: null, username: null });
  });

  it("counts credit packs in every total, beside invoices, and lists them by date", () => {
    const payments = [row("in_a", 2, 1500), row("in_old", 40, 600)];
    const packs = [pack("cs_1", 1, 800), pack("cs_2", 10, 1920, { pack: "large", credits: 100 }), pack("cs_old", 60, 400)];
    const summary = summarize({ payments, packs });
    expect(summary.last30Days).toEqual([{ currency: "usd", cents: 1500 + 800 + 1920, count: 3 }]);
    expect(summary.allTime).toEqual([{ currency: "usd", cents: 1500 + 600 + 800 + 1920 + 400, count: 5 }]);
    expect(summary).toMatchObject({ last30DaysCount: 3, allTimeCount: 5 });
    expect(summary.recent.map((p) => `${p.kind}:${p.id}`)).toEqual([
      "pack:cs_1",
      "invoice:in_a",
      "pack:cs_2",
      "invoice:in_old",
      "pack:cs_old",
    ]);
    expect(summary.recent[2]).toMatchObject({ pack: "large", credits: 100, amountCents: 1920, invoiceNumber: null });
  });

  it("lists a $0 trial invoice as a trial start and leaves it out of every total and count", () => {
    const payments = [
      row("in_trial", 1, 0, "u3", { billing_reason: "subscription_create" }),
      row("in_paid", 3, 1500),
    ];
    const summary = summarize({ payments, packs: [] });
    expect(summary.last30Days).toEqual([{ currency: "usd", cents: 1500, count: 1 }]);
    expect(summary.allTime).toEqual([{ currency: "usd", cents: 1500, count: 1 }]);
    expect(summary).toMatchObject({ last30DaysCount: 1, allTimeCount: 1, trialStarts: 1 });
    expect(summary.recent.map((p) => [p.id, p.kind])).toEqual([
      ["in_trial", "trial_start"],
      ["in_paid", "invoice"],
    ]);
  });

  it("a $0 invoice that is not a plan's first (a 100 %-off renewal) is 'no charge', never counted", () => {
    const summary = summarize({ payments: [row("in_free", 1, 0)], packs: [pack("cs_free", 1, 0)] });
    expect(summary.allTime).toEqual([]);
    expect(summary.last30Days).toEqual([]);
    expect(summary).toMatchObject({ allTimeCount: 0, last30DaysCount: 0, trialStarts: 0 });
    expect(summary.recent.map((p) => p.kind)).toEqual(["no_charge", "no_charge"]);
  });

  it("an only-trials log totals nothing (no averages over zero-dollar rows)", () => {
    const payments = [1, 2, 3].map((d) => row(`t${d}`, d, 0, "u1", { billing_reason: "subscription_create" }));
    const summary = summarize({ payments, packs: [] });
    expect(summary).toMatchObject({ last30Days: [], allTime: [], last30DaysCount: 0, allTimeCount: 0, trialStarts: 3 });
    expect(summary.recent).toHaveLength(3);
  });

  it("never adds amounts across currencies: one total per currency, USD first", () => {
    const payments = [row("in_eur", 1, 1200, "u1", { currency: "eur" }), row("in_usd", 2, 1500)];
    const packs = [pack("cs_gbp", 3, 700, { currency: "gbp" }), pack("cs_usd", 4, 800), pack("cs_EUR", 50, 300, { currency: "EUR" })];
    const summary = summarize({ payments, packs });
    expect(summary.last30Days).toEqual([
      { currency: "usd", cents: 2300, count: 2 },
      { currency: "eur", cents: 1200, count: 1 },
      { currency: "gbp", cents: 700, count: 1 },
    ]);
    expect(summary.allTime).toEqual([
      { currency: "usd", cents: 2300, count: 2 },
      { currency: "eur", cents: 1500, count: 2 },
      { currency: "gbp", cents: 700, count: 1 },
    ]);
    expect(summary).toMatchObject({ last30DaysCount: 4, allTimeCount: 5 });
  });

  it("counts ledger pack grants with no revenue row as unpriced (sold before 0138)", () => {
    const packs = [pack("cs_logged", 1, 800)];
    const packGrants = [
      { idempotency_key: "pack:cs_logged" },
      { idempotency_key: "pack:cs_before_0138" },
      { idempotency_key: "evt_legacy_event_key" },
      { idempotency_key: null },
    ];
    expect(summarize({ payments: [], packs, packGrants }).unpricedPackSales).toBe(3);
    expect(summarize({ payments: [], packs, packGrants: [{ idempotency_key: "pack:cs_logged" }] }).unpricedPackSales).toBe(0);
    // Unknown when the ledger wasn't read, or a log was cut at the cap.
    expect(summarize({ payments: [], packs, packGrants: null }).unpricedPackSales).toBeNull();
    expect(summarize({ payments: [], packs, packGrants, capped: true })).toMatchObject({
      unpricedPackSales: null,
      allTimeCapped: true,
    });
  });

  it("the 30-day window starts at exactly now − 30 days (inclusive), to the millisecond", () => {
    // The dev seed puts a renewal at the seed's own now() − 30 days: any read
    // after the seed ran (a later `now`) leaves it outside — never flaky,
    // since the read can't precede the seed.
    const edge = new Date(now - 30 * day).toISOString();
    const payments = [row("in_edge", 0, 1500, "u1", { paid_at: edge })];
    const read = (ms: number) => summarizeRevenue({ payments, packs: [] }, new Map(), now + ms);
    expect(read(0).last30DaysCount).toBe(1);
    expect(read(1).last30DaysCount).toBe(0);
    expect(read(1000).last30Days).toEqual([]);
    expect(read(1000).allTime).toEqual([{ currency: "usd", cents: 1500, count: 1 }]);
  });

  it("the dev seed's rows give the figures the PR's manual test expects", () => {
    // supabase/seeds/10_dev_data.sql §7, read one second after it ran.
    const payments = [
      row("in_dev_pro_0001", 90, 1500, "p", { billing_reason: "subscription_create" }),
      row("in_dev_pro_0002", 60, 1500, "p"),
      row("in_dev_pro_0003", 30, 1500, "p"),
      row("in_dev_artist_trial", 5, 0, "a", { billing_reason: "subscription_create", tier: "plus" }),
    ];
    const packs = [pack("cs_dev_free_pack_0001", 3, 400), pack("cs_dev_pro_pack_0001", 12, 640)];
    const summary = summarizeRevenue({ payments, packs }, new Map(), now + 1000);
    expect(summary.last30Days).toEqual([{ currency: "usd", cents: 1040, count: 2 }]);
    expect(summary.allTime).toEqual([{ currency: "usd", cents: 5540, count: 5 }]);
    expect(summary.trialStarts).toBe(1);
  });

  it("caps the recent list across both logs", () => {
    const payments = Array.from({ length: 10 }, (_, i) => row(`i${i}`, i * 2, 100));
    const packs = Array.from({ length: 10 }, (_, i) => pack(`p${i}`, i * 2 + 1, 100));
    const summary = summarize({ payments, packs });
    expect(summary.recent).toHaveLength(REVENUE_RECENT_LIMIT);
    expect(summary.recent.map((p) => p.id)).toEqual(["i0", "p0", "i1", "p1", "i2", "p2", "i3", "p3"]);
    expect(summary.allTimeCount).toBe(20);
  });
});
