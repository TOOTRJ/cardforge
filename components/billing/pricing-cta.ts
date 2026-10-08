import {
  DELINQUENT_SUBSCRIPTION_STATUSES,
  TRIAL_DAYS,
  type PlanTier,
} from "@/lib/billing/plans";
import type { BillingViewer } from "@/lib/billing/viewer";

// ---------------------------------------------------------------------------
// Which button a plan card (or an upgrade-modal row) shows for a viewer. A
// pure table so it can be unit-tested exhaustively — the 2026-09-22 bug was
// a "Manage plan" button offered to accounts with no billing account (comped,
// admin) that could only ever fail.
//
//   signup   → link to /signup (anonymous storefront)
//   portal   → open the Stripe Customer Portal (manage / fix payment)
//   checkout → start or switch a subscription (server re-validates)
//   resume   → un-cancel a plan that is set to end (ResumePlanButton: an
//              in-app confirm, then resumeSubscriptionAction)
//   none     → nothing to offer (the card's "Your current plan" badge, or a
//              free account looking at the free card)
// ---------------------------------------------------------------------------

export type PricingCta =
  | { kind: "signup"; label: string }
  | { kind: "portal"; label: string }
  | { kind: "checkout"; label: string }
  | { kind: "resume"; label: string; planName: string }
  | { kind: "none" };

const PAID_NAME: Record<Exclude<PlanTier, "free">, string> = { plus: "Plus", pro: "Pro" };

export function pricingCtaFor(viewer: BillingViewer, tier: PlanTier): PricingCta {
  // A plan that is cancelled and still running: the way to stay is Resume —
  // on the card of the plan itself (instead of a bare "Your current plan")
  // and on the Free card, where "Manage plan" would have nothing to manage.
  // The other paid card keeps "Switch to …" (the server resumes or renews as
  // part of the switch).
  const endingPlan =
    viewer.isSignedIn &&
    viewer.subscriptionEnding &&
    viewer.hasLiveSubscription &&
    viewer.hasBillingAccount &&
    viewer.currentTier != null &&
    viewer.currentTier !== "free"
      ? PAID_NAME[viewer.currentTier]
      : null;
  if (endingPlan && (tier === "free" || tier === viewer.currentTier)) {
    return { kind: "resume", label: `Resume ${endingPlan}`, planName: endingPlan };
  }
  if (tier === "free") {
    if (!viewer.isSignedIn) return { kind: "signup", label: "Get started free" };
    // A live subscription is managed (cancel, invoices, card) in the portal.
    // A comped or admin account is "paid" with nothing to manage there.
    if (viewer.hasLiveSubscription && viewer.hasBillingAccount) {
      // Already cancelled with no paid tier to name (a comp outranks the
      // subscription): nothing to "manage" down to Free — the billing page's
      // plan card says when it ends and carries the Resume button.
      if (viewer.subscriptionEnding) return { kind: "none" };
      return { kind: "portal", label: "Manage plan" };
    }
    return { kind: "none" };
  }

  const name = PAID_NAME[tier];
  if (!viewer.isSignedIn) {
    // The anonymous storefront leads with the trial — signup is its first
    // step; checkout re-validates eligibility server-side either way.
    return { kind: "signup", label: `Start free — ${TRIAL_DAYS}-day trial` };
  }
  // Payment broken on an existing subscription: perks are off but a fresh
  // checkout would sell a SECOND subscription — the portal is the only
  // right button, on every paid card.
  const delinquent =
    !viewer.isPaid &&
    DELINQUENT_SUBSCRIPTION_STATUSES.has(viewer.subscriptionStatus ?? "");
  if (delinquent && viewer.hasBillingAccount) {
    return { kind: "portal", label: "Update payment to continue" };
  }
  // Subscribed → switch tiers IN PLACE (the server action moves an active
  // subscription through the portal's confirm-update flow and carries a
  // trial over to the new plan) — never a second subscription.
  if (viewer.hasLiveSubscription) {
    return { kind: "checkout", label: `Switch to ${name}` };
  }
  // Free, lapsed, canceled, comped or admin: a fresh subscription. Only an
  // account that has NEVER subscribed is promised the trial.
  return {
    kind: "checkout",
    label: viewer.hasSubscribed
      ? `Choose ${name}`
      : `Try ${name} free for ${TRIAL_DAYS} days`,
  };
}
