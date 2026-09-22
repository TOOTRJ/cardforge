import type Stripe from "stripe";

import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { handleStripeEvent } from "@/lib/stripe/webhook-handlers";

// Stripe webhook receiver. MUST run on Node.js (the Stripe SDK + raw-body
// signature verification aren't Edge-safe) and read the RAW request body —
// re-serializing via req.json() would break the signature.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An unprocessed claim older than this is presumed dead and re-run. Longer
 *  than any handler can legitimately take (Vercel's function limit is 300 s). */
const STALE_CLAIM_MS = 10 * 60 * 1000;

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

  // Idempotency, crash-safe (migration 0099). Claim the event id with
  // processed_at NULL; stamp it only after the handler succeeds. A Stripe
  // retry that meets an existing claim then knows three states:
  //   processed            → 200, stop retrying
  //   unprocessed, fresh   → another delivery is mid-flight: 409, retry later
  //   unprocessed, stale   → the earlier attempt died: take over and re-run
  // Handlers are idempotent (upserts + credit idempotency keys), so a re-run
  // is always safe; a lost event never is.
  const { error: claimError } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, processed_at: null });
  if (claimError) {
    if ((claimError as { code?: string }).code !== "23505") {
      // Unexpected storage error — let Stripe retry.
      return new Response("Storage error", { status: 500 });
    }
    const { data: existing } = await admin
      .from("stripe_events")
      .select("processed_at, claimed_at")
      .eq("id", event.id)
      .maybeSingle();
    if (!existing || existing.processed_at) {
      return new Response("Already processed", { status: 200 });
    }
    const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
    if (existing.claimed_at >= staleBefore) {
      return new Response("In progress", { status: 409 });
    }
    // Conditional takeover: only one retry wins the stale claim.
    const { data: taken } = await admin
      .from("stripe_events")
      .update({ claimed_at: new Date().toISOString() })
      .eq("id", event.id)
      .is("processed_at", null)
      .lt("claimed_at", staleBefore)
      .select("id");
    if (!taken || taken.length === 0) {
      return new Response("In progress", { status: 409 });
    }
  }

  try {
    await handleStripeEvent(event, { admin, stripe });
  } catch {
    // Release the claim so Stripe's next retry reprocesses this event right
    // away. (An UNCAUGHT death — timeout, OOM — skips this line; the stale
    // takeover above covers that case.)
    await admin.from("stripe_events").delete().eq("id", event.id);
    return new Response("Handler error", { status: 500 });
  }

  await admin
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", event.id);

  return new Response("ok", { status: 200 });
}
