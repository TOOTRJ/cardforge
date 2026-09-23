import "server-only";

import { requireAdminClient } from "./users-queries";

// ---------------------------------------------------------------------------
// What the admin Revenue panel shows from billing_payments (migration 0110,
// written by the webhook on every invoice.paid). Admin-gated like every
// other admin read; null when the viewer isn't an admin.
// ---------------------------------------------------------------------------

export type RevenuePayment = {
  invoiceId: string;
  userId: string | null;
  username: string | null;
  amountCents: number;
  currency: string;
  billingReason: string | null;
  tier: string | null;
  interval: string | null;
  paidAt: string;
  invoiceNumber: string | null;
  hostedInvoiceUrl: string | null;
};

export type RevenueSummary = {
  last30DaysCents: number;
  last30DaysCount: number;
  allTimeCents: number;
  allTimeCount: number;
  recent: RevenuePayment[];
};

export const REVENUE_RECENT_LIMIT = 8;

type PaymentRow = {
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

/** Pure: totals + the recent list from the rows (newest first). */
export function summarizeRevenue(
  rows: PaymentRow[],
  usernames: Map<string, string | null>,
  now = Date.now(),
): RevenueSummary {
  const since = now - 30 * 24 * 60 * 60 * 1000;
  let last30DaysCents = 0;
  let last30DaysCount = 0;
  let allTimeCents = 0;
  for (const row of rows) {
    allTimeCents += row.amount_cents;
    if (new Date(row.paid_at).getTime() >= since) {
      last30DaysCents += row.amount_cents;
      last30DaysCount += 1;
    }
  }
  const recent = [...rows]
    .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
    .slice(0, REVENUE_RECENT_LIMIT)
    .map((row) => ({
      invoiceId: row.invoice_id,
      userId: row.user_id,
      username: row.user_id ? (usernames.get(row.user_id) ?? null) : null,
      amountCents: row.amount_cents,
      currency: row.currency,
      billingReason: row.billing_reason,
      tier: row.tier,
      interval: row.billing_interval,
      paidAt: row.paid_at,
      invoiceNumber: row.invoice_number,
      hostedInvoiceUrl: row.hosted_invoice_url,
    }));
  return { last30DaysCents, last30DaysCount, allTimeCents, allTimeCount: rows.length, recent };
}

export async function getRevenueSummary(): Promise<RevenueSummary | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("billing_payments")
    .select(
      "invoice_id, user_id, amount_cents, currency, billing_reason, tier, billing_interval, paid_at, invoice_number, hosted_invoice_url",
    )
    .order("paid_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.warn("getRevenueSummary: query error", error.message);
    return null;
  }
  const rows = (data ?? []) as PaymentRow[];
  const ids = [...new Set(rows.slice(0, REVENUE_RECENT_LIMIT).map((r) => r.user_id).filter(Boolean))] as string[];
  const usernames = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, username").in("id", ids);
    for (const p of profiles ?? []) usernames.set(p.id, p.username ?? null);
  }
  return summarizeRevenue(rows, usernames);
}
