import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { currentCreditPeriod } from "@/lib/billing/plans";
import { grantMonthlyCreditsForPeriod } from "@/lib/billing/credit-refill";
import { tierForPriceId } from "./config";

// All entitlement/credit writes happen here, via the service-role admin client
// (RLS would block writing these columns from a user client). Handlers are
// idempotent: subscription writes are upserts keyed by stripe_customer_id, and
// credit grants are deduped by idempotency_key inside grant_credits().
//
// Credit refills are cron-driven (see app/api/cron/refill-credits) so monthly
// AND annual plans both get a monthly allotment. We additionally grant the
// FIRST month immediately on subscription create/update — deduped against the
// cron via the same per-user-per-month key — so a new subscriber gets credits
// without waiting for the next cron tick. Mid-month upgrades get the tier
// delta topped up via lib/billing/credit-refill (shared with the cron).
// Trials are the exception: one grant at creation, no refills until the
// first payment (see maybeGrantMonthlyCredits — the cron skips trialing too).

type AdminClient = ReturnType<typeof createAdminClient>;

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): string | null {
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

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

async function upsertSubscriptionState(
  sub: Stripe.Subscription,
  admin: AdminClient,
  opts: { deleted?: boolean } = {},
): Promise<void> {
  const userId = await resolveSubscriptionUserId(sub, admin);
  if (!userId) return;

  const item = sub.items.data[0];
  const tier = opts.deleted ? "free" : tierForPriceId(item?.price?.id) ?? "free";
  // Basil/Dahlia: the period lives on the subscription ITEM, not the sub.
  const periodEnd = item?.current_period_end
    ? new Date(item.current_period_end * 1000).toISOString()
    : null;

  await admin
    .from("profiles")
    .update({
      subscription_tier: tier,
      subscription_status: opts.deleted ? "canceled" : sub.status,
      stripe_subscription_id: opts.deleted ? null : sub.id,
      current_period_end: opts.deleted ? null : periodEnd,
      cancel_at_period_end: opts.deleted ? false : sub.cancel_at_period_end,
    })
    .eq("id", userId);
}

// Grant this month's credit allotment for an active subscription — the base
// grant is idempotent per user per calendar month (same key the cron uses),
// and a mid-month tier upgrade tops up the difference (see credit-refill.ts;
// before that, the consumed month key meant an upgrade granted NOTHING until
// the next month). A failed grant throws so the webhook 500s and Stripe
// retries — the old code discarded the RPC error and acked a lost grant.
async function maybeGrantMonthlyCredits(
  sub: Stripe.Subscription,
  admin: AdminClient,
  opts: { isCreationEvent: boolean },
): Promise<void> {
  if (!ACTIVE_STATUSES.has(sub.status)) return;
  // A TRIAL gets exactly ONE grant: on subscription.created. Without this
  // gate, a no-card 7-day trial spanning a calendar-month boundary banked a
  // SECOND month's allotment (never-expiring) from any subscription.updated
  // event — or the refill cron — firing in the new month, all without a
  // single payment. Monthly refills resume when the trial converts: the
  // first paid month's grant lands via the status-active update/cron.
  if (sub.status === "trialing" && !opts.isCreationEvent) return;
  const userId = await resolveSubscriptionUserId(sub, admin);
  if (!userId) return;

  const tier = tierForPriceId(sub.items.data[0]?.price?.id);
  if (!tier || tier === "free") return;

  const result = await grantMonthlyCreditsForPeriod(
    admin,
    userId,
    tier,
    currentCreditPeriod(),
  );
  if (!result.ok) {
    throw new Error(`Credit grant failed for ${userId}: ${result.error}`);
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
  const { admin } = deps;
  switch (event.type) {
    case "checkout.session.completed":
    // Async/delayed payment methods settle AFTER `completed` (which arrives
    // unpaid and grants nothing) — the pack's credits land on this event.
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutPaid(
        event.data.object as Stripe.Checkout.Session,
        admin,
      );
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await upsertSubscriptionState(sub, admin);
      await maybeGrantMonthlyCredits(sub, admin, {
        isCreationEvent: event.type === "customer.subscription.created",
      });
      break;
    }
    case "customer.subscription.deleted":
      await upsertSubscriptionState(event.data.object as Stripe.Subscription, admin, {
        deleted: true,
      });
      break;
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = customerIdOf(invoice.customer);
      if (customerId) {
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
