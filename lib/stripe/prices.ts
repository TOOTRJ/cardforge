import "server-only";

import type Stripe from "stripe";
import type { BillingPeriod, PackKey, PaidTier } from "@/lib/billing/plans";
import { priceIdForPack, priceIdForTier } from "./config";

// ---------------------------------------------------------------------------
// Which Stripe price a plan key sells — resolved from the catalog itself.
//
// Every price in the live account AND the sandbox carries a lookup key
// (plus_monthly, plus_annual, pro_monthly, pro_annual, pack_mini, pack_small,
// pack_large). Resolving by lookup key at checkout time means the six
// STRIPE_PRICE_* env vars can never break a purchase: on 2026-09-22 Stripe's
// log showed 22 failed `checkout.sessions.create` calls in live mode
// ("resource_missing: line_items[*][price]") — an env var held an id the
// live catalog doesn't have, so every credit-pack purchase silently failed
// (the action turned the error into a toast and logged nothing).
//
// Order: the catalog's price with that lookup key wins; a STRIPE_PRICE_* env
// var is only a fallback when the catalog has no such key (and a loud
// warning when the two disagree). Results are cached per process for a few
// minutes — a price id is stable, and this is one extra request per
// checkout otherwise.
// ---------------------------------------------------------------------------

export type PriceLookupKey =
  | "plus_monthly"
  | "plus_annual"
  | "pro_monthly"
  | "pro_annual"
  | "pack_mini"
  | "pack_small"
  | "pack_large";

export function tierLookupKey(tier: PaidTier, period: BillingPeriod = "monthly"): PriceLookupKey {
  return `${tier}_${period}` as PriceLookupKey;
}

export function packLookupKey(pack: PackKey): PriceLookupKey {
  return `pack_${pack}` as PriceLookupKey;
}

function envPriceId(key: PriceLookupKey): string | undefined {
  switch (key) {
    case "plus_monthly":
      return priceIdForTier("plus", "monthly");
    case "plus_annual":
      return priceIdForTier("plus", "annual");
    case "pro_monthly":
      return priceIdForTier("pro", "monthly");
    case "pro_annual":
      return priceIdForTier("pro", "annual");
    case "pack_mini":
      return priceIdForPack("mini");
    case "pack_small":
      return priceIdForPack("small");
    case "pack_large":
      return priceIdForPack("large");
  }
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<PriceLookupKey, { id: string; expiresAt: number }>();

/** Tests only. */
export function clearPriceCache(): void {
  cache.clear();
}

/** The minimal Stripe surface this needs — structural so tests can stub it. */
export type PriceLister = {
  prices: {
    list: (params: {
      lookup_keys: string[];
      active: boolean;
      limit: number;
    }) => Promise<{ data: Array<{ id: string }> }>;
  };
};

/**
 * The active price id for `key`, from the catalog's lookup key first and the
 * STRIPE_PRICE_* env var as a fallback. Null when neither exists (the caller
 * answers "That plan isn't available yet.").
 */
export async function resolvePriceId(
  stripe: Stripe | PriceLister,
  key: PriceLookupKey,
): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.id;

  let fromCatalog: string | null = null;
  try {
    const list = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
    fromCatalog = list.data[0]?.id ?? null;
  } catch (error) {
    console.error(
      `[stripe] Price lookup for "${key}" failed:`,
      error instanceof Error ? error.message : error,
    );
  }
  const fromEnv = envPriceId(key);

  if (fromCatalog) {
    if (fromEnv && fromEnv !== fromCatalog) {
      console.warn(
        `[stripe] STRIPE_PRICE_* for "${key}" is ${fromEnv} but the catalog's active price with that lookup key is ${fromCatalog}; using the catalog. Fix or remove the env var.`,
      );
    }
    cache.set(key, { id: fromCatalog, expiresAt: Date.now() + CACHE_TTL_MS });
    return fromCatalog;
  }
  if (fromEnv) {
    console.warn(
      `[stripe] No active price with lookup key "${key}" in this Stripe account; falling back to STRIPE_PRICE_* ${fromEnv}.`,
    );
    return fromEnv;
  }
  console.error(
    `[stripe] No price for "${key}": add a price with that lookup key to the Stripe catalog (or set the STRIPE_PRICE_* env var).`,
  );
  return null;
}
