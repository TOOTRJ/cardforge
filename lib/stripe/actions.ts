"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { recordFunnelEvent } from "@/lib/analytics/funnel-server";
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  CREDIT_PACKS,
  PACK_SUBSCRIBER_COUPON_ID,
  TRIAL_DAYS,
  TRIAL_WINBACK_COUPON_ID,
  TRIAL_WINBACK_WINDOW_DAYS,
  type BillingPeriod,
  type PackKey,
  type PaidTier,
  planForTier,
} from "@/lib/billing/plans";
import { formatMoney } from "@/lib/format/money";
import { isPlanDowngrade } from "@/lib/billing/plan-change";
import { subscriptionEndsAt } from "@/lib/billing/subscription-ending";
import { getStripe, isStripeConfigured } from "./client";
import { packLookupKey, resolvePriceId, tierLookupKey } from "./prices";
import {
  customerIdOf,
  findDelinquentSubscription,
  findLiveSubscription,
  isLiveStatus,
  resolveSubscriptionTier,
  subscriptionHasPaymentMethod,
  syncSubscriptionForUser,
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
  /** `fallback: "portal"`: the in-app step failed where Stripe's own page can
   *  still do it — the button opens the Customer Portal. */
  | { ok: false; error: string; fallback?: "portal" };

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
 * Win-back eligibility: a `trial_lapsed` notification (written by the
 * webhook when a trial ended unconverted) within the offer window. The
 * checkout action applies the coupon itself — the email never carries a
 * code, so nothing can be shared or forged.
 */
async function hasRecentLapsedTrial(userId: string): Promise<boolean> {
  if (!isAdminConfigured()) return false;
  const since = new Date(Date.now() - TRIAL_WINBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await createAdminClient()
    .from("notifications")
    .select("id")
    .eq("recipient_id", userId)
    .eq("type", "trial_lapsed")
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

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
 * Un-cancel a subscription that is set to stop — every way Stripe says so
 * (lib/billing/subscription-ending.ts), with the parameters the sandbox
 * confirmed on 2026-10-07 for a flexible-billing subscription:
 *
 *   - `cancel_at` set, flag false (the Customer Portal's shape): clear it
 *     with `cancel_at: ""`. (`cancel_at_period_end: false` also clears a
 *     `cancel_at` that EQUALS the period end; "" clears any date.)
 *   - `cancel_at_period_end: true` (the classic shape): `false`.
 *   - Stripe REFUSES both in one call ("Received both cancel_at_period_end
 *     and cancel_at parameters. Please pass in only one."), so the flag goes
 *     first and a date that survives it is cleared by a second call.
 *   - a schedule whose `end_behavior` is "cancel" (needs `schedule`
 *     expanded): switched to "release", so the subscription outlives its
 *     last phase. NOT sandbox-verified — the connector has no schedule
 *     writes; the app never creates such a schedule itself.
 *
 * Returns the subscription as Stripe has it afterwards; the caller checks
 * that it no longer ends.
 */
async function clearCancellation(stripe: Stripe, sub: Stripe.Subscription): Promise<Stripe.Subscription> {
  let current = sub;
  if (current.cancel_at_period_end) {
    current = await stripe.subscriptions.update(current.id, { cancel_at_period_end: false });
  }
  if (typeof current.cancel_at === "number") {
    current = await stripe.subscriptions.update(current.id, { cancel_at: "" });
  }
  const schedule = sub.schedule;
  if (schedule && typeof schedule !== "string" && schedule.end_behavior === "cancel") {
    await stripe.subscriptionSchedules.update(schedule.id, { end_behavior: "release" });
    current = await stripe.subscriptions.retrieve(current.id, { expand: ["schedule"] });
  }
  return current;
}

/**
 * Schedule a downgrade for the end of the current period: a subscription
 * schedule takes the subscription over, keeps the current phase exactly as
 * it is (same price, same end date), adds ONE phase on the new price, and
 * then releases the subscription — which carries on renewing on that price.
 * Nothing is charged or credited now; the webhook's subscription.updated at
 * the phase change resyncs the profile. A pending change is replaced, never
 * stacked, and a plan set to cancel is un-cancelled first — by the flag OR
 * by date (the portal's `cancel_at`), through clearCancellation: the click
 * asked for "Plus after this period", not "nothing after this period". The
 * subscription the schedule is then built from is an ordinary renewing one,
 * the shape this function has always handled.
 */
async function scheduleDowngrade(
  stripe: Stripe,
  live: Stripe.Subscription,
  target: { priceId: string; period: BillingPeriod },
  base: string,
): Promise<BillingActionResult> {
  // Releasing first also drops a schedule that ends in a cancellation.
  await releasePendingChange(stripe, live);
  let resumedFirst = false;
  if (live.cancel_at_period_end || typeof live.cancel_at === "number") {
    const resumed = await clearCancellation(stripe, { ...live, schedule: null });
    if (subscriptionEndsAt(resumed) != null) {
      // Never stack a schedule on a subscription that still ends: the new
      // price would never start. Nothing was scheduled; say what to do.
      return {
        ok: false,
        error: "This plan is set to end and couldn't be resumed here. Resume it on the billing page first, then pick the new plan.",
      };
    }
    resumedFirst = true;
  }
  try {
    const schedule = await stripe.subscriptionSchedules.create({ from_subscription: live.id });
    const current = schedule.phases[0];
    if (!current) {
      if (!resumedFirst) return { ok: false, error: "Couldn't read your current plan." };
      throw new Error(`Schedule ${schedule.id} has no current phase.`);
    }
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
  } catch (error) {
    if (!resumedFirst) throw error;
    // The cancellation is already cleared and the new price is NOT
    // scheduled: the plan now renews on its CURRENT price. A generic
    // "couldn't start checkout" here would leave a customer who had
    // cancelled believing nothing changed — say exactly what did.
    console.error(
      `[stripe] Subscription ${live.id} was un-cancelled for a downgrade that then failed to schedule:`,
      error instanceof Error ? error.message : error,
    );
    revalidatePath("/dashboard", "layout");
    revalidatePath("/settings");
    return {
      ok: false,
      error:
        "Your plan was resumed and now renews as usual, but the switch to the new plan couldn't be scheduled. Pick the new plan again on the billing page — or, to stop the plan after all, cancel it again from there.",
    };
  }
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
      // new plan (same end date) instead of forcing payment a few days
      // early — the trial is the same one, just on a different tier, so the
      // one-trial rule is untouched. A card-backed trial (every trial since
      // 2026-09-24) switches IN PLACE through the portal like an active plan
      // (the portal's trial_update_behavior is continue_trial); a legacy
      // no-card trial is superseded by a fresh checkout that carries the
      // trial end over and collects the card.
      let carryTrialEnd: number | null = null;
      if (live) {
        if (live.items.data[0]?.price?.id === priceId) {
          return { ok: false, error: "You're already on that plan." };
        }
        if (live.status === "trialing" && (await subscriptionHasPaymentMethod(live, stripe))) {
          return await createPlanSwitchSession(stripe, customer.customerId, live, priceId, base);
        }
        if (live.status === "active") {
          const currentTier = await resolveSubscriptionTier(live, stripe);
          const currentInterval = live.items.data[0]?.price?.recurring?.interval ?? null;
          const target = { tier: input.tier, period: input.period ?? "monthly" };
          if (isPlanDowngrade({ tier: currentTier, interval: currentInterval }, target)) {
            // On a plan that is set to end, scheduleDowngrade resumes it
            // first (flag or date) and refuses if that fails.
            return await scheduleDowngrade(stripe, live, { priceId, period: target.period }, base);
          }
          // An upgrade replaces any pending downgrade (the portal refuses to
          // update a subscription a schedule manages, and the old downgrade
          // must not sneak back in at period end). On a plan that is set to
          // end, the portal's confirm page says so itself and renews it on
          // confirm ("Your subscription is currently scheduled to cancel on
          // …. By confirming, your updated subscription will be renewed" —
          // read in the sandbox 2026-10-07), so no resume is needed first.
          await releasePendingChange(stripe, live);
          return await createPlanSwitchSession(stripe, customer.customerId, live, priceId, base);
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

      // First subscription ever → 7-day free trial, CARD REQUIRED (owner
      // decision 2026-09-24): Checkout collects the card, Stripe charges it
      // when the trial ends unless the user cancels. `missing_payment_method:
      // cancel` stays as the safety net (a detached card never leaves a
      // subscription in limbo). Two independent records must both say
      // "never subscribed": the profile's webhook-written status and
      // Stripe's subscription history.
      const withTrial =
        !live &&
        !customer.hasSubscribedBefore &&
        (await isTrialEligible(stripe, customer.customerId));
      // Win-back: a trial that ended unconverted within the last 30 days
      // buys its first month at a discount — applied here, never as a code.
      const winback = !live && !withTrial && (await hasRecentLapsedTrial(customer.userId));

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        customer: customer.customerId,
        client_reference_id: customer.userId,
        line_items: [{ price: priceId, quantity: 1 }],
        // Stripe refuses promotion codes alongside a server-applied discount.
        ...(winback
          ? { discounts: [{ coupon: TRIAL_WINBACK_COUPON_ID }] }
          : { allow_promotion_codes: true }),
        // What was being bought, for checkout.session.expired (the session
        // object carries no line items) — plus the trial it supersedes.
        metadata: {
          supabase_user_id: customer.userId,
          purchase_kind: "subscription",
          tier: input.tier,
          period: input.period ?? "monthly",
          discount: winback ? "trial_winback" : "none",
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
        // Land new subscribers on the dashboard (the "go make something"
        // surface, with the credits card front and center) rather than
        // settings; BillingReturnToast is mounted there to greet them.
        success_url: `${base}/dashboard?billing=success`,
        cancel_url: `${base}/pricing?billing=cancel`,
      };
      // Funnel: the click that became a checkout. Its row id rides along in
      // the session metadata so the webhook's completed/expired rows can be
      // tied back to it (later subscription events don't carry the session).
      const funnelId = isAdminConfigured()
        ? await recordFunnelEvent(createAdminClient(), {
            event: "checkout_started",
            userId: customer.userId,
            props: {
              kind: "subscription",
              tier: input.tier,
              period: input.period ?? "monthly",
              trial: withTrial,
              discount: winback ? "trial_winback" : "none",
            },
          })
        : null;
      if (funnelId) sessionParams.metadata = { ...(sessionParams.metadata ?? {}), funnel_id: funnelId };
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create(sessionParams);
      } catch (error) {
        // A missing win-back coupon must never block a subscription: log it
        // and sell at full price (with promotion codes back on).
        const message = error instanceof Error ? error.message : String(error);
        if (!winback || !/coupon/i.test(message)) throw error;
        console.error(
          `[stripe] Win-back coupon ${TRIAL_WINBACK_COUPON_ID} unusable — selling at full price:`,
          message,
        );
        const fullPrice: Stripe.Checkout.SessionCreateParams = {
          ...sessionParams,
          allow_promotion_codes: true,
          metadata: { ...(sessionParams.metadata ?? {}), discount: "none" },
        };
        delete fullPrice.discounts;
        session = await stripe.checkout.sessions.create(fullPrice);
      }
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
    const funnelId = isAdminConfigured()
      ? await recordFunnelEvent(createAdminClient(), {
          event: "checkout_started",
          userId: customer.userId,
          props: {
            kind: "pack",
            pack: input.pack,
            credits,
            discount: subscriberDiscount ? "subscriber" : "none",
          },
        })
      : null;
    if (funnelId) params.metadata = { ...(params.metadata ?? {}), funnel_id: funnelId };
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

const RESUME_SURFACES: ReadonlySet<string> = new Set(["billing", "dashboard", "settings", "pricing", "modal"]);

function priceLineOf(sub: Stripe.Subscription): string | null {
  const price = sub.items.data[0]?.price;
  const interval = price?.recurring?.interval;
  if (price?.unit_amount == null || !interval) return null;
  return `${formatMoney(price.unit_amount, price.currency)} / ${interval}`;
}

/** The profile's own live subscription, read from Stripe — never an id from
 *  the client, and never one that belongs to another customer. */
async function readOwnSubscription(
  stripe: Stripe,
  profile: { stripe_subscription_id?: string | null; stripe_customer_id?: string | null },
): Promise<Stripe.Subscription | null> {
  if (!profile.stripe_subscription_id || !profile.stripe_customer_id) return null;
  const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id, { expand: ["schedule"] });
  if (customerIdOf(sub.customer) !== profile.stripe_customer_id) return null;
  return sub;
}

/** What "Resume" will do, for the confirm step: the plan, the price and the
 *  date it next bills — read from Stripe, so the dialog never guesses a
 *  price from the plan table (an annual plan, a grandfathered price). */
export type ResumePreview =
  | {
      ok: true;
      planName: string;
      /** A cancelled trial resumes as a trial that converts at its end. */
      trial: boolean;
      /** ISO date of the next charge once resumed. */
      nextBillAt: string | null;
      /** "$15 / month". */
      priceLine: string | null;
    }
  | { ok: false; error: string };

export async function getResumePreviewAction(): Promise<ResumePreview> {
  if (!isStripeConfigured()) return { ok: false, error: "Billing isn't available right now." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to manage billing." };
  const profile = await getCurrentProfile();
  try {
    const stripe = getStripe();
    const sub = profile ? await readOwnSubscription(stripe, profile) : null;
    if (!sub || !isLiveStatus(sub.status)) {
      return { ok: false, error: "There's no plan to resume." };
    }
    const tier = (await resolveSubscriptionTier(sub, stripe)) ?? profile?.subscription_tier ?? "plus";
    const trial = sub.status === "trialing" && typeof sub.trial_end === "number";
    const nextBill = trial ? sub.trial_end : (sub.items.data[0]?.current_period_end ?? null);
    return {
      ok: true,
      planName: planForTier(tier === "pro" ? "pro" : "plus").name,
      trial,
      nextBillAt: typeof nextBill === "number" ? new Date(nextBill * 1000).toISOString() : null,
      priceLine: priceLineOf(sub),
    };
  } catch (error) {
    console.error("[stripe] Resume preview failed:", error instanceof Error ? error.message : error);
    return { ok: false, error: "Couldn't read your plan from Stripe." };
  }
}

/**
 * "Resume <Plan>": un-cancel the subscription in one click, without the
 * Customer Portal. The subscription is the profile's own (never an id from
 * the client); nothing is charged — the plan simply renews on its usual date
 * again. The profile is resynced here, so the page that follows already says
 * "Renews on" without waiting for the webhook. When the in-app step fails
 * the result carries `fallback: "portal"`: Stripe's portal has its own
 * "Renew plan" button.
 */
export async function resumeSubscriptionAction(
  input: { surface?: string } = {},
): Promise<BillingActionResult> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing isn't available right now." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to manage billing." };
  const profile = await getCurrentProfile();
  if (!profile?.stripe_subscription_id || !profile.stripe_customer_id) {
    return { ok: false, error: "There's no plan to resume." };
  }
  const done: BillingActionResult = { ok: true, url: `${getSiteBaseUrl()}/dashboard/billing?billing=resumed` };
  try {
    const stripe = getStripe();
    const sub = await readOwnSubscription(stripe, profile);
    if (!sub) return { ok: false, error: "There's no plan to resume." };
    if (!isLiveStatus(sub.status)) {
      if (sub.status === "canceled" || sub.status === "incomplete_expired") {
        // Already over: nothing to un-cancel — a new plan is a new checkout.
        return { ok: false, error: "This plan has already ended. Pick a plan to start a new one." };
      }
      // past_due / unpaid / incomplete / paused: it has NOT ended, and a
      // second subscription would bill twice — the portal is where the
      // payment gets fixed (the same door the checkout action uses).
      return {
        ok: false,
        error: "This plan can't be resumed here while its payment needs attention. Opening the billing portal.",
        fallback: "portal",
      };
    }
    const wasEnding = subscriptionEndsAt(sub) != null;
    const resumed = wasEnding ? await clearCancellation(stripe, sub) : sub;
    if (subscriptionEndsAt(resumed) != null) {
      console.error(`[stripe] Resume left subscription ${sub.id} still set to end (user ${user.id}).`);
      return {
        ok: false,
        error: "Couldn't resume the plan here. Opening the billing portal — use Renew plan there.",
        fallback: "portal",
      };
    }
    if (isAdminConfigured()) {
      const admin = createAdminClient();
      // Best effort: Stripe is already right, and the webhook's
      // subscription.updated event writes the same row a moment later.
      try {
        await syncSubscriptionForUser(admin, stripe, user.id, {
          eventSub: resumed,
          customerId: profile.stripe_customer_id,
        });
      } catch (error) {
        console.error(
          "[stripe] Profile resync after resume failed (the webhook will repeat it):",
          error instanceof Error ? error.message : error,
        );
      }
      // Funnel: a resume is a money step (a cancellation that didn't happen).
      // Not recorded for a click on a plan that was not ending any more.
      if (wasEnding) {
        await recordFunnelEvent(admin, {
          event: "subscription_resumed",
          userId: user.id,
          props: {
            tier: (await resolveSubscriptionTier(resumed, stripe)) ?? undefined,
            interval: resumed.items.data[0]?.price?.recurring?.interval ?? undefined,
            trial: resumed.status === "trialing",
            subscriptionId: resumed.id,
            surface: input.surface && RESUME_SURFACES.has(input.surface) ? input.surface : undefined,
          },
        });
      }
    }
    console.info(`[stripe] Subscription ${sub.id} resumed in-app by user ${user.id}.`);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/settings");
    return done;
  } catch (error) {
    console.error(
      "[stripe] Resuming the subscription failed:",
      error instanceof Error ? error.message : error,
    );
    return {
      ok: false,
      error: "Couldn't resume the plan here. Opening the billing portal — use Renew plan there.",
      fallback: "portal",
    };
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
