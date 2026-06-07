import type Stripe from "stripe";

import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { handleStripeEvent } from "@/lib/stripe/webhook-handlers";

// Stripe webhook receiver. MUST run on Node.js (the Stripe SDK + raw-body
// signature verification aren't Edge-safe) and read the RAW request body —
// re-serializing via req.json() would break the signature.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isStripeConfigured() || !isAdminConfigured()) {
    return new Response("Billing not configured", { status: 503 });
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("Webhook secret missing", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const rawBody = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: claim the event id. A unique-violation means we've already
  // processed it (a Stripe retry) → ack with 200 so retries stop.
  const { error: claimError } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });
  if (claimError) {
    if ((claimError as { code?: string }).code === "23505") {
      return new Response("Already processed", { status: 200 });
    }
    // Unexpected storage error — let Stripe retry.
    return new Response("Storage error", { status: 500 });
  }

  try {
    await handleStripeEvent(event, { admin, stripe });
  } catch {
    // Release the claim so Stripe's retry reprocesses this event (handlers are
    // idempotent, so reprocessing is safe).
    await admin.from("stripe_events").delete().eq("id", event.id);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
