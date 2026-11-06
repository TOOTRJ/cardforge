import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// The perks overlay (`profiles.comp_tier` / `comp_expires_at`) and Stripe.
//
// Since migration 0176 every comp is a FREE-DAYS GRANT (lib/billing/free-days.ts
// decides, lib/billing/free-days-apply.ts writes): on a live, renewing plan
// or trial the days are added to the time paid for (`trial_end` moved,
// `proration_behavior: none`), otherwise the overlay alone carries them.
// What stays here is what the rest of the app reads of that:
//   • TRIAL_END_BEFORE_COMP_KEY — the subscription's trial end before ANY
//     hold (a revoke never moves it earlier; a cancel during the free days
//     is not a lapsed trial — lib/stripe/subscription-sync.ts);
//   • compHoldsCheckoutUntil — a user with a running overlay who subscribes
//     is not charged before it ends: Checkout starts the subscription with
//     `trial_end` at the overlay's end (lib/stripe/actions.ts);
//   • compOverLiveSubscription / liveCompChargeLine — the billing page's
//     line about a comp over a live plan.
// The balance credit (#688) and the coupon (#726) are retired: no money
// moves for free days, ever.
// ---------------------------------------------------------------------------

/** Subscription metadata key: the trial end (unix seconds) before a comp
 *  moved it. Cleared ("") when no free days hold the trial any more. */
export const TRIAL_END_BEFORE_COMP_KEY = "pipglyph_trial_end_before_comp";

/** Stripe refuses a trial end more than 730 days out. */
export const MAX_TRIAL_SECONDS = 730 * 86_400;

export type CompFacts = { tier: PlanTier | null; expiresAt: string | null };

/** Stripe Checkout refuses a `trial_end` less than 48 hours out. */
export const CHECKOUT_MIN_TRIAL_SECONDS = 48 * 3600;

/**
 * A comped user who subscribes from the billing page is not charged while
 * the comp runs: Checkout starts the subscription with `trial_end` at the
 * comp's end (the same rule as a hold, for a subscription that doesn't exist
 * yet). Null when no comp holds it: none, expired, undated, below the plan
 * bought, too close for Checkout (48 h) or past Stripe's trial limit.
 */
export function compHoldsCheckoutUntil(
  comp: CompFacts,
  tier: PlanTier,
  now: Date = new Date(),
): number | null {
  if (comp.tier == null || comp.expiresAt == null) return null;
  if (TIER_RANK[comp.tier] < TIER_RANK[tier]) return null;
  const nowSec = Math.floor(now.getTime() / 1000);
  const end = Math.floor(Date.parse(comp.expiresAt) / 1000);
  if (!Number.isFinite(end)) return null;
  if (end - nowSec < CHECKOUT_MIN_TRIAL_SECONDS || end - nowSec > MAX_TRIAL_SECONDS) return null;
  return end;
}

/**
 * A comp that applies ON TOP of a live subscription (the billing page's
 * extra line — `comped` there means "no subscription"): unexpired and at or
 * above the plan paid for, else null. Same resolution as effectiveTierForProfile.
 */
export function compOverLiveSubscription(
  profile: { comp_tier?: string | null; comp_expires_at?: string | null; subscription_tier?: string | null },
  now: Date = new Date(),
): { tier: PlanTier; expiresAt: string | null } | null {
  const tier = profile.comp_tier === "plus" || profile.comp_tier === "pro" ? profile.comp_tier : null;
  if (!tier) return null;
  if (profile.comp_expires_at && Date.parse(profile.comp_expires_at) <= now.getTime()) return null;
  const paid = (profile.subscription_tier ?? "free") as PlanTier;
  // Below the plan paid for, it changes nothing. The SAME tier still counts:
  // it holds the plan's next charge, and the page says so.
  if (TIER_RANK[tier] < TIER_RANK[paid]) return null;
  return { tier, expiresAt: profile.comp_expires_at ?? null };
}

/**
 * What the billing page says about the next charge under a comp over a live
 * plan. "Nothing is charged before then" ONLY when Stripe's own trial
 * really runs to the comp's end — a comp the plan could not be held for
 * (a cancelled or past-due plan, a hold that failed) must not promise it.
 */
export function liveCompChargeLine(input: {
  status: string | null | undefined;
  compExpiresAt: string | null;
  stripeTrialEnd: string | null | undefined;
}): "held" | "own_dates" {
  if (!input.compExpiresAt) return "own_dates";
  if (input.status !== "trialing") return "own_dates";
  return input.stripeTrialEnd != null && Date.parse(input.stripeTrialEnd) >= Date.parse(input.compExpiresAt)
    ? "held"
    : "own_dates";
}
