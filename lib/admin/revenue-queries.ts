import "server-only";

import { selectAllRows } from "@/lib/supabase/select-all-rows";
import type { AnalyticsPeriod } from "@/lib/admin/analytics/params";
import { fillDays, utcDayKey, type DayPoint } from "@/lib/admin/analytics/series";
import { requireAdminClient } from "./users-queries";

// ---------------------------------------------------------------------------
// What /admin/analytics' Revenue tab shows. Two logs, both written by the
// Stripe webhook and read here, never Stripe:
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
// Refunds sit BESIDE the totals, never subtracted from them (0174) — and a
// refund is a figure on its SALE's row: the log knows which sale gave money
// back, not when, so "refunded" in a period is what was given back on the
// sales of that period.
//
// The rows are read whole (a page at a time) and summed here by the pure
// `summarizeRevenue` for one PERIOD — [since, until), the same length of
// time before it, and every UTC day of it (lib/admin/analytics/params.ts
// analyticsPeriod) — beside the all-time totals.
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

/** The period a summary covers (lib/admin/analytics/params.ts). */
export type RevenuePeriod = Pick<AnalyticsPeriod, "since" | "previousSince" | "previousUntil" | "until" | "dayKeys">;

/** One thing that was bought — a plan at an interval, or a credit pack. */
export type RevenueProduct = { key: string; label: string; cents: number; count: number };

/** Money taken in ONE currency. Every figure counts payments with money
 *  taken only; `count`s are payments, `cents` what they came to. */
export type CurrencyRevenue = {
  currency: string;
  /** The period. */
  cents: number;
  count: number;
  /** The same stretch N days earlier: [previousSince, previousUntil). */
  previousCents: number;
  previousCount: number;
  /** Given back on the PERIOD's sales (beside `cents`, never taken off it). */
  refundedCents: number;
  refundedCount: number;
  /** The credit-pack part of the period and of the one before. */
  packCents: number;
  packCount: number;
  previousPackCents: number;
  previousPackCount: number;
  /** Every payment there is, and what was given back on them. */
  allTimeCents: number;
  allTimeCount: number;
  allTimeRefundedCents: number;
  /** The period's UTC days, oldest first, quiet days at 0 — in cents. */
  daily: DayPoint[];
  /** What was bought in the period, most money first. */
  products: RevenueProduct[];
};

export type RevenueSummary = {
  /** One entry per currency money was ever taken in (USD first). */
  currencies: CurrencyRevenue[];
  /** Payments with money taken, across currencies (payments add up;
   *  amounts in different currencies never do). */
  count: number;
  previousCount: number;
  allTimeCount: number;
  /** $0 trial-start invoices of the period (listed, never in a total). */
  trialStarts: number;
  /** The period's sales with a dispute open or lost. */
  disputed: number;
  /** Pack credit grants with no revenue row (sold before 0138), all time,
   *  or null when the ledger could not be read. */
  unpricedPackSales: number | null;
  /** Everything paid in the period — $0 rows too — newest first, at most
   *  REVENUE_LIST_LIMIT of them; `entriesTotal` is how many there are. */
  entries: RevenueEntry[];
  entriesTotal: number;
};

/** How many of the period's payments the tab lists. */
export const REVENUE_LIST_LIMIT = 50;
/** The safety stop of each paged read (lib/supabase/select-all-rows.ts): an
 *  un-ranged read stops at PostgREST's `max_rows` — 1,000 — and says nothing
 *  about the rest, whatever `.limit()` asks for, so the logs are read in
 *  pages. A log longer than this is a FAILED read (the tab says it could not
 *  load), never a partial total: these sums belong in SQL long before it. */
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

/** The sale has a dispute the network holds or kept the money for. */
export function isDisputed(entry: Pick<RevenueEntry, "disputeStatus">): boolean {
  return entry.disputeStatus != null && DISPUTE_OPEN_OR_LOST.has(entry.disputeStatus);
}

const TIER_WORD: Record<string, string> = { plus: "Plus", pro: "Pro" };
const INTERVAL_WORD: Record<string, string> = { month: "monthly", year: "annual" };

/**
 * What a payment bought, in words: "Plus monthly", "Pro annual", "Credit
 * pack, 30 credits". A plan payment whose plan the webhook could not name
 * (an old row, a manual invoice) is "Plan not recorded" — never guessed
 * into one of the four.
 */
export function revenueProductOf(entry: Pick<RevenueEntry, "kind" | "tier" | "interval" | "pack" | "credits">): {
  key: string;
  label: string;
} {
  if (entry.kind === "pack") {
    return {
      key: `pack:${entry.pack ?? ""}:${entry.credits ?? ""}`,
      label: entry.credits != null ? `Credit pack, ${entry.credits} credits` : "Credit pack",
    };
  }
  const tier = entry.tier ? TIER_WORD[entry.tier] : undefined;
  const interval = entry.interval ? INTERVAL_WORD[entry.interval] : undefined;
  if (tier && interval) return { key: `plan:${entry.tier}:${entry.interval}`, label: `${tier} ${interval}` };
  if (tier) return { key: `plan:${entry.tier}:`, label: `${tier}, interval not recorded` };
  return { key: "plan::", label: "Plan not recorded" };
}

/** Pure: the entries paid in [since, until), in the order given. */
export function revenueEntriesIn(entries: RevenueEntry[], period: Pick<RevenuePeriod, "since" | "until">): RevenueEntry[] {
  const since = period.since.getTime();
  const until = period.until.getTime();
  return entries.filter((entry) => {
    const at = new Date(entry.paidAt).getTime();
    return at >= since && at < until;
  });
}

type CurrencyBucket = Omit<CurrencyRevenue, "daily" | "products"> & {
  days: Map<string, number>;
  products: Map<string, RevenueProduct>;
};

function emptyBucket(currency: string): CurrencyBucket {
  return {
    currency,
    cents: 0,
    count: 0,
    previousCents: 0,
    previousCount: 0,
    refundedCents: 0,
    refundedCount: 0,
    packCents: 0,
    packCount: 0,
    previousPackCents: 0,
    previousPackCount: 0,
    allTimeCents: 0,
    allTimeCount: 0,
    allTimeRefundedCents: 0,
    days: new Map(),
    products: new Map(),
  };
}

/**
 * Pure: the period's figures, the period before it, the all-time totals, a
 * daily series and what was bought — from the rows of both logs. A payment
 * is in the period when it was paid in [since, until), and in the previous
 * one when paid in [previousSince, previousUntil) (the same stretch, earlier).
 */
export function summarizeRevenue(
  input: {
    payments: PaymentRow[];
    packs: PackPaymentRow[];
    packGrants?: PackGrantRow[] | null;
  },
  period: RevenuePeriod,
  usernames: ReadonlyMap<string, string | null> = new Map(),
): RevenueSummary {
  const since = period.since.getTime();
  const previousSince = period.previousSince.getTime();
  const previousUntil = period.previousUntil.getTime();
  const until = period.until.getTime();
  const entries = revenueEntries(input.payments, input.packs);
  const buckets = new Map<string, CurrencyBucket>();
  const bucketOf = (currency: string): CurrencyBucket => {
    const key = currency.toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = emptyBucket(key)));
    return bucket;
  };
  const inPeriod: RevenueEntry[] = [];
  let trialStarts = 0;
  let disputed = 0;
  for (const entry of entries) {
    const at = new Date(entry.paidAt).getTime();
    const current = at >= since && at < until;
    const previous = at >= previousSince && at < previousUntil;
    if (current) {
      inPeriod.push(entry);
      if (entry.kind === "trial_start") trialStarts += 1;
      if (isDisputed(entry)) disputed += 1;
    }
    if (!isMoneyTaken(entry)) continue;
    const bucket = bucketOf(entry.currency);
    const pack = entry.kind === "pack";
    bucket.allTimeCents += entry.amountCents;
    bucket.allTimeCount += 1;
    bucket.allTimeRefundedCents += entry.refundedCents;
    if (current) {
      bucket.cents += entry.amountCents;
      bucket.count += 1;
      if (pack) {
        bucket.packCents += entry.amountCents;
        bucket.packCount += 1;
      }
      if (entry.refundedCents > 0) {
        bucket.refundedCents += entry.refundedCents;
        bucket.refundedCount += 1;
      }
      const day = utcDayKey(entry.paidAt);
      bucket.days.set(day, (bucket.days.get(day) ?? 0) + entry.amountCents);
      const { key, label } = revenueProductOf(entry);
      const product = bucket.products.get(key) ?? { key, label, cents: 0, count: 0 };
      product.cents += entry.amountCents;
      product.count += 1;
      bucket.products.set(key, product);
    } else if (previous) {
      bucket.previousCents += entry.amountCents;
      bucket.previousCount += 1;
      if (pack) {
        bucket.previousPackCents += entry.amountCents;
        bucket.previousPackCount += 1;
      }
    }
  }
  const currencies: CurrencyRevenue[] = [...buckets.values()]
    .sort((a, b) => (a.currency === "usd" ? -1 : b.currency === "usd" ? 1 : a.currency.localeCompare(b.currency)))
    .map(({ days, products, ...totals }) => ({
      ...totals,
      daily: fillDays(
        period.dayKeys,
        [...days].map(([day, value]) => ({ day, value })),
      ),
      products: [...products.values()].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label)),
    }));
  let unpricedPackSales: number | null = null;
  if (input.packGrants) {
    const priced = new Set(input.packs.map((p) => `pack:${p.checkout_session_id}`));
    unpricedPackSales = input.packGrants.filter((g) => !g.idempotency_key || !priced.has(g.idempotency_key)).length;
  }
  const sum = (pick: (c: CurrencyRevenue) => number) => currencies.reduce((n, c) => n + pick(c), 0);
  return {
    currencies,
    count: sum((c) => c.count),
    previousCount: sum((c) => c.previousCount),
    allTimeCount: sum((c) => c.allTimeCount),
    trialStarts,
    disputed,
    unpricedPackSales,
    entries: inPeriod.slice(0, REVENUE_LIST_LIMIT).map((entry) => ({
      ...entry,
      username: entry.userId ? (usernames.get(entry.userId) ?? null) : null,
    })),
    entriesTotal: inPeriod.length,
  };
}

/**
 * The Revenue tab's figures for one period. Null for a non-admin and when a
 * log could not be read whole — the tab then says it could not load, never
 * part of a log summed as if it were all of it.
 */
export async function getRevenueSummary(period: RevenuePeriod): Promise<RevenueSummary | null> {
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
  // A failed page — or a log longer than the cap (the safety stop) — is a
  // failed read: never part of a log summed as if it were all of it.
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
  // Names for the payments the tab lists (the id's first characters stand
  // in for one that could not be read).
  const ids = [
    ...new Set(
      revenueEntriesIn(revenueEntries(payments, packs), period)
        .slice(0, REVENUE_LIST_LIMIT)
        .map((e) => e.userId)
        .filter(Boolean),
    ),
  ] as string[];
  const usernames = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, username").in("id", ids);
    for (const p of profiles ?? []) usernames.set(p.id, p.username ?? null);
  }
  return summarizeRevenue({ payments, packs, packGrants: grants }, period, usernames);
}
