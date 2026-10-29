import { planForTier, type PlanTier } from "@/lib/billing/plans";
import { planEndingShortText } from "@/lib/billing/plan-ending";
import { DELINQUENT_SUBSCRIPTION_STATUSES, LIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/viewer";
import type { DateText } from "@/lib/format/dates";

// ---------------------------------------------------------------------------
// The Account menu's plan line (components/layout/user-menu.tsx, TODO NV1):
// what plan the viewer is on, in a few words. The billing page's plan card
// decides the same facts in the same order (planStatusOf: a broken payment
// first, then a cancelled plan, then a complimentary one) and the facts are
// the ones /api/me and the (app) layout already carry — this reads them, it
// keeps no state of its own. Parts, not a string: a cancelled plan's date
// is printed in the viewer's own zone (`<LocalDateText>`).
//
//   an admin              "Admin" (unlocked: no plan, no limits)
//   a broken payment      "Pro · payment due" — the plan it is FOR; the
//                         effective tier is Free while it is paused
//   a cancelled plan      "Pro · ends Oct 23, 2026" (planEndingOf's facts)
//   a comped account      "Pro · complimentary"
//   otherwise             "Pro plan", "Free plan"
// ---------------------------------------------------------------------------

export type AccountPlanFacts = {
  isAdmin?: boolean;
  isPaid?: boolean;
  /** The EFFECTIVE tier (Entitlements.effectiveTier). */
  tier?: PlanTier | null;
  /** The plan subscribed to, even while its payment is broken
   *  (Entitlements.tier). */
  subscribedTier?: PlanTier | null;
  /** `profiles.subscription_status`. */
  subscriptionStatus?: string | null;
  /** A subscription Stripe still bills (active / trialing). */
  hasLiveSubscription?: boolean;
  /** Cancelled and still running — from planEndingOf (/api/me, the (app)
   *  layout). */
  subscriptionEnding?: boolean;
  subscriptionEndsAt?: string | null;
  subscriptionEndingKind?: "plan" | "trial" | null;
};

export function accountPlanLine(user: AccountPlanFacts): DateText | null {
  if (user.isAdmin) return ["Admin"];
  const status = user.subscriptionStatus ?? null;
  const live = user.hasLiveSubscription ?? (status != null && LIVE_SUBSCRIPTION_STATUSES.has(status));
  if (!live && status != null && DELINQUENT_SUBSCRIPTION_STATUSES.has(status)) {
    const tier = user.subscribedTier && user.subscribedTier !== "free" ? user.subscribedTier : (user.tier ?? "free");
    return [`${planForTier(tier).name} · payment due`];
  }
  const tier = user.tier ?? (user.isPaid ? null : "free");
  if (!tier) return null;
  const name = planForTier(tier).name;
  if (tier === "free") return [`${name} plan`];
  if (live && user.subscriptionEnding && user.subscriptionEndsAt) {
    return [
      `${name} · `,
      ...planEndingShortText({ kind: user.subscriptionEndingKind ?? "plan", endsAt: user.subscriptionEndsAt }),
    ];
  }
  // Paid perks with no subscription Stripe bills: an admin's comp.
  if (!live) return [`${name} · complimentary`];
  return [`${name} plan`];
}
