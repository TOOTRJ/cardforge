import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import {
  REVENUE_LIST_LIMIT,
  revenueProductOf,
  summarizeRevenue,
  type PackPaymentRow,
  type PaymentRow,
} from "@/lib/admin/revenue-queries";
import { analyticsPeriod } from "@/lib/admin/analytics/params";

// ---------------------------------------------------------------------------
// The Revenue tab's figures (lib/admin/revenue-queries.ts summarizeRevenue):
// money taken only, a $0 trial start listed and never counted, one total per
// currency, refunds beside the totals — for one PERIOD, the one before it,
// and all time, with a daily series and what was bought.
// ---------------------------------------------------------------------------

// The page's period for "the last 30 days", read at noon UTC on Sep 23:
// [Aug 25 00:00, Sep 23 12:00), compared with the same stretch 30 days
// earlier, cut at the same time of day: [Jul 26 00:00, Aug 24 12:00). The
// rest of Aug 24 — [Aug 24 12:00, Aug 25 00:00) — is in neither.
const NOW = new Date("2026-09-23T12:00:00Z");
const period = analyticsPeriod(30, NOW);
const now = NOW.getTime();
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
  p = period,
) => summarizeRevenue(input, p, usernames);

describe("summarizeRevenue", () => {
  it("totals the period, the one before and all time, and lists the period's payments with usernames", () => {
    const payments = [row("a", 1, 1500), row("b", 29, 600), row("c", 31, 1500), row("d", 200, 2400, null)];
    const summary = summarize({ payments, packs: [] }, new Map([["u1", "priya"]]));
    expect(summary.currencies).toHaveLength(1);
    expect(summary.currencies[0]).toMatchObject({
      currency: "usd",
      cents: 2100,
      count: 2,
      previousCents: 1500,
      previousCount: 1,
      allTimeCents: 6000,
      allTimeCount: 4,
    });
    expect(summary).toMatchObject({ count: 2, previousCount: 1, allTimeCount: 4, trialStarts: 0, entriesTotal: 2 });
    // Only the period's payments are listed, newest first.
    expect(summary.entries.map((p) => p.id)).toEqual(["a", "b"]);
    expect(summary.entries[0]).toMatchObject({ kind: "invoice", username: "priya", amountCents: 1500, tier: "pro", interval: "month" });
  });

  it("the period is [since, until) and the one before [previousSince, previousUntil) — the same stretch 30 days earlier — to the millisecond", () => {
    expect(period.since.toISOString()).toBe("2026-08-25T00:00:00.000Z");
    expect(period.previousSince.toISOString()).toBe("2026-07-26T00:00:00.000Z");
    expect(period.previousUntil.toISOString()).toBe("2026-08-24T12:00:00.000Z");
    // Exactly as long as each other.
    expect(period.previousUntil.getTime() - period.previousSince.getTime()).toBe(period.until.getTime() - period.since.getTime());
    const paidAt = (date: Date, ms = 0) => new Date(date.getTime() + ms).toISOString();
    // Every amount is its own power of two (× 100), so a total names the rows in it.
    const payments = [
      // This period's edges.
      row("at_since", 0, 100, "u1", { paid_at: paidAt(period.since) }),
      row("before_until", 0, 200, "u1", { paid_at: paidAt(period.until, -1) }),
      row("at_until", 0, 400, "u1", { paid_at: paidAt(period.until) }),
      // The rest of that earlier day, [previousUntil, since): in NEITHER period.
      row("before_since", 0, 800, "u1", { paid_at: paidAt(period.since, -1) }),
      row("gap_evening", 0, 1600, "u1", { paid_at: "2026-08-24T18:00:00.000Z" }),
      row("at_previous_until", 0, 3200, "u1", { paid_at: paidAt(period.previousUntil) }),
      // The previous period's edges.
      row("before_previous_until", 0, 6400, "u1", { paid_at: paidAt(period.previousUntil, -1) }),
      row("at_previous_since", 0, 12800, "u1", { paid_at: paidAt(period.previousSince) }),
      row("before_previous_since", 0, 25600, "u1", { paid_at: paidAt(period.previousSince, -1) }),
    ];
    // The pack figures follow the same two periods.
    const packs = [
      pack("cs_gap", 0, 51200, { paid_at: paidAt(period.previousUntil, 60_000) }),
      pack("cs_before_previous_until", 0, 102400, { paid_at: paidAt(period.previousUntil, -60_000) }),
    ];
    const summary = summarize({ payments, packs });
    expect(summary.currencies[0]).toMatchObject({
      cents: 100 + 200,
      count: 2,
      packCents: 0,
      packCount: 0,
      previousCents: 6400 + 12800 + 102400,
      previousCount: 3,
      previousPackCents: 102400,
      previousPackCount: 1,
      // All time counts every one of them, whichever period it is in or out of.
      allTimeCents: 100 * (2 ** 11 - 1),
      allTimeCount: 11,
    });
    expect(summary).toMatchObject({ count: 2, previousCount: 3, allTimeCount: 11, entriesTotal: 2 });
    // The list and the chart are the period's alone: nothing of the gap, nothing of the one before.
    expect(summary.entries.map((p) => p.id)).toEqual(["before_until", "at_since"]);
    expect(summary.currencies[0].daily.reduce((n, p) => n + p.value, 0)).toBe(300);
  });

  it("counts credit packs in every total beside invoices, and on their own", () => {
    const payments = [row("in_a", 2, 1500), row("in_old", 40, 600)];
    const packs = [pack("cs_1", 1, 800), pack("cs_2", 10, 1920, { pack: "large", credits: 100 }), pack("cs_old", 50, 400)];
    const summary = summarize({ payments, packs });
    expect(summary.currencies[0]).toMatchObject({
      cents: 1500 + 800 + 1920,
      count: 3,
      packCents: 800 + 1920,
      packCount: 2,
      previousCents: 600 + 400,
      previousCount: 2,
      previousPackCents: 400,
      previousPackCount: 1,
      allTimeCents: 1500 + 600 + 800 + 1920 + 400,
      allTimeCount: 5,
    });
    expect(summary.entries.map((p) => `${p.kind}:${p.id}`)).toEqual(["pack:cs_1", "invoice:in_a", "pack:cs_2"]);
    expect(summary.entries[2]).toMatchObject({ pack: "large", credits: 100, amountCents: 1920, invoiceNumber: null });
  });

  it("lists a $0 trial invoice as a trial start and leaves it out of every total and count", () => {
    const payments = [
      row("in_trial", 1, 0, "u3", { billing_reason: "subscription_create" }),
      row("in_paid", 3, 1500),
      row("in_trial_old", 45, 0, "u4", { billing_reason: "subscription_create" }),
    ];
    const summary = summarize({ payments, packs: [] });
    expect(summary.currencies[0]).toMatchObject({ cents: 1500, count: 1, previousCents: 0, previousCount: 0, allTimeCents: 1500, allTimeCount: 1 });
    // The trial starts of the PERIOD, listed with its payments.
    expect(summary).toMatchObject({ count: 1, allTimeCount: 1, trialStarts: 1, entriesTotal: 2 });
    expect(summary.entries.map((p) => [p.id, p.kind])).toEqual([
      ["in_trial", "trial_start"],
      ["in_paid", "invoice"],
    ]);
    expect(summary.currencies[0].products.map((p) => p.label)).toEqual(["Pro monthly"]);
    expect(summary.currencies[0].daily.reduce((n, p) => n + p.value, 0)).toBe(1500);
  });

  it("a $0 invoice that is not a plan's first (a 100 %-off renewal) is 'no charge', never counted", () => {
    const summary = summarize({ payments: [row("in_free", 1, 0)], packs: [pack("cs_free", 1, 0)] });
    expect(summary.currencies).toEqual([]);
    expect(summary).toMatchObject({ count: 0, allTimeCount: 0, trialStarts: 0, entriesTotal: 2 });
    expect(summary.entries.map((p) => p.kind)).toEqual(["no_charge", "no_charge"]);
  });

  it("an only-trials log totals nothing (no currency without money taken)", () => {
    const payments = [1, 2, 3].map((d) => row(`t${d}`, d, 0, "u1", { billing_reason: "subscription_create" }));
    const summary = summarize({ payments, packs: [] });
    expect(summary).toMatchObject({ currencies: [], count: 0, previousCount: 0, allTimeCount: 0, trialStarts: 3 });
    expect(summary.entries).toHaveLength(3);
  });

  it("never adds amounts across currencies: one entry per currency, USD first; only payments add up", () => {
    const payments = [row("in_eur", 1, 1200, "u1", { currency: "eur" }), row("in_usd", 2, 1500)];
    const packs = [pack("cs_gbp", 3, 700, { currency: "gbp" }), pack("cs_usd", 4, 800), pack("cs_EUR", 50, 300, { currency: "EUR" })];
    const summary = summarize({ payments, packs });
    expect(summary.currencies.map((c) => [c.currency, c.cents, c.count, c.previousCents, c.allTimeCents, c.allTimeCount])).toEqual([
      ["usd", 2300, 2, 0, 2300, 2],
      ["eur", 1200, 1, 300, 1500, 2],
      ["gbp", 700, 1, 0, 700, 1],
    ]);
    expect(summary).toMatchObject({ count: 4, previousCount: 1, allTimeCount: 5 });
    // Each currency's days and products are its own.
    expect(summary.currencies[1].daily.reduce((n, p) => n + p.value, 0)).toBe(1200);
    expect(summary.currencies[2].products).toEqual([{ key: "pack:small:30", label: "Credit pack, 30 credits", cents: 700, count: 1 }]);
  });

  it("refunds sit beside the totals (never subtracted) on the PERIOD's sales; a refund on an older sale is all-time only (0174)", () => {
    const payments = [
      row("in_period_full", 1, 1500, "u1", { refunded_cents: 1500 }),
      row("in_period_won", 2, 600, "u1", { dispute_status: "won" }),
      row("before_period", 40, 2400, "u1", { refunded_cents: 2400, dispute_status: "lost" }),
    ];
    const packs = [pack("cs_part", 1, 800, { refunded_cents: 400 }), pack("cs_disputed", 3, 2400, { dispute_status: "needs_response" })];
    const summary = summarize({ payments, packs });
    expect(summary.currencies[0]).toMatchObject({
      // Gross: nothing is taken off for a refund.
      cents: 1500 + 600 + 800 + 2400,
      count: 4,
      refundedCents: 1500 + 400,
      refundedCount: 2,
      previousCents: 2400,
      allTimeRefundedCents: 1500 + 400 + 2400,
    });
    // The period's sales under dispute or lost: a won dispute and an older sale are not among them.
    expect(summary.disputed).toBe(1);
    expect(summary.entries.find((p) => p.id === "in_period_full")).toMatchObject({ refundedCents: 1500, disputeStatus: null });
    expect(summary.entries.find((p) => p.id === "cs_disputed")).toMatchObject({ refundedCents: 0, disputeStatus: "needs_response" });
    // A row from a database that hasn't run 0174 reads as nothing back.
    expect(summarize({ payments: [row("c", 1, 600)], packs: [] }).entries[0]).toMatchObject({ refundedCents: 0, disputeStatus: null });
  });

  it("the daily series has every UTC day of the period, in cents, and adds up to the period's total", () => {
    const payments = [
      row("morning", 0, 1500, "u1", { paid_at: "2026-09-20T00:00:00Z" }),
      row("night", 0, 600, "u1", { paid_at: "2026-09-20T23:59:59Z" }),
      row("first_day", 0, 400, "u1", { paid_at: "2026-08-25T00:00:00Z" }),
      row("day_before", 0, 900, "u1", { paid_at: "2026-08-24T23:59:59Z" }),
    ];
    const packs = [pack("today", 0, 800, { paid_at: "2026-09-23T11:00:00Z" })];
    const [usd] = summarize({ payments, packs }).currencies;
    expect(usd.daily).toHaveLength(30);
    expect(usd.daily[0]).toEqual({ day: "2026-08-25", value: 400 });
    expect(usd.daily.at(-1)).toEqual({ day: "2026-09-23", value: 800 });
    expect(usd.daily.find((p) => p.day === "2026-09-20")).toEqual({ day: "2026-09-20", value: 2100 });
    expect(usd.daily.filter((p) => p.value > 0)).toHaveLength(3);
    expect(usd.daily.reduce((n, p) => n + p.value, 0)).toBe(usd.cents);
    expect(usd.cents).toBe(3300);
    // "day_before" was paid in the last second of Aug 24 — after the previous
    // period's cut at noon: on no day of the chart and in no comparison.
    expect(usd).toMatchObject({ previousCents: 0, previousCount: 0, allTimeCents: 4200, allTimeCount: 5 });
  });

  it("ranks what was bought by the money it took in the period, each plan and pack in words", () => {
    const payments = [
      row("pro_m1", 1, 1500),
      row("pro_m2", 2, 1500),
      row("plus_y", 3, 6000, "u1", { tier: "plus", billing_interval: "year" }),
      row("plus_m", 4, 600, "u1", { tier: "plus" }),
      row("pro_y_old", 45, 15000, "u1", { billing_interval: "year" }),
      row("unnamed", 5, 700, "u1", { tier: null, billing_interval: null }),
      row("trial", 6, 0, "u1", { billing_reason: "subscription_create" }),
    ];
    const packs = [pack("mini_1", 1, 400, { pack: "mini", credits: 10 }), pack("mini_2", 2, 320, { pack: "mini", credits: 10 }), pack("large", 3, 2400, { pack: "large", credits: 100 })];
    const [usd] = summarize({ payments, packs }).currencies;
    expect(usd.products.map((p) => [p.label, p.cents, p.count])).toEqual([
      ["Plus annual", 6000, 1],
      ["Pro monthly", 3000, 2],
      ["Credit pack, 100 credits", 2400, 1],
      ["Credit pack, 10 credits", 720, 2],
      ["Plan not recorded", 700, 1],
      ["Plus monthly", 600, 1],
    ]);
    expect(usd.products.reduce((n, p) => n + p.cents, 0)).toBe(usd.cents);
    expect(revenueProductOf({ kind: "invoice", tier: "pro", interval: "year", pack: null, credits: null })).toEqual({
      key: "plan:pro:year",
      label: "Pro annual",
    });
    expect(revenueProductOf({ kind: "invoice", tier: "plus", interval: null, pack: null, credits: null }).label).toBe("Plus, interval not recorded");
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
    // Unknown when the ledger wasn't read.
    expect(summarize({ payments: [], packs, packGrants: null }).unpricedPackSales).toBeNull();
    expect(summarize({ payments: [], packs }).unpricedPackSales).toBeNull();
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
    const summary = summarizeRevenue({ payments, packs }, analyticsPeriod(30, new Date(now + 1000)));
    expect(summary.currencies[0]).toMatchObject({
      cents: 1040,
      count: 2,
      packCents: 1040,
      packCount: 2,
      previousCents: 1500,
      previousCount: 1,
      allTimeCents: 5540,
      allTimeCount: 5,
    });
    expect(summary.trialStarts).toBe(1);
    expect(summary.entriesTotal).toBe(3);
  });

  it("lists the newest payments of the period up to the limit and says how many there are", () => {
    const payments = Array.from({ length: 40 }, (_, i) => row(`i${String(i).padStart(2, "0")}`, i * 0.5 + 0.1, 100));
    const packs = Array.from({ length: 40 }, (_, i) => pack(`p${String(i).padStart(2, "0")}`, i * 0.5 + 0.35, 100));
    const summary = summarize({ payments, packs });
    expect(summary.entries).toHaveLength(REVENUE_LIST_LIMIT);
    expect(REVENUE_LIST_LIMIT).toBe(50);
    expect(summary.entriesTotal).toBe(80);
    expect(summary.entries.slice(0, 4).map((p) => p.id)).toEqual(["i00", "p00", "i01", "p01"]);
    // Every one is counted, listed or not.
    expect(summary.count).toBe(80);
  });
});
