import "server-only";

import type Stripe from "stripe";
import { discountsOf, hasCompCouponGrant } from "@/lib/billing/comp-coupon";
import {
  compPlanSwitchLock,
  subscriptionCompLock,
  type CompLockSubFacts,
  type PlanSwitchLock,
} from "@/lib/billing/comp-switch-lock";
import { getStripe, isStripeConfigured } from "./client";

// ---------------------------------------------------------------------------
// The plan-switch lock as the SERVER reads it (TODO BL1): from the
// subscription's own record of the comp (`subscriptionCompLock`), never from
// the profile — a comp cleared, expired or below the plan says nothing about
// a coupon still running there (finding P1), and a comp that put nothing on
// Stripe locks nothing (P3a). "unreadable" = Stripe couldn't be read: the
// caller refuses with a plain retry line (or, for a card fix, opens only
// the card flow) — never claims a comp, never lets a switch through.
// ---------------------------------------------------------------------------

export type LockRead = PlanSwitchLock | null | "unreadable";

const nowSec = () => Math.floor(Date.now() / 1000);

/** One read: the subscription with its discounts expanded. */
export async function readSubscriptionCompLock(stripe: Stripe, subscriptionId: string): Promise<LockRead> {
  try {
    const read = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["discounts"] });
    const facts = read as unknown as CompLockSubFacts;
    if (discountsOf(facts).unreadable) return "unreadable";
    return subscriptionCompLock(facts, nowSec());
  } catch (error) {
    console.error(
      "[stripe] Couldn't read the subscription for its comp lock:",
      error instanceof Error ? error.message : error,
    );
    return "unreadable";
  }
}

/** A subscription already in hand (a list's row: discounts NOT expanded).
 *  Read again, expanded, only when it names our coupon grant — the one case
 *  a discount of ours can be on it — so a customer never comped costs no
 *  extra call. */
export async function compLockOfSubscription(stripe: Stripe, sub: Stripe.Subscription): Promise<LockRead> {
  if (hasCompCouponGrant(sub.metadata)) return readSubscriptionCompLock(stripe, sub.id);
  return subscriptionCompLock(sub as unknown as CompLockSubFacts, nowSec());
}

/** The lock the STOREFRONT shows (billing page grid, /pricing, the upgrade
 *  modal via /api/me) — the same rule the server enforces, read from Stripe
 *  for a profile that has ever been comped (`comp_tier` set — an expired
 *  comp too, whose rounded-up coupon may still run: finding P3b). Anyone
 *  else costs no Stripe call. When Stripe can't be read the profile's comp
 *  stands in — display only; the server decides on its own read. */
export async function viewerPlanSwitchLock(
  profile: {
    stripe_subscription_id?: string | null;
    subscription_status?: string | null;
    subscription_tier?: string | null;
    comp_tier?: string | null;
    comp_expires_at?: string | null;
  } | null,
): Promise<PlanSwitchLock | null> {
  if (!profile?.comp_tier || !profile.stripe_subscription_id || !isStripeConfigured()) return null;
  const read = await readSubscriptionCompLock(getStripe(), profile.stripe_subscription_id);
  if (read !== "unreadable") return read;
  return compPlanSwitchLock({
    compTier: profile.comp_tier,
    compExpiresAt: profile.comp_expires_at,
    subscribedTier: profile.subscription_tier,
    subscriptionStatus: profile.subscription_status,
  });
}
