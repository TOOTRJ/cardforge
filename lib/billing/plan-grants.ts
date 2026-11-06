import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import type { GrantAppliedAs, GrantSource } from "@/lib/billing/free-days";

/** The viewer's own HOLD on a PAYING plan (0176: a user reads their own
 *  rows' public columns), applied or revoked, whose start is still more
 *  than a minute ahead: the plan is PAID through `startsAt` (Stripe reads
 *  `trialing` until the hold's end — or, revoked, until that start, where
 *  it simply renews). Null when none. The billing page's copy. */
export async function readOwnHoldGrant(
  client: Awaited<ReturnType<typeof createClient>>,
  now: Date = new Date(),
): Promise<{ startsAt: string; endsAt: string; status: "applied" | "revoked" } | null> {
  const { data, error } = await client
    .from("plan_grants")
    .select("starts_at, ends_at, status")
    .in("status", ["applied", "revoked"])
    .eq("applied_as", "subscription_hold")
    .eq("held_from", "active")
    .gt("starts_at", new Date(now.getTime() + 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { starts_at: string; ends_at: string | null; status: "applied" | "revoked" };
  if (!row.ends_at) return null;
  return { startsAt: row.starts_at, endsAt: row.ends_at, status: row.status };
}

// The admin's read of a user's free-days grants (migration 0176) — newest
// first, with who gave each and the note. Service role only: the user's own
// read (PR F's referral page) uses the column-level grant and RLS.

export type PlanGrantRow = {
  id: string;
  tier: "plus" | "pro";
  units: number | null;
  /** An exact length (a days-bank application). */
  days: number | null;
  source: GrantSource;
  note: string | null;
  appliedAs: GrantAppliedAs;
  startsAt: string;
  endsAt: string | null;
  status: "pending" | "applied" | "failed" | "revoked";
  stripeError: string | null;
  createdAt: string;
  grantedBy: { username: string | null } | null;
};

export async function listPlanGrants(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ rows: PlanGrantRow[]; loadError: boolean }> {
  const { data, error } = await admin
    .from("plan_grants")
    .select(
      "id, tier, units, days, source, note, applied_as, starts_at, ends_at, status, stripe_error, created_at, granted_by:profiles!plan_grants_granted_by_fkey(username)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[admin/users] plan_grants read failed:", error.message);
    return { rows: [], loadError: true };
  }
  type Raw = {
    id: string;
    tier: "plus" | "pro";
    units: number | null;
    source: GrantSource;
    note: string | null;
    applied_as: GrantAppliedAs;
    starts_at: string;
    ends_at: string | null;
    status: PlanGrantRow["status"];
    stripe_error: string | null;
    created_at: string;
    granted_by: { username: string | null } | { username: string | null }[] | null;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map((row) => {
    const by = Array.isArray(row.granted_by) ? row.granted_by[0] ?? null : row.granted_by;
    return {
      id: row.id,
      tier: row.tier,
      units: row.units,
    days: (row as { days?: number | null }).days ?? null,
      source: row.source,
      note: row.note,
      appliedAs: row.applied_as,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      status: row.status,
      stripeError: row.stripe_error,
      createdAt: row.created_at,
      grantedBy: by,
    };
  });
  return { rows, loadError: false };
}
