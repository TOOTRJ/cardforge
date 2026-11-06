import "server-only";

import { requireAdminClient } from "./users-queries";
import { describeLedgerReason } from "@/lib/billing/ledger-reasons";

// ---------------------------------------------------------------------------
// Credits GRANTED by reason (owner 2026-11-06, with the one-time credits):
// how many credits each stream handed out — plan credits, free-period
// credits, packs, admin grants, referral credits, the old refills — in the
// last 30 days and all time. Read from credit_ledger (positive deltas),
// paged past PostgREST's 1000-row cap, grouped by the reason's head (the
// label the usage ledger prints). Service role, admins only.
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
    const [last30, allTime] = await Promise.all([readGrants(admin, since30), readGrants(admin, null)]);
    return { last30: groupCreditGrants(last30), allTime: groupCreditGrants(allTime) };
  } catch (error) {
    console.warn("getCreditGrantStats:", error instanceof Error ? error.message : error);
    return null;
  }
}
