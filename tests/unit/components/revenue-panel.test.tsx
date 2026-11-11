import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/admin/users-queries", () => ({ requireAdminClient: async () => null }));
vi.mock("next/link", () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));

import { RevenuePanel } from "@/components/admin/revenue-panel";
import { summarizeRevenue } from "@/lib/admin/revenue-queries";
import { analyticsPeriod } from "@/lib/admin/analytics/params";

// The Revenue tab's content (/admin/analytics): tiles for the period against
// the one before, revenue per day, what was bought, and the period's
// payments. $0 trial starts are listed as such and in no total, packs are
// counted beside invoices, currencies are never added.

const NOW = new Date("2026-10-16T12:00:00Z");
const period = analyticsPeriod(30, NOW);
const day = 24 * 60 * 60 * 1000;
const at = (d: number) => new Date(NOW.getTime() - d * day).toISOString();
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
const pack = (id: string, d: number, cents: number, extra: Record<string, unknown> = {}) => ({
  checkout_session_id: id,
  user_id: "u1",
  amount_cents: cents,
  currency: "usd",
  pack: "small",
  credits: 30,
  paid_at: at(d),
  ...extra,
});
const html = (input: Parameters<typeof summarizeRevenue>[0], days: 7 | 30 | 90 = 30) =>
  renderToStaticMarkup(
    <RevenuePanel summary={summarizeRevenue(input, analyticsPeriod(days, NOW), new Map([["u1", "dev_artist"]]))} days={days} />,
  )
    .replace(/ /g, " ")
    .replace(/<!-- -->/g, "");
/** The text of the tile whose label is `label`. */
const tile = (out: string, label: string) => {
  const start = out.indexOf(`>${label}</dt>`);
  expect(start, `a tile labelled ${label}`).toBeGreaterThan(-1);
  return out
    .slice(start, out.indexOf("</div>", start))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
};

describe("RevenuePanel", () => {
  it("shows the period's revenue against the one before, as money, with the all-time total", () => {
    const out = html({
      payments: [invoice("in_now", 2, 600), invoice("in_before", 40, 400), invoice("in_old", 200, 1500)],
      packs: [],
    });
    const revenue = tile(out, "Revenue");
    expect(revenue).toContain("$6.00");
    // The previous amount is written as money, never as a bare number of cents.
    expect(revenue).toContain("+50% vs the previous 30 days ($4.00)");
    expect(revenue).toContain("All time: $25.00 from 3 payments");
    expect(revenue).not.toContain("after refunds");
    const payments = tile(out, "Payments");
    expect(payments).toContain(" 1 ");
    expect(payments).toContain("no change vs the previous 30 days (1)");
    // The dead capped label is gone.
    expect(out).not.toContain("All time (newest");
  });

  it("lists a $0 trial invoice as a trial start and keeps it out of the totals", () => {
    const out = html({
      payments: [invoice("in_t", 1, 0, { billing_reason: "subscription_create" }), invoice("in_p", 2, 600)],
      packs: [],
    });
    expect(out).toContain("Trial start · Plus · not counted");
    expect(tile(out, "Revenue")).toContain("$6.00");
    expect(tile(out, "Payments")).toContain(" 1 ");
    expect(out).toContain("never counted (1 in this period)");
    // Listed with a $0 amount, in the subtle tone of a row that is not counted.
    expect(out).toMatch(/text-subtle">\$0\.00</);
  });

  it("counts a credit pack beside invoices, on its own tile and in what was bought", () => {
    const out = html({
      payments: [invoice("in_p", 2, 600)],
      packs: [pack("cs_1", 1, 800), pack("cs_before", 35, 400)],
    });
    expect(out).toContain("Credit pack · 30 credits");
    expect(tile(out, "Revenue")).toContain("$14.00");
    expect(tile(out, "Payments")).toContain(" 2 ");
    const packs = tile(out, "Pack sales");
    expect(packs).toContain("$8.00");
    expect(packs).toContain("+100% vs the previous 30 days ($4.00)");
    expect(packs).toContain("1 credit pack sold.");
    // Ranked by the money each took, with the number of payments.
    expect(out).toMatch(/Credit pack, 30 credits<\/span>[\s\S]*?\$8\.00<span[^>]*> · 1 payment<\/span>[\s\S]*?Plus monthly<\/span>[\s\S]*?\$6\.00/);
    expect(out).toMatch(/<caption[^>]*>What was bought<\/caption>/);
  });

  it("draws revenue per day with an axis that reads as money, and a table twin with every day's amount", () => {
    const out = html({ payments: [invoice("in_a", 2, 600), invoice("in_b", 2.1, 150)], packs: [] });
    expect(out).toContain("Revenue per day");
    // Axis ticks: whole amounts, no ".00" (0, a middle and a top tick).
    expect(out).toMatch(/>\$0<\/span>/);
    expect(out).toMatch(/>\$5<\/span>/);
    expect(out).toMatch(/>\$10<\/span>/);
    // The day's column, hovered: the amount first.
    expect(out).toContain("$7.50 revenue</p>");
    expect(out.match(/bg-chart-1/g)!.length).toBeGreaterThanOrEqual(30);
    // The twin: the same amount, to the cent.
    expect(out).toMatch(/<caption[^>]*>Revenue per day<\/caption>[\s\S]*?Oct 14, 2026<\/th><td[^>]*>\$7\.50<\/td>/);
  });

  it("shows one tile and one pair of charts per currency, never a sum across them", () => {
    const out = html({ payments: [invoice("in_u", 1, 600), invoice("in_e", 2, 500, { currency: "eur" })], packs: [] });
    expect(tile(out, "Revenue (USD)")).toContain("$6.00");
    expect(tile(out, "Revenue (EUR)")).toContain("€5.00");
    expect(out).not.toContain("$11.00");
    expect(out).toContain("Revenue per day (USD)");
    expect(out).toContain("Revenue per day (EUR)");
    expect(out).toContain("What was bought (USD)");
    expect(out).toContain("What was bought (EUR)");
    expect(out).toContain("Each currency is totalled on its own.");
    // Payments are counted together: two of them.
    expect(tile(out, "Payments")).toContain(" 2 ");
  });

  it("shows refunds beside revenue on their own tile, and marks the refunded and disputed payments", () => {
    const out = html({
      payments: [invoice("in_r", 1, 600, { refunded_cents: 600 }), invoice("in_d", 2, 600, { dispute_status: "needs_response" })],
      packs: [pack("cs_part", 3, 800, { refunded_cents: 300 })],
    });
    // Gross, with what is left after refunds beside it.
    expect(tile(out, "Revenue")).toContain("$20.00");
    expect(tile(out, "Revenue")).toContain("$11.00 after refunds.");
    const refunded = tile(out, "Refunded");
    expect(refunded).toContain("$9.00");
    expect(refunded).toContain("Given back on 2 of this period's 3 payments.");
    expect(out).toContain(" · refunded $6.00</span>");
    expect(out).toContain(" · refunded $3.00 (part)</span>");
    expect(out).toContain(" · disputed (needs response)</span>");
    expect(out).toContain("1 payment of this period is under dispute or lost.");
    expect(tile(out, "Revenue")).toContain("$9.00 of it refunded");
  });

  it("lists the period's payments with who paid (a link to the user) and the invoice, newest first", () => {
    const out = html({
      payments: [
        invoice("in_1", 1, 600, { invoice_number: "PG-0007", hosted_invoice_url: "https://invoice.stripe.com/i/abc" }),
        invoice("in_2", 3, 1500, { user_id: null, tier: "pro", billing_interval: "year", billing_reason: "subscription_create" }),
        invoice("in_old", 45, 600),
      ],
      packs: [],
    });
    expect(out).toMatch(/<caption[^>]*>Payments in this period, newest first<\/caption>/);
    expect(out).toContain('href="/admin/users?u=u1"');
    expect(out).toContain("@dev_artist");
    expect(out).toContain("unlinked customer");
    expect(out).toContain("New plan · Pro / year");
    expect(out).toContain('href="https://invoice.stripe.com/i/abc"');
    expect(out).toContain("PG-0007");
    expect(out).toContain("Oct 15, 2026 UTC");
    // Only the period's: the payment of 45 days ago is not in the list.
    const list = out.slice(out.indexOf("Payments in this period, newest first"));
    expect(list.indexOf("Oct 15, 2026 UTC")).toBeGreaterThan(-1);
    expect(list.indexOf("Oct 15, 2026 UTC")).toBeLessThan(list.indexOf("Oct 13, 2026 UTC"));
    expect(out).not.toContain("Sep 1, 2026 UTC");
    expect(out).toContain("Every payment and trial start of the last 30 days, newest first.");
  });

  it("says how many of the period's payments are not listed when there are more than fifty", () => {
    const out = html({ payments: Array.from({ length: 60 }, (_, i) => invoice(`in_${i}`, 0.1 + i * 0.1, 600)), packs: [] });
    expect(out).toContain("The newest 50 of 60 in the last 30 days. The other 10 are older and not listed here");
    expect(out.match(/Renewal · Plus \/ month/g)).toHaveLength(50);
    // Counted all the same.
    expect(tile(out, "Payments")).toContain(" 60 ");
    expect(tile(out, "Revenue")).toContain("$360.00");
  });

  it("says how many earlier pack sales are unpriced", () => {
    expect(
      html({ payments: [], packs: [], packGrants: [{ idempotency_key: "pack:cs_old" }, { idempotency_key: "pack:cs_old2" }] }),
    ).toContain("2 earlier pack sales aren&#x27;t priced here");
  });

  it("a period with nothing in it reads as nothing: zero tiles and sentences, no empty plot", () => {
    const out = html({ payments: [invoice("in_old", 200, 600)], packs: [] }, 7);
    expect(tile(out, "Revenue")).toContain("$0.00");
    expect(tile(out, "Revenue")).toContain("no change vs the previous 7 days ($0.00)");
    expect(tile(out, "Revenue")).toContain("All time: $6.00 from 1 payment");
    expect(tile(out, "Refunded")).toContain("Nothing given back on this period's payments.");
    expect(tile(out, "Pack sales")).toContain("0 credit packs sold.");
    expect(out).toContain("No revenue in this period.");
    expect(out).toContain("Nothing was bought in this period.");
    expect(out).toContain("No payments in this period.");
    expect(out).not.toContain("bg-chart-1");
    // Nothing at all, ever: still one USD tile.
    expect(tile(html({ payments: [], packs: [] }), "Revenue")).toContain("$0.00");
  });

  it("uses the period it is given in its words", () => {
    const out = html({ payments: [invoice("in_p", 2, 600)], packs: [] }, 90);
    expect(out).toContain("vs the previous 90 days");
    expect(out).toContain("each UTC day of the last 90 days");
    expect(period.dayKeys).toHaveLength(30);
  });
});
