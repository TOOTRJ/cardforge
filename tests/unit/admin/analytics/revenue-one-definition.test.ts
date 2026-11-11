import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// "Revenue" is ONE number under one name (/admin/analytics). The Overview's
// tile and the Revenue tab's headline are computed by two modules from the
// same two logs (the Overview reads four columns to stay light) — so the
// same rows must give the same figure, for the period and for the one
// before it: money taken, refunds shown beside it and never taken off.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminConfigured: () => true }));

import { revenueByCurrency } from "@/lib/admin/analytics/overview";
import { summarizeRevenue, type PackPaymentRow, type PaymentRow } from "@/lib/admin/revenue-queries";
import { analyticsPeriod } from "@/lib/admin/analytics/params";

// [Oct 13 00:00, Nov 11 12:00), and the same stretch 30 days earlier:
// [Sep 13 00:00, Oct 12 12:00). The rest of Oct 12 is in neither.
const period = analyticsPeriod(30, new Date("2026-11-11T12:00:00Z"));
const IN = "2026-11-01T10:00:00Z";
const BEFORE = "2026-10-01T10:00:00Z";
const GAP = "2026-10-12T18:00:00Z";
const LONG_AGO = "2026-06-01T10:00:00Z";

const invoice = (id: string, paid_at: string, amount_cents: number, patch: Partial<PaymentRow> = {}): PaymentRow => ({
  invoice_id: id,
  user_id: "u1",
  amount_cents,
  currency: "usd",
  billing_reason: "subscription_cycle",
  tier: "plus",
  billing_interval: "month",
  paid_at,
  invoice_number: null,
  hosted_invoice_url: null,
  refunded_cents: 0,
  dispute_status: null,
  ...patch,
});
const pack = (id: string, paid_at: string, amount_cents: number, patch: Partial<PackPaymentRow> = {}): PackPaymentRow => ({
  checkout_session_id: id,
  user_id: "u2",
  amount_cents,
  currency: "usd",
  pack: "small",
  credits: 50,
  paid_at,
  refunded_cents: 0,
  dispute_status: null,
  ...patch,
});

describe("the Overview's Revenue tile and the Revenue tab's headline", () => {
  const payments = [
    invoice("in_1", IN, 1200),
    invoice("in_2", IN, 800, { refunded_cents: 800 }), // refunded in full: still money taken
    invoice("in_3", IN, 0, { billing_reason: "subscription_create" }), // a $0 trial start
    invoice("in_4", IN, 900, { currency: "eur" }),
    invoice("in_5", BEFORE, 1200),
    invoice("in_6", LONG_AGO, 5000),
    // Paid after the previous period's cut and before this period began: in
    // neither figure, on the tile and on the tab alike.
    invoice("in_7", GAP, 700),
    invoice("in_8", GAP, 300, { currency: "eur" }),
  ];
  const packs = [pack("cs_1", IN, 400, { refunded_cents: 100 }), pack("cs_2", BEFORE, 400), pack("cs_3", GAP, 250)];

  it("are the same figure, per currency, for the period and the one before", () => {
    const tab = summarizeRevenue({ payments, packs, packGrants: [] }, period);
    const overview = revenueByCurrency(
      [
        ...payments.map((row) => ({ key: `invoice:${row.invoice_id}`, amount_cents: row.amount_cents, currency: row.currency, paid_at: row.paid_at })),
        ...packs.map((row) => ({ key: `pack:${row.checkout_session_id}`, amount_cents: row.amount_cents, currency: row.currency, paid_at: row.paid_at })),
      ],
      period,
    );
    const fromTab = Object.fromEntries(tab.currencies.map((c) => [c.currency, [c.cents, c.previousCents]]));
    const fromOverview = Object.fromEntries(overview.map((c) => [c.currency, [c.currentCents, c.previousCents]]));
    expect(period.previousUntil.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(fromTab.usd).toEqual([1200 + 800 + 400, 1200 + 400]);
    expect(fromOverview.usd).toEqual(fromTab.usd);
    expect(fromTab.eur).toEqual([900, 0]);
    expect(fromOverview.eur).toEqual(fromTab.eur);
    // Refunds sit beside the figure on the tab, never inside it.
    expect(tab.currencies.find((c) => c.currency === "usd")?.refundedCents).toBe(900);
  });
});
