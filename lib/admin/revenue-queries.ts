import "server-only";

import { selectAllRows } from "@/lib/supabase/select-all-rows";
import { requireAdminClient } from "./users-queries";

// ---------------------------------------------------------------------------
// What the admin Revenue panel shows. Two logs, both written by the Stripe
// webhook and read here, never Stripe:
//   - billing_payments (0110): one row per invoice.paid — subscriptions;
//   - billing_pack_payments (0138): one row per PAID credit-pack Checkout
//     session (a pack creates no invoice, so it is not in the first log).
// Admin-gated like every other admin read; null when the viewer isn't an
// admin.
//
// What counts as a PAYMENT (every total and count): money taken, i.e. an
// amount above zero. A $0 invoice — the one a card-required trial opens
// with (billing_reason subscription_create), or a 100 %-off coupon — is
// listed (as "Trial start" / "No charge") and counted nowhere. Totals are
// kept PER CURRENCY: amounts in different currencies are never added.
// ---------------------------------------------------------------------------

export type RevenueEntryKind = "invoice" | "trial_start" | "no_charge" | "pack";

export type RevenueEntry = {
  /** The invoice id, or the Checkout session id for a pack. */
  id: string;
  kind: RevenueEntryKind;
  userId: string | null;
  username: string | null;
  amountCents: number;
  currency: string;
  billingReason: string | null;
  tier: string | null;
  interval: string | null;
  pack: string | null;
  credits: number | null;
  paidAt: string;
  invoiceNumber: string | null;
  hostedInvoiceUrl: string | null;
  /** Money given back on this sale (0174: a refund, by the webhook). */
  refundedCents: number;
  /** Stripe's dispute status when one is or was open on this sale. */
  disputeStatus: string | null;
};

/** Money taken in one currency. */
export type CurrencyTotal = { currency: string; cents: number; count: number };

export type RevenueSummary = {
  /** One entry per currency (USD first), payments with money taken only. */
  last30Days: CurrencyTotal[];
  allTime: CurrencyTotal[];
  /** Money given back (refunds) per currency, all time — shown beside the
   *  gross totals, never subtracted from them (0174). */
  refunds: CurrencyTotal[];
  /** Sales with a dispute open or lost, all time. */
  disputed: number;
  /** Payments with money taken, across currencies. */
  last30DaysCount: number;
  allTimeCount: number;
  /** $0 trial-start invoices, all time (listed, never in a total). */
  trialStarts: number;
  /** True when a log hit the read cap: "all time" is then the newest rows only. */
  allTimeCapped: boolean;
  /** Pack credit grants with no revenue row (sold before 0138), or null when unknown. */
  unpricedPackSales: number | null;
  recent: RevenueEntry[];
};

export const REVENUE_RECENT_LIMIT = 8;
/** Rows read per log, in pages (lib/supabase/select-all-rows.ts): an
 *  un-ranged read stops at PostgREST's `max_rows` — 1,000 — and says nothing
 *  about the rest, whatever `.limit()` asks for, so "All time" quietly
 *  became "the newest 1,000 invoices". A log longer than this is a failed
 *  read (the panel says it could not load), never a partial total. */
export const REVENUE_ROW_CAP = 50_000;

export type PaymentRow = {
  invoice_id: string;
  user_id: string | null;
  amount_cents: number;
  currency: string;
  billing_reason: string | null;
  tier: string | null;
  billing_interval: string | null;
  paid_at: string;
  invoice_number: string | null;
  hosted_invoice_url: string | null;
  /** 0174 — absent on a database that hasn't run it. */
  refunded_cents?: number | null;
  dispute_status?: string | null;
};

export type PackPaymentRow = {
  checkout_session_id: string;
  user_id: string | null;
  amount_cents: number;
  currency: string;
  pack: string | null;
  credits: number;
  paid_at: string;
  refunded_cents?: number | null;
  dispute_status?: string | null;
};

/** A dispute the network has (or kept) the money for. */
const DISPUTE_OPEN_OR_LOST: ReadonlySet<string> = new Set(["needs_response", "under_review", "lost"]);

/** The ledger's pack grants: `pack:<checkout session id>` (older ones: an event id). */
export type PackGrantRow = { idempotency_key: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;

function invoiceKind(row: PaymentRow): RevenueEntryKind {
  if (row.amount_cents > 0) return "invoice";
  return row.billing_reason === "subscription_create" ? "trial_start" : "no_charge";
}

/** Pure: both logs as one list, newest first (usernames not filled in). */
export function revenueEntries(payments: PaymentRow[], packs: PackPaymentRow[]): RevenueEntry[] {
  const entries: RevenueEntry[] = [
    ...payments.map((row) => ({
      id: row.invoice_id,
      kind: invoiceKind(row),
      userId: row.user_id,
      username: null,
      amountCents: row.amount_cents,
      currency: row.currency,
      billingReason: row.billing_reason,
      tier: row.tier,
      interval: row.billing_interval,
      pack: null,
      credits: null,
      paidAt: row.paid_at,
      invoiceNumber: row.invoice_number,
      hostedInvoiceUrl: row.hosted_invoice_url,
      refundedCents: Math.max(0, row.refunded_cents ?? 0),
      disputeStatus: row.dispute_status ?? null,
    })),
    ...packs.map((row) => ({
      id: row.checkout_session_id,
      kind: (row.amount_cents > 0 ? "pack" : "no_charge") as RevenueEntryKind,
      userId: row.user_id,
      username: null,
      amountCents: row.amount_cents,
      currency: row.currency,
      billingReason: null,
      tier: null,
      interval: null,
      pack: row.pack,
      credits: row.credits,
      paidAt: row.paid_at,
      invoiceNumber: null,
      hostedInvoiceUrl: null,
      refundedCents: Math.max(0, row.refunded_cents ?? 0),
      disputeStatus: row.dispute_status ?? null,
    })),
  ];
  return entries.sort(
    (a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime() || a.id.localeCompare(b.id),
  );
}

/** Money taken: an amount above zero, invoice or pack. */
export function isMoneyTaken(entry: RevenueEntry): boolean {
  return (entry.kind === "invoice" || entry.kind === "pack") && entry.amountCents > 0;
}

function addTo(totals: Map<string, CurrencyTotal>, entry: RevenueEntry, cents = entry.amountCents) {
  const currency = entry.currency.toLowerCase();
  const total = totals.get(currency) ?? { currency, cents: 0, count: 0 };
  total.cents += cents;
  total.count += 1;
  totals.set(currency, total);
}

/** The sale has a dispute the network holds or kept the money for. */
export function isDisputed(entry: Pick<RevenueEntry, "disputeStatus">): boolean {
  return entry.disputeStatus != null && DISPUTE_OPEN_OR_LOST.has(entry.disputeStatus);
}

function ordered(totals: Map<string, CurrencyTotal>): CurrencyTotal[] {
  return [...totals.values()].sort((a, b) =>
    a.currency === "usd" ? -1 : b.currency === "usd" ? 1 : a.currency.localeCompare(b.currency),
  );
}

/** Pure: totals + the recent list from the rows. */
export function summarizeRevenue(
  input: {
    payments: PaymentRow[];
    packs: PackPaymentRow[];
    packGrants?: PackGrantRow[] | null;
    capped?: boolean;
  },
  usernames: Map<string, string | null>,
  now = Date.now(),
): RevenueSummary {
  const since = now - 30 * DAY_MS;
  const entries = revenueEntries(input.payments, input.packs);
  const last30 = new Map<string, CurrencyTotal>();
  const allTime = new Map<string, CurrencyTotal>();
  const refunds = new Map<string, CurrencyTotal>();
  let trialStarts = 0;
  let disputed = 0;
  for (const entry of entries) {
    if (entry.kind === "trial_start") trialStarts += 1;
    if (isDisputed(entry)) disputed += 1;
    if (!isMoneyTaken(entry)) continue;
    addTo(allTime, entry);
    if (new Date(entry.paidAt).getTime() >= since) addTo(last30, entry);
    if (entry.refundedCents > 0) addTo(refunds, entry, entry.refundedCents);
  }
  const capped = input.capped ?? false;
  let unpricedPackSales: number | null = null;
  if (input.packGrants && !capped) {
    const priced = new Set(input.packs.map((p) => `pack:${p.checkout_session_id}`));
    unpricedPackSales = input.packGrants.filter((g) => !g.idempotency_key || !priced.has(g.idempotency_key)).length;
  }
  const count = (m: Map<string, CurrencyTotal>) => [...m.values()].reduce((n, t) => n + t.count, 0);
  return {
    last30Days: ordered(last30),
    allTime: ordered(allTime),
    last30DaysCount: count(last30),
    allTimeCount: count(allTime),
    refunds: ordered(refunds),
    disputed,
    trialStarts,
    allTimeCapped: capped,
    unpricedPackSales,
    recent: entries.slice(0, REVENUE_RECENT_LIMIT).map((entry) => ({
      ...entry,
      username: entry.userId ? (usernames.get(entry.userId) ?? null) : null,
    })),
  };
}

export async function getRevenueSummary(): Promise<RevenueSummary | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  // Every row, a page at a time, OLDEST first with the key last: the order
  // is total, and a sale that lands between two pages is appended at the
  // end — it cannot shift the rows before it and have one read twice (a
  // newest-first offset read can). `revenueEntries` sorts for display.
  const paged = { maxRows: REVENUE_ROW_CAP };
  const [paymentsRes, packsRes, grantsRes] = await Promise.all([
    selectAllRows<PaymentRow>(
      (from, to) =>
        admin
          .from("billing_payments")
          .select(
            "invoice_id, user_id, amount_cents, currency, billing_reason, tier, billing_interval, paid_at, invoice_number, hosted_invoice_url, refunded_cents, dispute_status",
          )
          .order("paid_at", { ascending: true })
          .order("invoice_id", { ascending: true })
          .range(from, to),
      paged,
    ),
    selectAllRows<PackPaymentRow>(
      (from, to) =>
        admin
          .from("billing_pack_payments")
          .select("checkout_session_id, user_id, amount_cents, currency, pack, credits, paid_at, refunded_cents, dispute_status")
          .order("paid_at", { ascending: true })
          .order("checkout_session_id", { ascending: true })
          .range(from, to),
      paged,
    ),
    selectAllRows<PackGrantRow>(
      (from, to) =>
        admin
          .from("credit_ledger")
          .select("idempotency_key")
          .eq("reason", "pack_purchase")
          .order("id", { ascending: true })
          .range(from, to),
      paged,
    ),
  ]);
  // A failed page — or a log longer than the cap (the safety stop: these
  // totals belong in SQL long before that) — is a failed read: never part
  // of a log summed as if it were all of it.
  const failed = [paymentsRes, packsRes].find((res) => res.error);
  if (failed) {
    console.warn("getRevenueSummary: query error", failed.error?.message);
    return null;
  }
  // One row a sale, whatever the pages returned.
  const payments = [...new Map(paymentsRes.data.map((row) => [row.invoice_id, row])).values()];
  const packs = [...new Map(packsRes.data.map((row) => [row.checkout_session_id, row])).values()];
  // The unpriced count is only shown when the whole ledger list was read.
  const grants = grantsRes.error ? null : grantsRes.data;
  const capped = false;
  const ids = [
    ...new Set(
      revenueEntries(payments, packs)
        .slice(0, REVENUE_RECENT_LIMIT)
        .map((e) => e.userId)
        .filter(Boolean),
    ),
  ] as string[];
  const usernames = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, username").in("id", ids);
    for (const p of profiles ?? []) usernames.set(p.id, p.username ?? null);
  }
  return summarizeRevenue({ payments, packs, packGrants: grants, capped }, usernames);
}
