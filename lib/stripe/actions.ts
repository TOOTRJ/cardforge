"use server";

import { getCurrentProfile, getCurrentUser, createClient } from "@/lib/supabase/server";
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  CREDIT_PACKS,
  type BillingPeriod,
  type PackKey,
  type PaidTier,
} from "@/lib/billing/plans";
import { getStripe, isStripeConfigured } from "./client";
import { priceIdForPack, priceIdForTier } from "./config";

export type CheckoutInput =
  | { kind: "subscription"; tier: PaidTier; period?: BillingPeriod }
  | { kind: "pack"; pack: PackKey };

export type BillingActionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Ensure the current user has a Stripe customer, creating + persisting one on
// first use. The stripe_customer_id is written via the user's own anon client
// (allowed by the "update own profile" RLS policy) — the webhook later writes
// the tier/credits columns with the service role.
async function ensureStripeCustomer(): Promise<
  { ok: true; customerId: string; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to manage billing." };

  const profile = await getCurrentProfile();
  if (profile?.stripe_customer_id) {
    return { ok: true, customerId: profile.stripe_customer_id, userId: user.id };
  }

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { supabase_user_id: user.id },
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id);
  if (error) {
    // Don't strand an orphaned customer silently — surface a retryable error.
    return { ok: false, error: "Couldn't link your billing account. Try again." };
  }

  return { ok: true, customerId: customer.id, userId: user.id };
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
      const priceId = priceIdForTier(input.tier, input.period ?? "monthly");
      if (!priceId) return { ok: false, error: "That plan isn't available yet." };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.customerId,
        client_reference_id: customer.userId,
        line_items: [{ price: priceId, quantity: 1 }],
        allow_promotion_codes: true,
        subscription_data: { metadata: { supabase_user_id: customer.userId } },
        success_url: `${base}/settings?billing=success`,
        cancel_url: `${base}/pricing?billing=cancel`,
      });
      if (!session.url) return { ok: false, error: "Couldn't start checkout." };
      return { ok: true, url: session.url };
    }

    // One-time credit pack.
    const priceId = priceIdForPack(input.pack);
    if (!priceId) return { ok: false, error: "That pack isn't available yet." };
    const credits = CREDIT_PACKS[input.pack].credits;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customer.customerId,
      client_reference_id: customer.userId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Trusted server-set metadata the webhook reads to grant the right amount.
      metadata: {
        supabase_user_id: customer.userId,
        purchase_kind: "pack",
        pack_credits: String(credits),
      },
      success_url: `${base}/settings?billing=credits`,
      cancel_url: `${base}/pricing?billing=cancel`,
    });
    if (!session.url) return { ok: false, error: "Couldn't start checkout." };
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "Stripe checkout failed. Please try again." };
  }
}

export async function createPortalSessionAction(): Promise<BillingActionResult> {
  if (!isStripeConfigured()) {
    return { ok: false, error: "Billing isn't available right now." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to manage billing." };

  const profile = await getCurrentProfile();
  if (!profile?.stripe_customer_id) {
    return { ok: false, error: "You don't have a billing account yet." };
  }

  try {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${getSiteBaseUrl()}/settings`,
    });
    return { ok: true, url: session.url };
  } catch {
    return { ok: false, error: "Couldn't open the billing portal. Try again." };
  }
}
