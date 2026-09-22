import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  MONTHLY_CREDITS,
  creditRefillKey,
  creditUpgradeKey,
  currentCreditPeriod,
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
//
// Free tier (owner decision 2026-09-15, reversing 2026-07-28): Free refills
// monthly too — 5 credits — so the pricing page's "every month" is true for
// every tier. The daily sweep therefore walks EVERY profile, not just paid
// subscribers; a profile's effective tier decides the amount. The signup
// default (`profiles.credits default 5`, no ledger row) is that month's
// allotment, so free profiles created in the current period are skipped.
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

/** The profile columns the sweep reads. */
export type RefillProfileRow = {
  id: string;
  subscription_tier: string | null;
  subscription_status: string | null;
  /** Admin comp (lib/billing/entitlements.ts): an unexpired comp is owed its
   *  tier's allotment like a paying subscriber — the pricing page promises
   *  the credits with the plan, and a comp IS the plan. */
  comp_tier?: string | null;
  comp_expires_at?: string | null;
  is_admin: boolean | null;
  created_at: string | null;
};

const TIER_RANK: Record<PlanTier, number> = { free: 0, plus: 1, pro: 2 };

function activeCompTier(profile: RefillProfileRow, now: Date): PlanTier | null {
  const comp = profile.comp_tier;
  if (comp !== "plus" && comp !== "pro") return null;
  if (profile.comp_expires_at && new Date(profile.comp_expires_at) <= now) return null;
  return comp;
}

/**
 * Which tier's allotment a profile is owed this period, or null when the
 * sweep should leave it alone:
 *   • admins — unlimited credits, a grant is ledger noise;
 *   • trialing — a trial's single grant lands on subscription.created
 *     (see subscription-sync.ts); refilling here let a no-card 7-day trial
 *     spanning a month boundary bank a second allotment without paying;
 *   • active plus/pro → that tier; an unexpired admin comp counts the same
 *     way (higher of the two);
 *   • everyone else (free, lapsed, canceled) → free — except a free profile
 *     created THIS period, whose signup default already is the allotment.
 */
export function refillTierFor(
  profile: RefillProfileRow,
  period: string,
  now: Date = new Date(),
): PlanTier | null {
  if (profile.is_admin) return null;
  const status = profile.subscription_status ?? null;
  const comp = activeCompTier(profile, now);
  if (status === "trialing" && !comp) return null;
  const tier = profile.subscription_tier ?? "free";
  const subscribed: PlanTier | null =
    status === "active" && (tier === "plus" || tier === "pro") ? tier : null;
  // An unexpired comp can only ADD: the higher of comp and live subscription.
  const owed =
    comp && (!subscribed || TIER_RANK[comp] > TIER_RANK[subscribed]) ? comp : subscribed;
  if (owed) return owed;
  if (profile.created_at && currentCreditPeriod(new Date(profile.created_at)) === period) {
    return null;
  }
  return "free";
}

/**
 * The daily refill sweep: page through EVERY profile (id-ordered ranges of
 * REFILL_PAGE_SIZE) and grant each the allotment `refillTierFor` says it is
 * owed. Offset pagination is stable because grants never change the read
 * columns. A page-read failure aborts with the stats so far — the grants are
 * idempotent, so the next daily run resumes harmlessly.
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
      .select("id, subscription_tier, subscription_status, comp_tier, comp_expires_at, is_admin, created_at")
      .order("id", { ascending: true })
      .range(from, from + REFILL_PAGE_SIZE - 1);
    if (error) return { ok: false, error: error.message };
    for (const profile of (page ?? []) as RefillProfileRow[]) {
      const tier = refillTierFor(profile, period);
      if (!tier) continue;
      const result = await grantMonthlyCreditsForPeriod(admin, profile.id, tier, period);
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
