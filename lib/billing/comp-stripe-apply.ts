import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { syncSubscriptionForUser } from "@/lib/stripe/subscription-sync";
import {
  TRIAL_END_BEFORE_COMP_KEY,
  compStripeNote,
  compTrialChangeFor,
  type CompFacts,
  type CompTrialChange,
} from "@/lib/billing/comp-stripe";
import type { PlanTier } from "@/lib/billing/plans";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CompStripeOutcome = {
  change: CompTrialChange | null;
  /** ISO trial end the subscription now has, when this call moved it. */
  trialEnd: string | null;
  /** One line for the admin (null: nothing to say). */
  note: string | null;
  /** Stripe could not be read or written — the comp is saved all the same. */
  failed: boolean;
};

const NOTHING: CompStripeOutcome = { change: null, trialEnd: null, note: null, failed: false };

/**
 * Bring the user's live Stripe subscription in line with their comp
 * (lib/billing/comp-stripe.ts) AFTER the profile's comp columns were written.
 * Best effort: the comp itself is the profile row; a Stripe failure is
 * reported, logged, and leaves the subscription as it was.
 */
export async function applyCompToSubscription(
  admin: AdminClient,
  userId: string,
  comp: CompFacts,
  deps: { stripe?: Stripe; now?: Date } = {},
): Promise<CompStripeOutcome> {
  if (!deps.stripe && !isStripeConfigured()) return NOTHING;
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, stripe_subscription_id, subscription_tier, subscription_status")
    .eq("id", userId)
    .maybeSingle();
  const subId = profile?.stripe_subscription_id ?? null;
  if (!subId) return NOTHING;
  const live = profile?.subscription_status === "active" || profile?.subscription_status === "trialing";

  const stripe = deps.stripe ?? getStripe();
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const subscribedTier = (profile?.subscription_tier ?? "free") as PlanTier;
    const change = compTrialChangeFor({ sub, subscribedTier, comp, now: deps.now });
    if (change.kind === "none") {
      return { change, trialEnd: null, note: compStripeNote(change, { live }), failed: false };
    }
    const updated = await stripe.subscriptions.update(subId, {
      trial_end: change.trialEnd,
      proration_behavior: "none",
      metadata: { [TRIAL_END_BEFORE_COMP_KEY]: change.beforeComp },
    });
    // The profile's period / trial dates follow at once (the webhook's
    // subscription.updated does the same a moment later).
    await syncSubscriptionForUser(admin, stripe, userId, {
      currentSub: updated,
      customerId: profile?.stripe_customer_id ?? null,
    });
    const trialEnd = typeof updated.trial_end === "number" ? new Date(updated.trial_end * 1000).toISOString() : null;
    return { change, trialEnd, note: compStripeNote(change, { live }), failed: false };
  } catch (error) {
    console.warn(
      `applyCompToSubscription(${userId}): stripe error`,
      error instanceof Error ? error.message : error,
    );
    return {
      change: null,
      trialEnd: null,
      note: "Stripe couldn't be updated — their subscription bills on its own dates. Try saving the comp again.",
      failed: true,
    };
  }
}
