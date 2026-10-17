import "server-only";

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
};

/** Money taken in one currency. */
export type CurrencyTotal = { currency: string; cents: number; count: number };

export type RevenueSummary = {
  /** One entry per currency (USD first), payments with money taken only. */
  last30Days: CurrencyTotal[];
  allTime: CurrencyTotal[];
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
/** Rows read per log. "All time" is labelled as capped when a log reaches it. */
export const REVENUE_ROW_CAP = 5000;

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
};

export type PackPaymentRow = {
  checkout_session_id: string;
  user_id: string | null;
  amount_cents: number;
  currency: string;
  pack: string | null;
  credits: number;
  paid_at: string;
};

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

function addTo(totals: Map<string, CurrencyTotal>, entry: RevenueEntry) {
  const currency = entry.currency.toLowerCase();
  const total = totals.get(currency) ?? { currency, cents: 0, count: 0 };
  total.cents += entry.amountCents;
  total.count += 1;
  totals.set(currency, total);
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
  let trialStarts = 0;
  for (const entry of entries) {
    if (entry.kind === "trial_start") trialStarts += 1;
    if (!isMoneyTaken(entry)) continue;
    addTo(allTime, entry);
    if (new Date(entry.paidAt).getTime() >= since) addTo(last30, entry);
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
  const [paymentsRes, packsRes, grantsRes] = await Promise.all([
    admin
      .from("billing_payments")
      .select(
        "invoice_id, user_id, amount_cents, currency, billing_reason, tier, billing_interval, paid_at, invoice_number, hosted_invoice_url",
      )
      .order("paid_at", { ascending: false })
      .limit(REVENUE_ROW_CAP),
    admin
      .from("billing_pack_payments")
      .select("checkout_session_id, user_id, amount_cents, currency, pack, credits, paid_at")
      .order("paid_at", { ascending: false })
      .limit(REVENUE_ROW_CAP),
    admin
      .from("credit_ledger")
      .select("idempotency_key")
      .eq("reason", "pack_purchase")
      .limit(REVENUE_ROW_CAP),
  ]);
  if (paymentsRes.error || packsRes.error) {
    console.warn(
      "getRevenueSummary: query error",
      paymentsRes.error?.message ?? packsRes.error?.message,
    );
    return null;
  }
  const payments = (paymentsRes.data ?? []) as PaymentRow[];
  const packs = (packsRes.data ?? []) as PackPaymentRow[];
  // The unpriced count is only shown when the whole ledger list was read.
  const grantRows = (grantsRes.data ?? []) as PackGrantRow[];
  const grants = grantsRes.error || grantRows.length >= REVENUE_ROW_CAP ? null : grantRows;
  const capped = payments.length >= REVENUE_ROW_CAP || packs.length >= REVENUE_ROW_CAP;
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
