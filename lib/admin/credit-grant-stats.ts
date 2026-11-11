import "server-only";

import { requireAdminClient } from "./users-queries";
import { describeLedgerReason } from "@/lib/billing/ledger-reasons";

// ---------------------------------------------------------------------------
// Credits GRANTED by reason (owner 2026-11-06, with the one-time credits):
// how many credits each stream handed out — plan credits, free-period
// credits, packs, admin grants, referral credits, the old refills — in a
// PERIOD and all time, for /admin/analytics' "Credits and AI" tab. Summed
// in SQL by `admin_credit_grant_stats` (0181; 0197 added the admin filter:
// positive deltas, grouped by the reason's head — the label the usage
// ledger prints). Service role, admins only.
//
// A REFUND is not a grant: it gives a charge back. The function returns it
// as one more positive reason; it is left out here, and the tab counts
// refunds on their own (admin_credit_flow, 0201) — so this table adds up to
// the tab's "Credits granted".
// ---------------------------------------------------------------------------

export type CreditGrantRow = { reason: string; label: string; credits: number; grants: number };
export type CreditGrantStats = {
  /** Since the period's start. */
  period: CreditGrantRow[];
  allTime: CreditGrantRow[];
};

const DAY_MS = 86_400_000;

/** The SQL function's rows, labelled (it sums and sorts; a bad row is
 *  skipped, and so is `refund` — a charge given back, not a grant). */
export function labelCreditGrants(rows: Array<{ reason: unknown; credits: unknown; grants: unknown }>): CreditGrantRow[] {
  const out: CreditGrantRow[] = [];
  for (const row of rows) {
    const credits = Number(row.credits);
    const grants = Number(row.grants);
    if (typeof row.reason !== "string" || !Number.isFinite(credits) || !Number.isFinite(grants)) continue;
    if (row.reason === "refund") continue;
    out.push({ reason: row.reason, label: describeLedgerReason(row.reason), credits, grants });
  }
  return out;
}

/**
 * Credits granted since `since` (default: 30 days ago) and all time, with
 * the team's own accounts left out unless `includeAdmins`. Null for
 * non-admins or when a read fails (the tab says it could not load).
 */
export async function getCreditGrantStats(
  options: { since?: Date; includeAdmins?: boolean } = {},
): Promise<CreditGrantStats | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  const since = (options.since ?? new Date(Date.now() - 30 * DAY_MS)).toISOString();
  const includeAdmins = options.includeAdmins ?? false;
  try {
    const [period, all] = await Promise.all([
      admin.rpc("admin_credit_grant_stats", { p_since: since, p_include_admins: includeAdmins }),
      admin.rpc("admin_credit_grant_stats", { p_since: null, p_include_admins: includeAdmins }),
    ]);
    if (period.error) throw new Error(period.error.message);
    if (all.error) throw new Error(all.error.message);
    return {
      period: labelCreditGrants((period.data ?? []) as Array<{ reason: unknown; credits: unknown; grants: unknown }>),
      allTime: labelCreditGrants((all.data ?? []) as Array<{ reason: unknown; credits: unknown; grants: unknown }>),
    };
  } catch (error) {
    console.error("[admin] admin_credit_grant_stats failed:", error instanceof Error ? error.message : error);
    return null;
  }
}
