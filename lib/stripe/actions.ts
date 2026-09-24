"use server";

import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  CREDIT_PACKS,
  PACK_SUBSCRIBER_COUPON_ID,
  TRIAL_DAYS,
  type BillingPeriod,
  type PackKey,
  type PaidTier,
} from "@/lib/billing/plans";
import { isPlanDowngrade } from "@/lib/billing/plan-change";
import { getStripe, isStripeConfigured } from "./client";
import { packLookupKey, resolvePriceId, tierLookupKey } from "./prices";
import {
  findDelinquentSubscription,
  findLiveSubscription,
  resolveSubscriptionTier,
} from "./subscription-sync";
import type Stripe from "stripe";

// One trial per account: a customer who has EVER held a subscription (any
// status — trialing counts, canceled counts, an abandoned incomplete counts)
// doesn't get another, on Plus OR Pro. Stripe's subscription list is the
// authoritative record; on an API hiccup we fail TOWARD no-trial (worst case
// a legitimate first-timer pays immediately and support comps them, rather
// than a repeat customer minting free weeks). The profile's webhook-written
// subscription_status is the second, independent record (see
// createCheckoutSessionAction) — both must say "never" for a trial.
async function isTrialEligible(
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
    });
    return subs.data.length === 0;
  } catch (error) {
    console.error(
      "[stripe] Trial eligibility check failed (denying the trial):",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

export type CheckoutInput =
  | { kind: "subscription"; tier: PaidTier; period?: BillingPeriod }
  | { kind: "pack"; pack: PackKey };

export type BillingActionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Ensure the current user has a Stripe customer, creating + persisting one on
// first use. stripe_customer_id MUST be written with the service role: it's a
// protect_billing_columns-pinned column, so a write through the user's own
// client is silently REVERTED by the trigger — which is exactly the bug that
// broke the first live trial (the webhook maps events to profiles by
// stripe_customer_id and matched nothing; caught 2026-07-11).
async function ensureStripeCustomer(): Promise<
  | {
      ok: true;
      customerId: string;
      userId: string;
      /** The profile has synced a subscription at some point (the webhook
       *  writes subscription_status and never clears it) — trial-ineligible
       *  even if Stripe's customer record were ever lost or replaced. */
      hasSubscribedBefore: boolean;
    }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to manage billing." };

  const profile = await getCurrentProfile();
  const hasSubscribedBefore = profile?.subscription_status != null;
  if (profile?.stripe_customer_id) {
    return {
      ok: true,
      customerId: profile.stripe_customer_id,
      userId: user.id,
      hasSubscribedBefore,
    };
  }

  // Refuse to mint a customer we can't link — an unlinked customer means the
  // webhook can never provision the subscription it pays for.
  if (!isAdminConfigured()) {
    return { ok: false, error: "Billing isn't available right now." };
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { supabase_user_id: user.id },
  });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id)
    .select("stripe_customer_id")
    .single();
  // Verify the write actually landed (a trigger revert reports no error) so
  // this failure mode can never be silent again.
  if (error || data?.stripe_customer_id !== customer.id) {
    return { ok: false, error: "Couldn't link your billing account. Try again." };
  }

  return { ok: true, customerId: customer.id, userId: user.id, hasSubscribedBefore };
}

/** Stripe only accepts a Checkout `trial_end` at least 48 hours out; below
 *  that a mid-trial plan switch simply starts paying (the old behaviour). */
const MIN_TRIAL_CARRY_SECONDS = 48 * 60 * 60 + 15 * 60;

/**
 * Switch an ACTIVE (paid) subscription to another price in place through the
 * Customer Portal's confirm-update flow: Stripe shows the proration, charges
 * the difference on the card already on file, and the subscription keeps
 * its id — no second subscription, no double billing. The webhook's
 * subscription.updated event then resyncs the profile.
 */
async function createPlanSwitchSession(
  stripe: Stripe,
  customerId: string,
  current: Stripe.Subscription,
  priceId: string,
  base: string,
): Promise<BillingActionResult> {
  const itemId = current.items.data[0]?.id;
  if (!itemId) return { ok: false, error: "Couldn't read your current plan." };
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${base}/dashboard/billing`,
    flow_data: {
      type: "subscription_update_confirm",
      subscription_update_confirm: {
        subscription: current.id,
        items: [{ id: itemId, price: priceId, quantity: 1 }],
      },
      after_completion: {
        type: "redirect",
        redirect: { return_url: `${base}/dashboard?billing=success` },
      },
    },
  });
  if (!session.url) return { ok: false, error: "Couldn't start the plan change." };
  return { ok: true, url: session.url };
}

function scheduleIdOf(schedule: Stripe.Subscription["schedule"]): string | null {
  if (!schedule) return null;
  return typeof schedule === "string" ? schedule : schedule.id;
}

/** Drop a pending plan change (the subscription stays on its current
 *  price). A no-op without one. */
async function releasePendingChange(stripe: Stripe, sub: Stripe.Subscription): Promise<void> {
  const scheduleId = scheduleIdOf(sub.schedule);
  if (scheduleId) await stripe.subscriptionSchedules.release(scheduleId);
}

/**
 * Schedule a downgrade for the end of the current period: a subscription
 * schedule takes the subscription over, keeps the current phase exactly as
 * it is (same price, same end date), adds ONE phase on the new price, and
 * then releases the subscription — which carries on renewing on that price.
 * Nothing is charged or credited now; the webhook's subscription.updated at
 * the phase change resyncs the profile. A pending change is replaced, never
 * stacked, and a plan set to cancel is un-cancelled first: the click asked
 * for "Plus after this period", not "nothing after this period".
 */
async function scheduleDowngrade(
  stripe: Stripe,
  live: Stripe.Subscription,
  target: { priceId: string; period: BillingPeriod },
  base: string,
): Promise<BillingActionResult> {
  await releasePendingChange(stripe, live);
  if (live.cancel_at_period_end) {
    await stripe.subscriptions.update(live.id, { cancel_at_period_end: false });
  }
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: live.id });
  const current = schedule.phases[0];
  if (!current) return { ok: false, error: "Couldn't read your current plan." };
  await stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    phases: [
      {
        start_date: current.start_date,
        end_date: current.end_date,
        items: current.items.map((item) => ({
          price: typeof item.price === "string" ? item.price : item.price.id,
          quantity: item.quantity ?? 1,
        })),
      },
      {
        items: [{ price: target.priceId, quantity: 1 }],
        // One billing interval of the new price; `release` then hands the
        // subscription back, renewing on that price.
        duration: { interval: target.period === "annual" ? "year" : "month", interval_count: 1 },
        proration_behavior: "none",
      },
    ],
  });
  return { ok: true, url: `${base}/dashboard/billing?billing=scheduled` };
}

export async function createCheckoutSessionAction(
  input: CheckoutInput,
): Promise<BillingActionResult> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing isn't available right now." };
  }

  const customer = await ensureStripeCustomer();
  if (!customer.ok) return customer;

  const base = getSiteBaseUrl();
  const stripe = getStripe();

  try {
    if (input.kind === "subscription") {
      // From the catalog's lookup key (env id only as a fallback) — see
      // lib/stripe/prices.ts for the outage a stale env id caused.
      const priceId = await resolvePriceId(stripe, tierLookupKey(input.tier, input.period ?? "monthly"));
      if (!priceId) return { ok: false, error: "That plan isn't available yet." };

      // Already subscribed? Never start a SECOND subscription (that's how a
      // customer ends up billed twice, and how a lingering trial's later
      // cancellation used to demote the paid plan). An active subscription
      // switches price in place; a no-card trial is superseded: a fresh
      // checkout collects payment now, and the webhook cancels the trial
      // once the new subscription is paid (handleSupersededSubscription).
      const live = await findLiveSubscription(stripe, customer.customerId);
      if (!live) {
        // A subscription whose payment failed still exists: selling a second
        // one bills twice once Stripe's retry succeeds. The portal is where
        // the card gets fixed (and where Stripe reactivates the plan).
        const delinquent = await findDelinquentSubscription(stripe, customer.customerId);
        if (delinquent) {
          const portal = await stripe.billingPortal.sessions.create({
            customer: customer.customerId,
            return_url: `${base}/dashboard/billing`,
          });
          if (!portal.url) return { ok: false, error: "Couldn't open the billing portal." };
          return { ok: true, url: portal.url };
        }
      }
      let supersedes: string | null = null;
      // A plan switch DURING the trial keeps the rest of the trial on the
      // new plan (same end date, still no card required) instead of forcing
      // payment a few days early — the trial is the same one, just on a
      // different tier, so the one-trial rule is untouched.
      let carryTrialEnd: number | null = null;
      if (live) {
        if (live.items.data[0]?.price?.id === priceId) {
          return { ok: false, error: "You're already on that plan." };
        }
        if (live.status === "active") {
          const currentTier = await resolveSubscriptionTier(live, stripe);
          const currentInterval = live.items.data[0]?.price?.recurring?.interval ?? null;
          const target = { tier: input.tier, period: input.period ?? "monthly" };
          if (isPlanDowngrade({ tier: currentTier, interval: currentInterval }, target)) {
            return scheduleDowngrade(stripe, live, { priceId, period: target.period }, base);
          }
          // An upgrade replaces any pending downgrade (the portal refuses to
          // update a subscription a schedule manages, and the old downgrade
          // must not sneak back in at period end).
          await releasePendingChange(stripe, live);
          return createPlanSwitchSession(stripe, customer.customerId, live, priceId, base);
        }
        supersedes = live.id;
        const remaining =
          typeof live.trial_end === "number"
            ? live.trial_end - Math.floor(Date.now() / 1000)
            : 0;
        if (live.status === "trialing" && remaining >= MIN_TRIAL_CARRY_SECONDS) {
          carryTrialEnd = live.trial_end as number;
        }
      }

      // First subscription ever → 7-day free trial, card optional. Without a
      // payment method by day 7 the subscription cancels itself (never
      // silently pauses into limbo) and the webhook downgrades the profile.
      // Two independent records must both say "never subscribed": the
      // profile's webhook-written status and Stripe's subscription history.
      const withTrial =
        !live &&
        !customer.hasSubscribedBefore &&
        (await isTrialEligible(stripe, customer.customerId));
      const noCardTrial = withTrial || carryTrialEnd != null;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.customerId,
        client_reference_id: customer.userId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        // What was being bought, for checkout.session.expired (the session
        // object carries no line items) — plus the trial it supersedes.
        metadata: {
          supabase_user_id: customer.userId,
          purchase_kind: "subscription",
          tier: input.tier,
          period: input.period ?? "monthly",
          ...(supersedes ? { supersedes_subscription_id: supersedes } : {}),
        },
        subscription_data: {
          metadata: { supabase_user_id: customer.userId },
          ...(withTrial
            ? {
                trial_period_days: TRIAL_DAYS,
                trial_settings: {
                  end_behavior: { missing_payment_method: "cancel" as const },
                },
              }
            : carryTrialEnd != null
              ? {
                  trial_end: carryTrialEnd,
                  trial_settings: {
                    end_behavior: { missing_payment_method: "cancel" as const },
                  },
                }
              : {}),
        },
        ...(noCardTrial
          ? { payment_method_collection: "if_required" as const }
          : {}),
        // Land new subscribers on the dashboard (the "go make something"
        // surface, with the credits card front and center) rather than
        // settings; BillingReturnToast is mounted there to greet them.
        success_url: `${base}/dashboard?billing=success`,
        cancel_url: `${base}/pricing?billing=cancel`,
      });
      if (!session.url) return { ok: false, error: "Couldn't start checkout." };
      return { ok: true, url: session.url };
    }

    // One-time credit pack.
    const priceId = await resolvePriceId(stripe, packLookupKey(input.pack));
    if (!priceId) return { ok: false, error: "That pack isn't available yet." };
    const credits = CREDIT_PACKS[input.pack].credits;

    // Subscribers pay less for packs (owner decision 2026-09-24): an ACTIVE
    // Plus/Pro subscription — a no-card trial hasn't paid yet, comps and
    // admins hold no subscription — gets the subscriber coupon applied HERE,
    // never a code the client could supply. The webhook grants by
    // pack_credits, so the discount changes the price and nothing else.
    const live = await findLiveSubscription(stripe, customer.customerId);
    const subscriberDiscount = live?.status === "active";
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      customer: customer.customerId,
      client_reference_id: customer.userId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Trusted server-set metadata the webhook reads to grant the right amount.
      metadata: {
        supabase_user_id: customer.userId,
        purchase_kind: "pack",
        pack: input.pack,
        pack_credits: String(credits),
        discount: subscriberDiscount ? "subscriber" : "none",
      },
      success_url: `${base}/dashboard/billing?billing=credits`,
      cancel_url: `${base}/pricing?billing=cancel`,
    };
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create(
        subscriberDiscount
          ? { ...params, discounts: [{ coupon: PACK_SUBSCRIBER_COUPON_ID }] }
          : params,
      );
    } catch (error) {
      // A coupon missing from the catalog must never block a sale: log it
      // loudly and sell at full price.
      const message = error instanceof Error ? error.message : String(error);
      if (!subscriberDiscount || !/coupon/i.test(message)) throw error;
      console.error(
        `[stripe] Subscriber pack coupon ${PACK_SUBSCRIBER_COUPON_ID} unusable — selling at full price:`,
        message,
      );
      session = await stripe.checkout.sessions.create(params);
    }
    if (!session.url) return { ok: false, error: "Couldn't start checkout." };
    return { ok: true, url: session.url };
  } catch (error) {
    // Log the real reason: this used to be swallowed, and 22 live checkout
    // failures in one day were invisible to every log the app writes.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[stripe] Checkout session failed (${JSON.stringify(input)}):`, message);
    return {
      ok: false,
      error: /No such price/i.test(message)
        ? "That plan isn't set up in Stripe yet — please let us know."
        : "Stripe checkout failed. Please try again.",
    };
  }
}

/**
 * "Keep current plan": drop the downgrade scheduled for the end of the
 * period. The subscription is read from the profile (never trusted from the
 * client); releasing the schedule leaves it exactly as it is today.
 */
export async function cancelScheduledPlanChangeAction(): Promise<BillingActionResult> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing isn't available right now." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to manage billing." };
  const profile = await getCurrentProfile();
  if (!profile?.stripe_subscription_id) {
    return { ok: false, error: "There's no scheduled plan change." };
  }
  try {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
    const scheduleId = scheduleIdOf(sub.schedule);
    if (!scheduleId) return { ok: false, error: "There's no scheduled plan change." };
    await stripe.subscriptionSchedules.release(scheduleId);
    return { ok: true, url: `${getSiteBaseUrl()}/dashboard/billing?billing=kept` };
  } catch (error) {
    console.error(
      "[stripe] Releasing the scheduled plan change failed:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "Couldn't cancel the plan change. Try again." };
  }
}

/** Where the Customer Portal opens: its home, or straight into one flow.
 *  The cancel flow needs the live subscription (read from the profile —
 *  never trusted from the client). */
export type PortalFlow = "home" | "payment_method_update" | "subscription_cancel";

export async function createPortalSessionAction(
  flow: PortalFlow = "home",
): Promise<BillingActionResult> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing isn't available right now." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to manage billing." };

  const profile = await getCurrentProfile();
  if (!profile?.stripe_customer_id) {
    return { ok: false, error: "You don't have a billing account yet." };
  }
  const returnUrl = `${getSiteBaseUrl()}/dashboard/billing`;

  let flowData: Stripe.BillingPortal.SessionCreateParams.FlowData | undefined;
  if (flow === "payment_method_update") {
    flowData = { type: "payment_method_update" };
  } else if (flow === "subscription_cancel") {
    if (!profile.stripe_subscription_id) {
      return { ok: false, error: "There's no active subscription to cancel." };
    }
    flowData = {
      type: "subscription_cancel",
      subscription_cancel: { subscription: profile.stripe_subscription_id },
    };
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl,
      ...(flowData ? { flow_data: flowData } : {}),
    });
    return { ok: true, url: session.url };
  } catch (error) {
    console.error(
      "[stripe] Portal session failed:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, error: "Couldn't open the billing portal. Try again." };
  }
}
