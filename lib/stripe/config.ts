import "server-only";

import {
  CREDIT_PACKS,
  MONTHLY_CREDITS,
  type BillingPeriod,
  type PackKey,
  type PaidTier,
  type PlanTier,
} from "@/lib/billing/plans";

// Server-only mapping between our stable plan/pack keys and the Stripe price IDs
// configured in the environment. Price IDs aren't secret, but keeping them
// server-side means the UI only ever passes a known key ("plus"/"pro"/"small"/
// "large"), so a client can't checkout an arbitrary price.

const TIER_PRICE_ENV: Record<PaidTier, Record<BillingPeriod, string>> = {
  plus: {
    monthly: "STRIPE_PRICE_PLUS_MONTHLY",
    annual: "STRIPE_PRICE_PLUS_ANNUAL",
  },
  pro: {
    monthly: "STRIPE_PRICE_PRO_MONTHLY",
    annual: "STRIPE_PRICE_PRO_ANNUAL",
  },
};

const PACK_PRICE_ENV: Record<PackKey, string> = {
  small: "STRIPE_PRICE_PACK_SMALL",
  large: "STRIPE_PRICE_PACK_LARGE",
};

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function priceIdForTier(
  tier: PaidTier,
  period: BillingPeriod = "monthly",
): string | undefined {
  return readEnv(TIER_PRICE_ENV[tier][period]);
}

export function priceIdForPack(pack: PackKey): string | undefined {
  return readEnv(PACK_PRICE_ENV[pack]);
}

/** Reverse map a Stripe subscription price id → our tier (webhook). */
export function tierForPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const tier of ["plus", "pro"] as PaidTier[]) {
    const envs = TIER_PRICE_ENV[tier];
    if (readEnv(envs.monthly) === priceId || readEnv(envs.annual) === priceId) {
      return tier;
    }
  }
  return null;
}

/** Reverse map a Stripe one-time price id → the credit pack size (webhook). */
export function creditsForPackPriceId(priceId: string | null | undefined): number | null {
  if (!priceId) return null;
  for (const pack of Object.keys(CREDIT_PACKS) as PackKey[]) {
    if (readEnv(PACK_PRICE_ENV[pack]) === priceId) return CREDIT_PACKS[pack].credits;
  }
  return null;
}

export function monthlyCreditsForTier(tier: PlanTier): number {
  return MONTHLY_CREDITS[tier] ?? 0;
}
