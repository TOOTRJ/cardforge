import "server-only";

import type Stripe from "stripe";
import { compHoldReason, discountsOf, hasCompCouponGrant } from "@/lib/billing/comp-coupon";
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

/** A storefront read's budget (round-3 item 1): the page waits at most this
 *  long for Stripe, with no retry, then shows the profile's comp instead. */
export const STOREFRONT_LOCK_READ_TIMEOUT_MS = 3000;

/** How long after a comp ENDS the storefront still asks Stripe: a coupon
 *  rounded up to the plan's invoices runs at most one monthly period past
 *  the comp (`roundedUpComp`), a credit or trial grant never past it. */
export const COMP_LOCK_TAIL_DAYS = 45;

/** Stripe answered that the subscription doesn't exist (`resource_missing`
 *  / 404): a deleted subscription holds no comp — "no lock", not a failure. */
function isMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; statusCode?: unknown; raw?: { code?: unknown } };
  return e.code === "resource_missing" || e.raw?.code === "resource_missing" || e.statusCode === 404;
}

/** One read: the subscription with its discounts expanded. `timeoutMs`
 *  bounds a storefront read (no retries); the server's own checks use the
 *  client's defaults. */
export async function readSubscriptionCompLock(
  stripe: Stripe,
  subscriptionId: string,
  opts: { timeoutMs?: number } = {},
): Promise<LockRead> {
  try {
    const read = await stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ["discounts"] },
      ...(opts.timeoutMs ? [{ timeout: opts.timeoutMs, maxNetworkRetries: 0 }] : []),
    );
    const facts = read as unknown as CompLockSubFacts;
    if (discountsOf(facts).unreadable) return "unreadable";
    return subscriptionCompLock(facts, nowSec());
  } catch (error) {
    if (isMissing(error)) return null;
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

/** Is the profile's comp current, or ended recently enough that its
 *  rounded-up coupon may still run (finding P3b)? A comp with no end is
 *  current. Only then does the storefront ask Stripe. */
export function compMayStillLock(
  profile: { comp_tier?: string | null; comp_expires_at?: string | null },
  nowMs: number = Date.now(),
): boolean {
  if (!profile.comp_tier) return false;
  if (!profile.comp_expires_at) return true;
  const end = Date.parse(profile.comp_expires_at);
  if (!Number.isFinite(end)) return true;
  return end > nowMs - COMP_LOCK_TAIL_DAYS * 86_400_000;
}

/** A plan set to END carries nothing of the comp on Stripe yet (it goes on
 *  when the plan resumes), and the server refuses a switch there while the
 *  comp would hold the plan (round-3 item 4): the storefront says so too. */
function endingPlanCompLock(profile: {
  subscription_status?: string | null;
  subscription_tier?: string | null;
  comp_tier?: string | null;
  comp_expires_at?: string | null;
  cancel_at_period_end?: boolean | null;
  subscription_ends_at?: string | null;
}): PlanSwitchLock | null {
  if (!profile.cancel_at_period_end && !profile.subscription_ends_at) return null;
  if (profile.subscription_status !== "active" && profile.subscription_status !== "trialing") return null;
  const tier = profile.subscription_tier;
  const comp = profile.comp_tier;
  if ((tier !== "plus" && tier !== "pro") || (comp !== "plus" && comp !== "pro")) return null;
  const facts = { tier: comp, expiresAt: profile.comp_expires_at ?? null } as const;
  return compHoldReason(facts, tier, nowSec()) == null ? { until: facts.expiresAt } : null;
}

/** The lock the STOREFRONT shows (billing page grid, /pricing, the upgrade
 *  modal via /api/me) — the same rule the server enforces, read from Stripe
 *  for a profile whose comp is current or ended within
 *  `COMP_LOCK_TAIL_DAYS` (`compMayStillLock`; `comp_tier` is never cleared
 *  on expiry, so an older comp costs no call — round-3 item 1). Anyone else
 *  costs no Stripe call. The read is bounded (`STOREFRONT_LOCK_READ_TIMEOUT_MS`,
 *  no retry); when Stripe can't be read in time the profile's comp stands in
 *  — display only; the server decides on its own read. */
export async function viewerPlanSwitchLock(
  profile: {
    stripe_subscription_id?: string | null;
    subscription_status?: string | null;
    subscription_tier?: string | null;
    comp_tier?: string | null;
    comp_expires_at?: string | null;
    cancel_at_period_end?: boolean | null;
    subscription_ends_at?: string | null;
  } | null,
): Promise<PlanSwitchLock | null> {
  if (!profile?.comp_tier || !profile.stripe_subscription_id || !isStripeConfigured()) return null;
  if (!compMayStillLock(profile)) return null;
  const read = await readSubscriptionCompLock(getStripe(), profile.stripe_subscription_id, {
    timeoutMs: STOREFRONT_LOCK_READ_TIMEOUT_MS,
  });
  if (read !== "unreadable") return read ?? endingPlanCompLock(profile);
  return compPlanSwitchLock({
    compTier: profile.comp_tier,
    compExpiresAt: profile.comp_expires_at,
    subscribedTier: profile.subscription_tier,
    subscriptionStatus: profile.subscription_status,
  });
}
