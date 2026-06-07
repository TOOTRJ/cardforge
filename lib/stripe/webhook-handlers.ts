import "server-only";

import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  creditRefillKey,
  currentCreditPeriod,
} from "@/lib/billing/plans";
import { monthlyCreditsForTier, tierForPriceId } from "./config";

// All entitlement/credit writes happen here, via the service-role admin client
// (RLS would block writing these columns from a user client). Handlers are
// idempotent: subscription writes are upserts keyed by stripe_customer_id, and
// credit grants are deduped by idempotency_key inside grant_credits().
//
// Credit refills are cron-driven (see app/api/cron/refill-credits) so monthly
// AND annual plans both get a monthly allotment. We additionally grant the
// FIRST month immediately on subscription create/update — deduped against the
// cron via the same per-user-per-month key — so a new subscriber gets credits
// without waiting for the next cron tick.

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

async function upsertSubscriptionState(
  sub: Stripe.Subscription,
  admin: AdminClient,
  opts: { deleted?: boolean } = {},
): Promise<void> {
  const customerId = customerIdOf(sub.customer);
  if (!customerId) return;

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
    .eq("stripe_customer_id", customerId);
}

// Grant this month's credit allotment for an active subscription. Idempotent
// per user per calendar month (same key the cron uses), so calling it on both
// subscription.created and .updated — and from the cron — grants at most once.
async function maybeGrantMonthlyCredits(
  sub: Stripe.Subscription,
  admin: AdminClient,
): Promise<void> {
  if (!ACTIVE_STATUSES.has(sub.status)) return;
  const customerId = customerIdOf(sub.customer);
  if (!customerId) return;
  const userId = await findUserIdByCustomer(customerId, admin);
  if (!userId) return;

  const tier = tierForPriceId(sub.items.data[0]?.price?.id);
  if (!tier || tier === "free") return;
  const amount = monthlyCreditsForTier(tier);
  if (amount <= 0) return;

  await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: "subscription_refill",
    p_idempotency_key: creditRefillKey(userId, currentCreditPeriod()),
  });
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  admin: AdminClient,
  eventId: string,
): Promise<void> {
  // Subscriptions are provisioned by customer.subscription.* events; here we
  // only grant credits for one-time pack purchases (mode = "payment").
  if (session.mode !== "payment") return;
  const meta = session.metadata ?? {};
  if (meta.purchase_kind !== "pack") return;

  const userId = meta.supabase_user_id ?? session.client_reference_id ?? null;
  const credits = Number(meta.pack_credits ?? 0);
  if (!userId || !Number.isFinite(credits) || credits <= 0) return;

  await admin.rpc("grant_credits", {
    p_user_id: userId,
    p_amount: credits,
    p_reason: "pack_purchase",
    p_idempotency_key: eventId,
  });
}

export async function handleStripeEvent(
  event: Stripe.Event,
  deps: { admin: AdminClient; stripe: Stripe },
): Promise<void> {
  const { admin } = deps;
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        admin,
        event.id,
      );
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await upsertSubscriptionState(sub, admin);
      await maybeGrantMonthlyCredits(sub, admin);
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
