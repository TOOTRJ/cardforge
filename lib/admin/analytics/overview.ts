import "server-only";

import { requireAdminClient } from "@/lib/admin/users-queries";
import {
  readFunnelCountsWithPrevious,
  readSignupsDaily,
  type FunnelCounts,
  type SignupsDaily,
} from "@/lib/admin/funnel-queries";
import { selectAllRows } from "@/lib/supabase/select-all-rows";
import type { AnalyticsPeriod } from "@/lib/admin/analytics/params";

// ---------------------------------------------------------------------------
// The Overview tab's data (/admin/analytics): the page's front door, so it
// reads little — the two event counts (this period, the one before), the
// signups per day, and the money rows of both periods. Three blocks, read at
// once; a block whose read failed is null (the tab says it could not load),
// never zeros.
//
// Revenue here is money TAKEN (before refunds: the Revenue tab's own
// headline — it shows refunds beside it), by the day it was paid, per
// currency (amounts in different currencies are never added) — from the two
// logs the Stripe webhook writes: billing_payments (0110, one row per paid
// invoice) and billing_pack_payments (0138, one per paid credit pack). It
// counts everyone: money is money whoever paid it, so the "Include admins"
// switch does not move it.
// ---------------------------------------------------------------------------

/** A sale: an invoice or a credit pack. `key` is unique across both logs. */
export type MoneyRow = {
  key: string;
  amount_cents: number;
  currency: string;
  paid_at: string;
};

/** One currency's revenue: this period beside the one before. */
export type CurrencyRevenue = { currency: string; currentCents: number; previousCents: number };

export type OverviewSummary = {
  counts: { current: FunnelCounts; previous: FunnelCounts } | null;
  signups: SignupsDaily | null;
  revenue: CurrencyRevenue[] | null;
};

/**
 * Pure: money TAKEN per currency (before refunds — the Revenue tab's own
 * headline), for the period and the stretch it is compared with. A sale
 * counts in the period it was PAID in; a row handed back twice (an offset read over a list
 * that grew) counts once; a sale outside both periods counts nowhere. USD
 * first, then by code — and one USD row of zeros when nothing was sold, so
 * the tab always has a revenue tile.
 */
export function revenueByCurrency(
  rows: ReadonlyArray<MoneyRow>,
  period: Pick<AnalyticsPeriod, "since" | "until" | "previousSince" | "previousUntil">,
): CurrencyRevenue[] {
  const since = period.since.getTime();
  const until = period.until.getTime();
  const previousSince = period.previousSince.getTime();
  const previousUntil = period.previousUntil.getTime();
  const seen = new Set<string>();
  const byCurrency = new Map<string, CurrencyRevenue>();
  for (const row of rows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const at = new Date(row.paid_at).getTime();
    if (!Number.isFinite(at) || at < previousSince || at >= until) continue;
    const currency = (row.currency || "usd").toLowerCase();
    // Money TAKEN — the Revenue tab's headline figure, so the two tiles
    // called "Revenue" are one number. Refunds are shown beside it there.
    const taken = Math.max(0, row.amount_cents);
    const entry = byCurrency.get(currency) ?? { currency, currentCents: 0, previousCents: 0 };
    if (at >= since) entry.currentCents += taken;
    else if (at < previousUntil) entry.previousCents += taken;
    else continue; // the rest of that earlier day: in neither period
    byCurrency.set(currency, entry);
  }
  if (byCurrency.size === 0) return [{ currency: "usd", currentCents: 0, previousCents: 0 }];
  return [...byCurrency.values()].sort(
    (a, b) => Number(b.currency === "usd") - Number(a.currency === "usd") || a.currency.localeCompare(b.currency),
  );
}

type AdminClient = NonNullable<Awaited<ReturnType<typeof requireAdminClient>>>;

/** Both logs' rows paid since the previous period began — in pages, oldest
 *  first (an un-ranged read stops at 1,000 rows and says nothing). Null
 *  when either log could not be read whole. */
async function readMoneyRows(admin: AdminClient, period: AnalyticsPeriod): Promise<MoneyRow[] | null> {
  const from = period.previousSince.toISOString();
  const to = period.until.toISOString();
  const [invoices, packs] = await Promise.all([
    selectAllRows<{ invoice_id: string; amount_cents: number; currency: string; paid_at: string }>(
      (start, end) =>
        admin
          .from("billing_payments")
          .select("invoice_id, amount_cents, currency, paid_at")
          .gte("paid_at", from)
          .lt("paid_at", to)
          .order("paid_at", { ascending: true })
          .order("invoice_id", { ascending: true })
          .range(start, end),
    ),
    selectAllRows<{ checkout_session_id: string; amount_cents: number; currency: string; paid_at: string }>(
      (start, end) =>
        admin
          .from("billing_pack_payments")
          .select("checkout_session_id, amount_cents, currency, paid_at")
          .gte("paid_at", from)
          .lt("paid_at", to)
          .order("paid_at", { ascending: true })
          .order("checkout_session_id", { ascending: true })
          .range(start, end),
    ),
  ]);
  if (invoices.error || packs.error) {
    console.error("[admin/analytics] overview revenue read failed:", (invoices.error ?? packs.error)?.message);
    return null;
  }
  return [
    ...invoices.data.map((row) => ({ ...row, key: `invoice:${row.invoice_id}` })),
    ...packs.data.map((row) => ({ ...row, key: `pack:${row.checkout_session_id}` })),
  ];
}

/**
 * Everything the Overview tab shows, for `period`. `includeAdmins` goes to
 * the counts and the signups; revenue counts everyone. Null when the viewer
 * is not an admin.
 */
export async function getOverviewSummary(period: AnalyticsPeriod, includeAdmins = false): Promise<OverviewSummary | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const [counts, signups, money] = await Promise.all([
    readFunnelCountsWithPrevious(admin, period, includeAdmins),
    readSignupsDaily(admin, period, includeAdmins),
    readMoneyRows(admin, period),
  ]);
  return { counts, signups, revenue: money ? revenueByCurrency(money, period) : null };
}
