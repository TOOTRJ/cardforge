import "server-only";

import Stripe from "stripe";

// Lazy singleton so importing this module never throws when Stripe isn't
// configured — features degrade ("billing not available") rather than crashing
// the build/import, matching the app's posture for optional integrations.

let cached: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  cached = new Stripe(key, {
    // Pin to the version this SDK (v22) ships against so webhook event shapes
    // match the types. Keep the Stripe Dashboard webhook endpoint on the same
    // version. (Basil/Dahlia: current_period_end lives on subscription items.)
    apiVersion: "2026-05-27.dahlia",
    typescript: true,
  });
  return cached;
}
