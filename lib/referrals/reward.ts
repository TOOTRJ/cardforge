import { TIER_RANK, planForTier, type PlanTier } from "@/lib/billing/plans";
import { REFERRAL_MONTH_DAYS } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// How "one free month" reaches a user (docs/BILLING.md "Referrals"; research
// §8.6). One pure decision per user, from the profile row:
//
//   * a RENEWING Stripe subscription (active or trialing, not cancelled) →
//     a customer-BALANCE credit of one month at the subscription's own price
//     (an annual plan: a twelfth of the year). Stripe applies it to the next
//     invoice by itself; the plan's status, dates and trial are untouched —
//     no second trial path, no annual year made free by a 100 %-off coupon.
//   * anyone else — free, comped, a cancelled plan still running, a broken
//     payment → a COMP month (profiles.comp_tier / comp_expires_at, the admin
//     comp's columns): Plus, or the higher tier they already have; 30 days
//     added to whatever runs longest — an unexpired comp, or a cancelled
//     plan's end date — so a month is never swallowed by one already owed.
//   * an admin (unlimited) or an open-ended comp (no end to add to) → none.
// ---------------------------------------------------------------------------

export type ReferralRewardProfile = {
  is_admin?: boolean | null;
  subscription_tier?: string | null;
  subscription_status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  cancel_at_period_end?: boolean | null;
  current_period_end?: string | null;
  subscription_ends_at?: string | null;
  comp_tier?: string | null;
  comp_expires_at?: string | null;
};

export type ReferralMonthPlan =
  | { kind: "balance_credit"; customerId: string; subscriptionId: string; tier: PlanTier }
  | { kind: "comp_month"; tier: PlanTier; expiresAt: string }
  | { kind: "none"; reason: "admin" | "comp_open_ended" };

const DAY_MS = 86_400_000;
const LIVE = new Set(["active", "trialing"]);

function paidTier(value: string | null | undefined): PlanTier | null {
  return value === "plus" || value === "pro" ? value : null;
}

export function planReferralMonth(profile: ReferralRewardProfile, now: Date = new Date()): ReferralMonthPlan {
  if (profile.is_admin) return { kind: "none", reason: "admin" };
  const live = LIVE.has(profile.subscription_status ?? "");
  const subTier = live ? paidTier(profile.subscription_tier) : null;
  const ending = Boolean(profile.subscription_ends_at) || Boolean(profile.cancel_at_period_end);
  if (live && !ending && subTier && profile.stripe_customer_id && profile.stripe_subscription_id) {
    return {
      kind: "balance_credit",
      customerId: profile.stripe_customer_id,
      subscriptionId: profile.stripe_subscription_id,
      tier: subTier,
    };
  }

  const nowMs = now.getTime();
  const compTier = paidTier(profile.comp_tier);
  const compExpiryMs = profile.comp_expires_at ? Date.parse(profile.comp_expires_at) : null;
  const compActive = compTier != null && (compExpiryMs == null || compExpiryMs > nowMs);
  if (compActive && compExpiryMs == null) return { kind: "none", reason: "comp_open_ended" };

  let tier: PlanTier = "plus";
  if (compActive && compTier && TIER_RANK[compTier] > TIER_RANK[tier]) tier = compTier;
  if (subTier && TIER_RANK[subTier] > TIER_RANK[tier]) tier = subTier;

  // The month starts where what is already owed ends.
  const endsMs = live && ending
    ? Date.parse(profile.subscription_ends_at ?? profile.current_period_end ?? "")
    : NaN;
  const base = Math.max(
    nowMs,
    compActive && compExpiryMs != null ? compExpiryMs : 0,
    Number.isFinite(endsMs) ? endsMs : 0,
  );
  return { kind: "comp_month", tier, expiresAt: new Date(base + REFERRAL_MONTH_DAYS * DAY_MS).toISOString() };
}

/** One month of a subscription price in cents: the monthly price, or a
 *  twelfth of a yearly one (rounded). The plan's list price when Stripe's
 *  price can't be read. */
export function oneMonthCents(
  price: { unit_amount?: number | null; recurring?: { interval?: string; interval_count?: number } | null } | null | undefined,
  tier: PlanTier,
): number {
  const unit = price?.unit_amount;
  const interval = price?.recurring?.interval;
  const count = Math.max(1, price?.recurring?.interval_count ?? 1);
  if (typeof unit === "number" && unit > 0) {
    if (interval === "year") return Math.round(unit / (12 * count));
    if (interval === "month") return Math.round(unit / count);
  }
  return Math.round(planForTier(tier).priceUsd * 100);
}
