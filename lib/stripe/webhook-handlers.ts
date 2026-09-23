import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  customerIdOf,
  grantCreditsForSync,
  isLiveStatus,
  resolveSubscriptionTier,
  syncSubscriptionForUser,
} from "./subscription-sync";
import { trialEndingEmail } from "@/lib/email/messages";
import { getRecipientFor } from "@/lib/email/preferences";
import { isEmailConfigured, sendEmail } from "@/lib/email/send";
import { formatMoney } from "@/lib/billing/subscription-details";

// All entitlement/credit writes happen here, via the service-role admin client
// (RLS would block writing these columns from a user client). Handlers are
// idempotent: subscription writes are upserts keyed by profile id, and
// credit grants are deduped by idempotency_key inside grant_credits().
//
// Subscription state is written by lib/stripe/subscription-sync.ts — the same
// code the admin "Resync from Stripe" tool runs — so an event never decides
// the profile's tier on its own: the sync reads the customer's full
// subscription list, picks the primary live subscription, resolves its tier
// from the price/product (not only the env ids), and refuses to demote an
// active subscriber whose price it cannot map.
//
// Credit refills are cron-driven (see app/api/cron/refill-credits) so monthly
// AND annual plans both get a monthly allotment. We additionally grant the
// FIRST month immediately on subscription create/update — deduped against the
// cron via the same per-user-per-month key — so a new subscriber gets credits
// without waiting for the next cron tick. Mid-month upgrades get the tier
// delta topped up via lib/billing/credit-refill (shared with the cron).
// Trials are the exception: one grant at creation, no refills until the
// first payment (grantCreditsForSync — the cron skips trialing too).

type AdminClient = ReturnType<typeof createAdminClient>;

async function findUserIdByCustomer(
  customerId: string,
  admin: AdminClient,
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.id ?? null;
}

// Map a subscription to its profile. Primary key is stripe_customer_id; the
// fallback is the supabase_user_id the checkout action stamps into the
// subscription metadata — and when the fallback fires we BACKFILL the missing
// stripe_customer_id so every later event (invoice.payment_failed matches on
// customer id only) finds the row. This made the first live trial recoverable:
// the customer id had never been persisted (see ensureStripeCustomer), so the
// customer lookup matched nothing and the webhook silently no-opped.
async function resolveSubscriptionUserId(
  sub: Stripe.Subscription,
  admin: AdminClient,
): Promise<string | null> {
  const customerId = customerIdOf(sub.customer);
  if (customerId) {
    const byCustomer = await findUserIdByCustomer(customerId, admin);
    if (byCustomer) return byCustomer;
  }

  const metaUserId = sub.metadata?.supabase_user_id ?? null;
  if (!metaUserId) return null;
  if (customerId) {
    await admin
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", metaUserId);
  }
  return metaUserId;
}

/** The subscription an invoice bills, if any (API 2025-03+ nests it under
 *  `parent.subscription_details`; a pack purchase invoice has none). */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const ref = invoice.parent?.subscription_details?.subscription ?? null;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function handleSubscriptionEvent(
  sub: Stripe.Subscription,
  deps: { admin: AdminClient; stripe: Stripe },
  opts: { deleted: boolean; isCreationEvent: boolean },
): Promise<void> {
  const { admin, stripe } = deps;
  const userId = await resolveSubscriptionUserId(sub, admin);
  if (!userId) return;

  const result = await syncSubscriptionForUser(admin, stripe, userId, {
    eventSub: sub,
    eventDeleted: opts.deleted,
    customerId: customerIdOf(sub.customer),
  });
  if (opts.deleted) return; // no credit grant on cancellation

  // The one-grant-per-trial rule keys on the CREATED event of the synced
  // subscription — a created event for a secondary subscription must not
  // re-grant the primary's month.
  await grantCreditsForSync(result, admin, {
    isCreationEvent: opts.isCreationEvent && result.subscriptionId === sub.id,
  });
}

/** Stripe checks the subscription's default payment method AND the
 *  customer's when a trial ends — mirror that so the reminder is honest. */
async function subscriptionHasPaymentMethod(
  sub: Stripe.Subscription,
  stripe: Stripe,
): Promise<boolean> {
  if (sub.default_payment_method || sub.default_source) return true;
  const customerId = customerIdOf(sub.customer);
  if (!customerId) return false;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) return false;
    return Boolean(customer.invoice_settings?.default_payment_method || customer.default_source);
  } catch {
    return false;
  }
}

const TIER_NAME: Record<string, string> = { plus: "Plus", pro: "Pro" };

// customer.subscription.trial_will_end — three days before a trial ends (at
// once for shorter trials). ONE in-app notification + ONE "account" email per
// subscription, honest about whether the plan converts (a card is on file)
// or simply ends. Stripe's card-network rules require a reminder before a
// trial converts; this is ours (docs/BILLING.md). The notification insert is
// the durable part: a failure throws so Stripe retries; the email is best
// effort on top (idempotent at the provider by subscription id).
async function handleTrialWillEnd(
  sub: Stripe.Subscription,
  deps: { admin: AdminClient; stripe: Stripe },
): Promise<void> {
  const { admin, stripe } = deps;
  if (sub.status !== "trialing") return;
  const userId = await resolveSubscriptionUserId(sub, admin);
  if (!userId) return;

  // Once per subscription — a retried delivery (or a second event after a
  // trial extension) must not notify twice.
  const { data: existing } = await admin
    .from("notifications")
    .select("id")
    .eq("type", "trial_ending")
    .eq("payload->>subscriptionId", sub.id)
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const [tier, hasPaymentMethod] = await Promise.all([
    resolveSubscriptionTier(sub, stripe),
    subscriptionHasPaymentMethod(sub, stripe),
  ]);
  const price = sub.items?.data?.[0]?.price ?? null;
  const interval = price?.recurring?.interval ?? null;
  const payload = {
    subscriptionId: sub.id,
    tier,
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    hasPaymentMethod,
    amountCents: typeof price?.unit_amount === "number" ? price.unit_amount : null,
    currency: price?.currency ?? "usd",
    interval,
  };
  const { error } = await admin.from("notifications").insert({
    recipient_id: userId,
    actor_id: null,
    type: "trial_ending",
    payload,
  });
  if (error) {
    throw new Error(`trial_ending notification failed for ${userId}: ${error.message}`);
  }

  if (!isEmailConfigured() || !payload.trialEnd) return;
  try {
    const recipient = await getRecipientFor(admin, userId, "account");
    if (!recipient) return;
    await sendEmail(
      trialEndingEmail(recipient, {
        plan: TIER_NAME[tier ?? ""] ?? "PipGlyph",
        trialEndsAt: payload.trialEnd,
        hasPaymentMethod,
        priceLabel:
          payload.amountCents != null && interval
            ? `${formatMoney(payload.amountCents, payload.currency)} / ${interval}`
            : null,
      }),
      { idempotencyKey: `trial-ending:${sub.id}` },
    );
  } catch (error) {
    console.warn(
      "[stripe] trial-ending email failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

// A subscription checkout that SUPERSEDES an earlier no-card trial (the user
// bought a plan mid-trial — see createCheckoutSessionAction): once the new
// subscription is paid for, cancel the trial so the customer never carries
// two subscriptions. Done here, on completion, rather than before checkout,
// so an abandoned checkout leaves the trial untouched. The trial's later
// `deleted` event then resyncs against the customer's subscription list and
// finds the paid plan still live — no demotion.
async function handleSupersededSubscription(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
): Promise<void> {
  if (session.mode !== "subscription") return;
  const oldId = session.metadata?.supersedes_subscription_id;
  const newId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;
  if (!oldId || oldId === newId) return;
  try {
    const old = await stripe.subscriptions.retrieve(oldId);
    if (isLiveStatus(old.status)) {
      await stripe.subscriptions.cancel(oldId, { prorate: false });
    }
  } catch (error) {
    // Best effort: a lingering trial cancels itself at day 7 (missing
    // payment method → cancel). Log so it's visible, never fail the event.
    console.error(
      `[stripe] Could not cancel superseded subscription ${oldId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// Grant a one-time pack purchase. Runs for BOTH checkout.session.completed
// and checkout.session.async_payment_succeeded: for cards `completed` arrives
// already paid; for async/delayed methods (some bank debits, vouchers)
// `completed` fires unpaid — the grant used to be silently skipped and the
// customer's money kept with nothing delivered — and the credits now land on
// the later async_payment_succeeded event. Idempotency is keyed by the
// SESSION id (not the event id): the two event types carry different event
// ids, so a session-scoped key is what guarantees one grant per purchase no
// matter which (or how many) of them arrive.
async function handleCheckoutPaid(
  session: Stripe.Checkout.Session,
  admin: AdminClient,
): Promise<void> {
  // Subscriptions are provisioned by customer.subscription.* events; here we
  // only grant credits for one-time pack purchases (mode = "payment").
  if (session.mode !== "payment") return;
  // Only grant once funds have actually settled.
  if (session.payment_status !== "paid") return;
  const meta = session.metadata ?? {};
  if (meta.purchase_kind !== "pack") return;

  const userId = meta.supabase_user_id ?? session.client_reference_id ?? null;
  const credits = Number(meta.pack_credits ?? 0);
  if (!userId || !Number.isFinite(credits) || credits <= 0) return;

  const { error } = await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: credits,
    p_reason: "pack_purchase",
    p_idempotency_key: `pack:${session.id}`,
  });
  // Throw so the webhook 500s and Stripe retries — a swallowed error here is
  // money taken with no credits delivered.
  if (error) {
    throw new Error(`Pack grant failed for ${userId}: ${error.message}`);
  }
}

export async function handleStripeEvent(
  event: Stripe.Event,
  deps: { admin: AdminClient; stripe: Stripe },
): Promise<void> {
  const { admin, stripe } = deps;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutPaid(session, admin);
      await handleSupersededSubscription(session, stripe);
      break;
    }
    // Async/delayed payment methods settle AFTER `completed` (which arrives
    // unpaid and grants nothing) — the pack's credits land on this event.
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutPaid(
        event.data.object as Stripe.Checkout.Session,
        admin,
      );
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionEvent(
        event.data.object as Stripe.Subscription,
        deps,
        {
          deleted: false,
          isCreationEvent: event.type === "customer.subscription.created",
        },
      );
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionEvent(
        event.data.object as Stripe.Subscription,
        deps,
        { deleted: true, isCreationEvent: false },
      );
      break;
    case "customer.subscription.trial_will_end":
      await handleTrialWillEnd(event.data.object as Stripe.Subscription, deps);
      break;
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = customerIdOf(invoice.customer);
      if (!customerId) break;
      // Through the sync layer like every other subscription event: the
      // failed invoice may belong to a SECONDARY subscription (the lingering
      // no-card trial next to a paid plan), and writing past_due by customer
      // id demoted the primary until its next event. With the API reachable
      // the primary's live state wins; without it, the old customer-keyed
      // write is the fallback.
      const subscriptionId = invoiceSubscriptionId(invoice);
      let synced = false;
      if (subscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await handleSubscriptionEvent(sub, deps, { deleted: false, isCreationEvent: false });
          synced = true;
        } catch {
          synced = false;
        }
      }
      if (!synced) {
        await admin
          .from("profiles")
          .update({ subscription_status: "past_due" })
          .eq("stripe_customer_id", customerId);
      }
      break;
    }
    default:
      break;
  }
}
