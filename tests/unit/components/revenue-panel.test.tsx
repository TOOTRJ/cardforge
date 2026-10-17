import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));

import { RevenuePanel } from "@/components/admin/revenue-panel";
import { summarizeRevenue } from "@/lib/admin/revenue-queries";

// The admin Revenue panel: $0 trial starts are listed as such and in no
// total, packs are listed beside invoices, currencies are never added, and
// "All time" says when it is capped or misses earlier pack sales.

const now = Date.parse("2026-10-16T12:00:00Z");
const day = 24 * 60 * 60 * 1000;
const at = (d: number) => new Date(now - d * day).toISOString();
const invoice = (id: string, d: number, cents: number, extra: Record<string, unknown> = {}) => ({
  invoice_id: id,
  user_id: "u1",
  amount_cents: cents,
  currency: "usd",
  billing_reason: "subscription_cycle",
  tier: "plus",
  billing_interval: "month",
  paid_at: at(d),
  invoice_number: null,
  hosted_invoice_url: null,
  ...extra,
});
const html = (input: Parameters<typeof summarizeRevenue>[0]) =>
  renderToStaticMarkup(<RevenuePanel summary={summarizeRevenue(input, new Map([["u1", "dev_artist"]]), now)} />).replace(
    / /g,
    " ",
  );

describe("RevenuePanel", () => {
  it("lists a $0 trial invoice as a trial start and keeps it out of the totals", () => {
    const out = html({
      payments: [invoice("in_t", 1, 0, { billing_reason: "subscription_create" }), invoice("in_p", 2, 600)],
      packs: [],
    });
    expect(out).toContain("Trial start · Plus · not counted");
    expect(out).toContain("$6<span");
    expect(out).toContain("· 1 payment<");
    expect(out).toContain("(1 so far)");
  });

  it("lists a credit pack and adds it to the USD total", () => {
    const out = html({
      payments: [invoice("in_p", 2, 600)],
      packs: [{ checkout_session_id: "cs_1", user_id: "u1", amount_cents: 800, currency: "usd", pack: "small", credits: 30, paid_at: at(1) }],
    });
    expect(out).toContain("Credit pack · 30 credits");
    expect(out).toContain("$14<span");
    expect(out).toContain("· 2 payments<");
  });

  it("shows one amount per currency, never a sum across them", () => {
    const out = html({ payments: [invoice("in_u", 1, 600), invoice("in_e", 2, 500, { currency: "eur" })], packs: [] });
    expect(out).toContain("$6 + €5");
    expect(out).toContain("Each currency is totalled on its own.");
  });

  it("says when All time is capped, and how many earlier pack sales are unpriced", () => {
    expect(html({ payments: [invoice("in_u", 1, 600)], packs: [], capped: true })).toContain("All time (newest 5,000 rows)");
    expect(
      html({ payments: [], packs: [], packGrants: [{ idempotency_key: "pack:cs_old" }, { idempotency_key: "pack:cs_old2" }] }),
    ).toContain("2 earlier pack sales aren&#x27;t priced here");
  });
});
