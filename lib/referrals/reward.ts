import type { PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// How "one free month" reaches a user (docs/BILLING.md "Referrals"; research
// §8.6). One pure decision per user, from the profile row:
//
//   * a RENEWING Stripe subscription (active or trialing, not cancelled) →
//     a customer-BALANCE credit of one month at the subscription's own price
//     (an annual plan: a twelfth of the year). Stripe applies it to the next
//     invoice by itself; the plan's status, dates and trial are untouched —
//     no second trial path, no annual year made free by a 100 %-off coupon.
//     Its AI credits are the plan's own (the invoice's refill).
//   * anyone else — free, comped, a cancelled plan still running, a broken
//     payment → a month of PLUS (`plus_month`): profiles.referral_plus_until,
//     a Plus overlay kept apart from the admin comp, and ONE Plus allotment
//     of AI credits granted with it (owner 2026-11-02). The database decides
//     where the month starts — after a running referral month, an unexpired
//     comp or a cancelled plan's end — under a per-user lock
//     (0164's grant_referral_plus_month), so two rewards never race.
//   * an admin (unlimited), or an open-ended comp (it never ends, so a month
//     after it never starts) → none.
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
  | { kind: "plus_month" }
  | { kind: "none"; reason: "admin" | "comp_open_ended" };

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

  const compTier = paidTier(profile.comp_tier);
  const compExpiryMs = profile.comp_expires_at ? Date.parse(profile.comp_expires_at) : null;
  const compActive = compTier != null && (compExpiryMs == null || compExpiryMs > now.getTime());
  if (compActive && compExpiryMs == null) return { kind: "none", reason: "comp_open_ended" };

  return { kind: "plus_month" };
}

/** One month of a subscription price in cents (a twelfth of a yearly one)
 *  — main's shared helper (lib/billing/balance-credit.ts, #688), so a
 *  referral month and an admin comp price time the same way. */
export { oneMonthCents } from "@/lib/billing/balance-credit";
