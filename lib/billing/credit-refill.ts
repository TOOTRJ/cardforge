import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  MONTHLY_CREDITS,
  creditRefillKey,
  creditUpgradeKey,
  type PlanTier,
} from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Monthly subscription credit grants — the ONE code path shared by the Stripe
// webhook (subscription.created/updated) and the daily refill cron, so both
// entry points self-heal the same cases.
//
// Base grant: the first grant of a calendar month uses the per-user-per-month
// refill key, so webhook + cron calling in any order grant at most once.
//
// Upgrade top-up (the bug this module fixed, 2026-07-28): a mid-month tier
// upgrade used to grant NOTHING — the month's refill key was already consumed
// by the lower tier's grant, so a Plus subscriber upgrading to Pro paid
// prorated Pro immediately but saw none of the 75 credits until the next
// calendar month. Now, when the month's base grant is smaller than the
// current tier's allotment, the difference is granted under a tier-scoped
// upgrade key (idempotent, so a re-upgrade in the same month can't
// double-grant, and the cron backfills the top-up if the webhook missed it).
// Downgrades grant nothing — credits already banked are never clawed back.
// ---------------------------------------------------------------------------

/** The service-role client (grant_credits is service-role only). Exported so
 *  unit tests can cast a minimal stub to it. */
export type CreditGrantClient = ReturnType<typeof createAdminClient>;

export type MonthlyGrantResult =
  | { ok: true; granted: number }
  | { ok: false; error: string };

/** PostgREST caps un-ranged selects at 1000 rows — the refill sweep MUST
 *  paginate or subscriber #1001+ silently never refills (and the next day's
 *  "self-healing" rerun drops the very same tail). Exported for tests. */
export const REFILL_PAGE_SIZE = 1000;

export type RefillSweepResult =
  | { ok: true; processed: number; granted: number; failed: number }
  | { ok: false; error: string };

/**
 * The daily refill sweep: page through EVERY active paid subscriber (id-ordered
 * ranges of REFILL_PAGE_SIZE) and run the monthly grant for each. Trialing is
 * deliberately excluded — a trial's single grant lands on subscription.created
 * (see webhook-handlers.ts); refilling trialing here let a no-card 7-day trial
 * spanning a month boundary bank a second never-expiring allotment without
 * ever paying. Offset pagination is stable because grants never change the
 * filtered columns. A page-read failure aborts with the stats so far — the
 * grants are idempotent, so the next daily run resumes harmlessly.
 */
export async function refillActiveSubscribers(
  admin: CreditGrantClient,
  period: string,
): Promise<RefillSweepResult> {
  let processed = 0;
  let granted = 0;
  let failed = 0;

  for (let from = 0; ; from += REFILL_PAGE_SIZE) {
    const { data: page, error } = await admin
      .from("profiles")
      .select("id, subscription_tier")
      .eq("subscription_status", "active")
      .in("subscription_tier", ["plus", "pro"])
      .order("id", { ascending: true })
      .range(from, from + REFILL_PAGE_SIZE - 1);
    if (error) return { ok: false, error: error.message };

    for (const profile of page ?? []) {
      const result = await grantMonthlyCreditsForPeriod(
        admin,
        profile.id,
        profile.subscription_tier as PlanTier,
        period,
      );
      if (!result.ok) failed += 1;
      else granted += 1;
    }
    processed += page?.length ?? 0;
    if ((page?.length ?? 0) < REFILL_PAGE_SIZE) break;
  }

  return { ok: true, processed, granted, failed };
}

/**
 * Grant the user's monthly allotment for `tier` in `period` (idempotent), or
 * top up the shortfall after a mid-month upgrade. `granted` is what this call
 * ASKED grant_credits for — an already-used idempotency key silently no-ops
 * inside the RPC, so treat the number as intent, not a ledger delta.
 */
export async function grantMonthlyCreditsForPeriod(
  admin: CreditGrantClient,
  userId: string,
  tier: PlanTier,
  period: string,
): Promise<MonthlyGrantResult> {
  // Free NEVER refills — its 5 credits are the one-time signup grant (owner
  // decision, 2026-07-28). Guarded here, not just at the callers, because
  // MONTHLY_CREDITS.free is 5 (display copy) and a future call site passing
  // "free" through would otherwise quietly start a monthly free allotment.
  if (tier === "free") return { ok: true, granted: 0 };

  const amount = MONTHLY_CREDITS[tier] ?? 0;
  if (amount <= 0) return { ok: true, granted: 0 };

  const baseKey = creditRefillKey(userId, period);
  const { data: baseRow, error: readError } = await admin
    .from("credit_ledger")
    .select("delta")
    .eq("idempotency_key", baseKey)
    .maybeSingle();

  // A month that already granted: top up only a positive shortfall (upgrade).
  // Same tier or a downgrade leaves the banked credits untouched. A malformed
  // row (delta not a number) falls through to the idempotent base grant
  // rather than arithmetic on garbage.
  if (!readError && baseRow && Number.isFinite(baseRow.delta)) {
    const shortfall = amount - baseRow.delta;
    if (shortfall <= 0) return { ok: true, granted: 0 };
    const { error } = await admin.rpc("grant_credits", {
      p_user_id: userId,
      p_amount: shortfall,
      p_reason: "subscription_refill",
      p_idempotency_key: creditUpgradeKey(userId, period, tier),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, granted: shortfall };
  }

  // No base grant yet this month — or the ledger read failed, in which case
  // falling through to the base grant is safe (grant_credits dedupes on the
  // key; worst case the upgrade top-up waits for the next webhook/cron pass).
  const { error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: "subscription_refill",
    p_idempotency_key: baseKey,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, granted: amount };
}
