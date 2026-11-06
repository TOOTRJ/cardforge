import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { MONTHLY_CREDITS, type PaidTier } from "@/lib/billing/plans";
import { FREE_DAYS_UNIT_SECONDS } from "@/lib/billing/free-days";

// ---------------------------------------------------------------------------
// The credits of a free-days grant (migration 0176 `plan_grants`): one
// allotment of the tier's monthly credits per 30-day unit, at the START of
// each — `credits_from + k × 30 d` for k = 0, 1, … — under the ledger key
// `grant:<id>:<k>` (reason `plan_grant`). The daily refill cron runs this
// sweep after the subscribers' one; `grant_credits` dedupes on the key, so
// a rerun grants nothing twice and a missed day is caught up the next.
//
// The FIRST allotment is also granted the moment the grant is applied
// (`grantCreditsForGrant`, called by lib/billing/free-days-apply.ts): a
// referral's free days turned the plan badge to Plus at once while the 30
// credits waited for the 06:00 UTC cron — "Remaining 4 · Monthly allotment
// 30" for up to a day (owner, production, 2026-11-06). The cron stays the
// catch-up for later allotments and for a grant whose first call failed.
//
// It replaces the calendar-month rule a comp had before (an unexpired comp
// was "owed its tier every month" by lib/billing/credit-refill.ts — a
// 30-day grant starting Nov 20 banked November AND December): a grant's
// allotments are its own, whatever the calendar. A converted comp (0176)
// starts its count on the first of the month after the conversion, because
// the old rule had already granted the current month.
//
// A `subscription_hold` grant's user reads `trialing` on Stripe while the
// days run: the subscribers' sweep skips trials and the webhook grants a
// trial nothing after its creation — these allotments are what they get
// until the first invoice after the hold pays (that one refills as a paid
// month, lib/stripe/subscription-sync.ts). `below_plan`, pending, failed
// and revoked grants get nothing.
// ---------------------------------------------------------------------------

export type CreditGrantClient = ReturnType<typeof createAdminClient>;

/** The columns the sweep reads. */
export type PlanGrantCreditRow = {
  id: string;
  user_id: string;
  tier: string;
  units: number | null;
  credits_from: string;
  ends_at: string | null;
  applied_as: string;
  status: string;
  /** False: a days-bank application (0179) — no allotments of its own. */
  grants_credits?: boolean | null;
};

export const GRANT_SWEEP_PAGE_SIZE = 500;
/** A grant that ended longer ago than this owes nothing a daily cron could
 *  still have missed (the subscribers' backstop uses the same length). */
export const GRANT_SWEEP_LOOKBACK_DAYS = 35;
/** An open-ended (staff) grant is bounded here: 1,000 units is 82 years. */
const OPEN_ENDED_MAX_UNITS = 1000;

export function planGrantCreditKey(grantId: string, k: number): string {
  return `grant:${grantId}:${k}`;
}

/**
 * The allotment indexes due NOW for this grant: k = 0 … units − 1 whose
 * instant (`credits_from + k × 30 d`) has arrived and falls before the
 * grant's end. Pure; the caller subtracts what the ledger already holds.
 */
export function freeDaysAllotmentsDue(
  grant: Pick<PlanGrantCreditRow, "units" | "credits_from" | "ends_at" | "status" | "applied_as" | "grants_credits">,
  now: Date = new Date(),
): number[] {
  if (grant.status !== "applied") return [];
  if (grant.grants_credits === false) return [];
  if (grant.applied_as !== "overlay" && grant.applied_as !== "subscription_hold") return [];
  const from = Date.parse(grant.credits_from);
  if (!Number.isFinite(from)) return [];
  const end = grant.ends_at ? Date.parse(grant.ends_at) : null;
  if (grant.ends_at && !Number.isFinite(end)) return [];
  const max = grant.units == null ? OPEN_ENDED_MAX_UNITS : grant.units;
  const due: number[] = [];
  for (let k = 0; k < max; k += 1) {
    const at = from + k * FREE_DAYS_UNIT_SECONDS * 1000;
    if (at > now.getTime()) break;
    if (end != null && at >= end) break;
    due.push(k);
  }
  return due;
}

export type GrantSweepResult =
  | { ok: true; processed: number; granted: number; failed: number }
  | { ok: false; error: string };

/**
 * Grant every applied free-days grant the allotments it is owed. Pages the
 * live grants (and those ended within the lookback), reads each one's
 * ledger keys once, and calls `grant_credits` for the missing ones. Each
 * failure is logged and handed to `onGrantFailed` (the cron alerts the
 * admins); the next run retries it.
 */
export async function grantFreeDaysCredits(
  admin: CreditGrantClient,
  opts: { now?: Date; onGrantFailed?: (userId: string, error: string) => void } = {},
): Promise<GrantSweepResult> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - GRANT_SWEEP_LOOKBACK_DAYS * 86_400_000).toISOString();
  let processed = 0;
  let granted = 0;
  let failed = 0;
  for (let from = 0; ; from += GRANT_SWEEP_PAGE_SIZE) {
    const { data: page, error } = await admin
      .from("plan_grants")
      .select("id, user_id, tier, units, credits_from, ends_at, applied_as, status, grants_credits")
      .eq("status", "applied")
      .in("applied_as", ["overlay", "subscription_hold"])
      .or(`ends_at.is.null,ends_at.gte.${cutoff}`)
      .order("id", { ascending: true })
      .range(from, from + GRANT_SWEEP_PAGE_SIZE - 1);
    if (error) {
      console.error(`[refill-credits] plan_grants page read failed at row ${from}: ${error.message}`);
      return { ok: false, error: error.message };
    }
    for (const grant of (page ?? []) as PlanGrantCreditRow[]) {
      const due = freeDaysAllotmentsDue(grant, now);
      if (due.length === 0) continue;
      const result = await grantDueAllotments(admin, grant, due);
      if (result.ok) granted += result.granted;
      else {
        failed += 1;
        console.error(`[refill-credits] free-days grant ${grant.id} (user ${grant.user_id}) failed: ${result.error}`);
        opts.onGrantFailed?.(grant.user_id, result.error);
      }
    }
    processed += page?.length ?? 0;
    if ((page?.length ?? 0) < GRANT_SWEEP_PAGE_SIZE) break;
  }
  return { ok: true, processed, granted, failed };
}

/**
 * ONE grant's due allotments, now — what the sweep does per row, callable
 * the moment a grant is applied so its first credits land at once. Never
 * throws: a failure is the caller's warning and the cron's catch-up.
 */
export async function grantCreditsForGrant(
  admin: CreditGrantClient,
  grant: PlanGrantCreditRow,
  now: Date = new Date(),
  /** The plan state the WRITER just read from Stripe (status + tier): the
   *  overlay's allotment reads it instead of the profile row, which a
   *  webhook may not have synced yet (an `active` copy of a plan Stripe
   *  already holds past due would have docked the allotment). */
  planState?: OverlayPlanState,
): Promise<{ ok: true; granted: number } | { ok: false; error: string }> {
  const due = freeDaysAllotmentsDue(grant, now);
  if (due.length === 0) return { ok: true, granted: 0 };
  try {
    return await grantDueAllotments(admin, grant, due, planState);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The allotment an OVERLAY grant adds on top of a running ACTIVE plan: the
 *  difference between the two tiers' credits (the plan's own allotment is
 *  the subscribers' sweep's / the invoice's), nothing when the plan's tier
 *  is the grant's or higher — the rule the overlay had before 0176 ("the
 *  higher of the two"). A comp converted by 0176 on a paying plan, or a
 *  past-due plan that recovers, lands here; a hold never does (its plan
 *  reads `trialing`). */
export type OverlayPlanState = { subscription_status?: string | null; subscription_tier?: string | null } | null;

export function overlayAllotmentOver(
  grantTier: PaidTier,
  profile: OverlayPlanState,
): number {
  const own = MONTHLY_CREDITS[grantTier] ?? 0;
  if (profile?.subscription_status !== "active") return own;
  const paid = profile.subscription_tier === "plus" || profile.subscription_tier === "pro" ? profile.subscription_tier : null;
  if (!paid) return own;
  return Math.max(0, own - (MONTHLY_CREDITS[paid] ?? 0));
}

async function grantDueAllotments(
  admin: CreditGrantClient,
  grant: PlanGrantCreditRow,
  due: number[],
  planState?: OverlayPlanState,
): Promise<{ ok: true; granted: number } | { ok: false; error: string }> {
  let amount = MONTHLY_CREDITS[grant.tier as PaidTier] ?? 0;
  if (amount > 0 && grant.applied_as === "overlay") {
    let state: OverlayPlanState = planState ?? null;
    if (planState === undefined) {
      const { data: profile, error } = await admin
        .from("profiles")
        .select("subscription_status, subscription_tier")
        .eq("id", grant.user_id)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      state = profile as OverlayPlanState;
    }
    amount = overlayAllotmentOver(grant.tier as PaidTier, state);
  }
  if (amount <= 0) return { ok: true, granted: 0 };
  // One read of what the ledger already holds for this grant; a failed read
  // falls through to the RPC, which dedupes on the key itself.
  const prefix = planGrantCreditKey(grant.id, 0).slice(0, -1);
  const { data } = await admin.from("credit_ledger").select("idempotency_key").like("idempotency_key", `${prefix}%`);
  const have = new Set(((data ?? []) as Array<{ idempotency_key: string | null }>).map((row) => row.idempotency_key));
  let granted = 0;
  for (const k of due) {
    const key = planGrantCreditKey(grant.id, k);
    if (have.has(key)) continue;
    const { error } = await admin.rpc("grant_credits", {
      p_user_id: grant.user_id,
      p_amount: amount,
      p_reason: "plan_grant",
      p_idempotency_key: key,
    });
    if (error) return { ok: false, error: error.message };
    granted += 1;
  }
  return { ok: true, granted };
}
