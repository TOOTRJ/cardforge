import "server-only";

import { requireAdminClient } from "./users-queries";
import { describeLedgerReason } from "@/lib/billing/ledger-reasons";

// ---------------------------------------------------------------------------
// Credits GRANTED by reason (owner 2026-11-06, with the one-time credits):
// how many credits each stream handed out — plan credits, free-period
// credits, packs, admin grants, referral credits, the old refills — in the
// last 30 days and all time. Summed in SQL by
// `admin_credit_grant_stats` (0181: positive deltas, grouped by the reason's
// head — the label the usage ledger prints); until that migration is on the
// database the rows are read paged past PostgREST's 1000-row cap and grouped
// here. Service role, admins only.
// ---------------------------------------------------------------------------

export type CreditGrantRow = { reason: string; label: string; credits: number; grants: number };
export type CreditGrantStats = { last30: CreditGrantRow[]; allTime: CreditGrantRow[] };

const PAGE = 1000;

function head(reason: string | null): string {
  return (reason ?? "").split(":")[0]?.trim().toLowerCase() || "other";
}

/** Pure: group positive ledger rows by their reason's head, largest first. */
export function groupCreditGrants(rows: Array<{ delta: unknown; reason: string | null }>): CreditGrantRow[] {
  const by = new Map<string, { credits: number; grants: number }>();
  for (const row of rows) {
    const delta = typeof row.delta === "number" ? row.delta : Number(row.delta);
    if (!Number.isFinite(delta) || delta <= 0) continue;
    const key = head(row.reason);
    const cur = by.get(key) ?? { credits: 0, grants: 0 };
    cur.credits += delta;
    cur.grants += 1;
    by.set(key, cur);
  }
  return [...by.entries()]
    .map(([reason, v]) => ({ reason, label: describeLedgerReason(reason), credits: v.credits, grants: v.grants }))
    .sort((a, b) => b.credits - a.credits);
}

/** The SQL function's rows, labelled (it sums and sorts; a bad row is skipped). */
export function labelCreditGrants(rows: Array<{ reason: unknown; credits: unknown; grants: unknown }>): CreditGrantRow[] {
  const out: CreditGrantRow[] = [];
  for (const row of rows) {
    const credits = Number(row.credits);
    const grants = Number(row.grants);
    if (typeof row.reason !== "string" || !Number.isFinite(credits) || !Number.isFinite(grants)) continue;
    out.push({ reason: row.reason, label: describeLedgerReason(row.reason), credits, grants });
  }
  return out;
}

/** PostgREST "no such function" — the code is live before migration 0181. */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "");
}

async function readGrants(admin: NonNullable<Awaited<ReturnType<typeof requireAdminClient>>>, since: string | null) {
  const rows: Array<{ delta: unknown; reason: string | null }> = [];
  for (let from = 0; ; from += PAGE) {
    let query = admin.from("credit_ledger").select("delta, reason").gt("delta", 0).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (since) query = query.gte("created_at", since);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Array<{ delta: unknown; reason: string | null }>));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

/** Null for non-admins or when the read fails (the panel is left out). */
export async function getCreditGrantStats(now: Date = new Date()): Promise<CreditGrantStats | null> {
  const admin = await requireAdminClient();
  if (!admin) return null;
  try {
    const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const [d30, all] = await Promise.all([
      admin.rpc("admin_credit_grant_stats", { p_since: since30 }),
      admin.rpc("admin_credit_grant_stats", { p_since: null }),
    ]);
    if ([d30.error, all.error].some((e) => e && isMissingFunction(e))) {
      // The code is live before migration 0181: sum the ledger in the app.
      console.error("[admin] admin_credit_grant_stats is missing (migration 0181 not applied?) — summing the ledger in the app.");
      const [last30, allTime] = await Promise.all([readGrants(admin, since30), readGrants(admin, null)]);
      return { last30: groupCreditGrants(last30), allTime: groupCreditGrants(allTime) };
    }
    if (d30.error) throw new Error(d30.error.message);
    if (all.error) throw new Error(all.error.message);
    return {
      last30: labelCreditGrants((d30.data ?? []) as Array<{ reason: unknown; credits: unknown; grants: unknown }>),
      allTime: labelCreditGrants((all.data ?? []) as Array<{ reason: unknown; credits: unknown; grants: unknown }>),
    };
  } catch (error) {
    console.warn("getCreditGrantStats:", error instanceof Error ? error.message : error);
    return null;
  }
}
