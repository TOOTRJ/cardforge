import { TIER_RANK, type PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// What an admin comp does to a LIVE Stripe subscription (audit 2026-10-30).
//
// A comp is a profile overlay (`profiles.comp_tier` / `comp_expires_at`,
// lib/billing/entitlements.ts): it raises the perks and never touched Stripe.
// So a user on a card-backed trial who was comped a free month was CHARGED
// when the 7-day trial ended — inside the "free" month — and the comp then
// covered perks they were already paying for. The owner's rule: a comp month
// is free, and the month after it is charged NORMALLY.
//
// The rule, one pure decision (`compTrialChangeFor`):
//   • a TRIALING subscription that renews (not cancelled) under a comp of the
//     same or a higher tier with an end date: the trial is moved to end when
//     the comp ends (`trial_end` = the later of the two, never earlier than
//     Stripe's own), so the first charge lands the moment the comp ends — at
//     the subscription's own price ("charged normally"). The trial end it had
//     before the comp is kept in the subscription's metadata
//     (`TRIAL_END_BEFORE_COMP_KEY`), so clearing or shortening the comp puts it
//     back (or ends the trial now when that date has passed — the charge it
//     would have made already).
//   • an ACTIVE subscription: left alone — it keeps billing as usual and the
//     comp adds perks on top (owner question 1 in the audit PR; a referral's
//     free month for a payer is a balance credit, not a comp).
//   • a cancelled (ending) subscription: left alone — it stops on its date and
//     the comp carries the perks after it; nothing is charged after the comp.
//   • a comp with NO end date, or one past Stripe's trial limit: left alone
//     (an open-ended trial can't be set); the admin is told it still bills.
// ---------------------------------------------------------------------------

/** Subscription metadata key: the trial end (unix seconds) before a comp
 *  moved it. Cleared ("") when the comp no longer holds the trial. */
export const TRIAL_END_BEFORE_COMP_KEY = "pipglyph_trial_end_before_comp";

/** Stripe refuses a trial end more than 730 days out. */
export const MAX_TRIAL_SECONDS = 730 * 86_400;

export type CompSubscriptionFacts = {
  status: string | null | undefined;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  metadata?: Record<string, string> | null;
};

export type CompTrialChange =
  | {
      kind: "set_trial_end";
      /** Unix seconds, or "now" (the trial is over: charge as it would have). */
      trialEnd: number | "now";
      /** The metadata value to write: the pre-comp trial end, or "" to clear. */
      beforeComp: string;
      /** Why: the comp holds the trial, or it no longer does. */
      reason: "comp_holds_trial" | "comp_released_trial";
    }
  | {
      kind: "none";
      reason:
        | "not_trialing"
        | "ending"
        | "comp_lower_tier"
        | "comp_no_expiry"
        | "comp_too_long"
        | "unchanged"
        | "no_comp";
    };

export type CompFacts = { tier: PlanTier | null; expiresAt: string | null };

function storedBeforeComp(sub: CompSubscriptionFacts): number | null {
  const raw = sub.metadata?.[TRIAL_END_BEFORE_COMP_KEY];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Is the subscription set to stop (either way Stripe says it on the object
 *  itself)? A schedule ending in a cancellation is not created by this app. */
function isEnding(sub: CompSubscriptionFacts): boolean {
  return Boolean(sub.cancel_at_period_end) || typeof sub.cancel_at === "number";
}

/**
 * The trial change a comp needs on the subscription the profile points at.
 * `subscribedTier` is the tier that subscription pays for.
 */
export function compTrialChangeFor(input: {
  sub: CompSubscriptionFacts;
  subscribedTier: PlanTier;
  comp: CompFacts;
  now?: Date;
}): CompTrialChange {
  const { sub, subscribedTier, comp } = input;
  const nowSec = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (sub.status !== "trialing" || typeof sub.trial_end !== "number") {
    return { kind: "none", reason: "not_trialing" };
  }
  if (isEnding(sub)) return { kind: "none", reason: "ending" };

  const before = storedBeforeComp(sub);
  const original = before ?? sub.trial_end;

  // Does a comp hold this trial? Active, dated, at or above the plan paid for.
  const compExpirySec = comp.expiresAt ? Math.floor(Date.parse(comp.expiresAt) / 1000) : null;
  const compActive = comp.tier != null && (compExpirySec == null || compExpirySec > nowSec);
  let why: "comp_lower_tier" | "comp_no_expiry" | "comp_too_long" | "no_comp" | null = null;
  if (!compActive) why = "no_comp";
  else if (TIER_RANK[comp.tier as PlanTier] < TIER_RANK[subscribedTier]) why = "comp_lower_tier";
  else if (compExpirySec == null) why = "comp_no_expiry";
  else if (compExpirySec - nowSec > MAX_TRIAL_SECONDS) why = "comp_too_long";

  if (why == null) {
    const target = Math.max(original, compExpirySec as number);
    // Already there — or the trial outlasts the comp: nothing to move.
    if (target === sub.trial_end) return { kind: "none", reason: "unchanged" };
    return {
      kind: "set_trial_end",
      trialEnd: target,
      beforeComp: String(original),
      reason: "comp_holds_trial",
    };
  }

  // No comp holds the trial. If an earlier comp moved it, put it back.
  if (before != null) {
    return {
      kind: "set_trial_end",
      trialEnd: before > nowSec ? before : "now",
      beforeComp: "",
      reason: "comp_released_trial",
    };
  }
  return { kind: "none", reason: why };
}

/** One line for the admin toast / the user's notification. */
export function compStripeNote(change: CompTrialChange, opts: { live: boolean }): string | null {
  if (change.kind === "set_trial_end") {
    if (change.trialEnd === "now") return "Their trial had already passed its own end, so it ends now and is charged.";
    return change.reason === "comp_holds_trial"
      ? "Their Stripe trial now ends when the comp ends — the first charge lands then."
      : "Their Stripe trial is back on its own end date.";
  }
  if (!opts.live) return null;
  switch (change.reason) {
    case "not_trialing":
      return "Their Stripe subscription keeps billing as usual during the comp.";
    case "comp_no_expiry":
      return "No end date: their Stripe trial still converts and charges on its own date.";
    case "comp_too_long":
      return "Longer than Stripe allows for a trial: their trial still converts on its own date.";
    case "comp_lower_tier":
      return "The comp is below their plan, so it changes nothing.";
    default:
      return null;
  }
}

/** Stripe Checkout refuses a `trial_end` less than 48 hours out. */
export const CHECKOUT_MIN_TRIAL_SECONDS = 48 * 3600;

/**
 * A comped user who subscribes from the billing page is not charged while
 * the comp runs: Checkout starts the subscription with `trial_end` at the
 * comp's end (the same rule as above, for a subscription that doesn't exist
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
  // it can hold a trial (compTrialChangeFor), and the page says so.
  if (TIER_RANK[tier] < TIER_RANK[paid]) return null;
  return { tier, expiresAt: profile.comp_expires_at ?? null };
}
