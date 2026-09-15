import "server-only";

import {
  PLANS,
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

/** Reverse map a Stripe subscription price id → our tier (env ids only). */
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

// ---------------------------------------------------------------------------
// Price → tier resolution beyond the env ids.
//
// The env ids are the FIRST match, but they must not be the ONLY one: a
// subscription can legitimately land on a price we never configured — the
// Stripe Customer Portal lets a subscriber switch plans between whatever
// prices the portal's product catalog lists, and a price gets recreated
// every time its amount changes (prices are immutable). On 2026-09-14 a
// subscriber upgraded from the Plus trial to Pro through the portal, the
// webhook matched the new price against nothing, and the old
// `tierForPriceId(...) ?? "free"` DEMOTED a paying customer to free
// (status active, tier free — no exports, no editing past 50 cards). The
// fallbacks below resolve the tier from what the price/product itself says,
// and the sync layer (lib/stripe/subscription-sync.ts) refuses to demote an
// active subscription whose tier still can't be determined.
// ---------------------------------------------------------------------------

/** The slice of a Stripe Price the resolver reads — kept structural so the
 *  webhook (expanded price on the subscription item), unit tests, and the
 *  admin resync can all feed it without importing Stripe types. */
export type PriceLike = {
  id?: string | null;
  lookup_key?: string | null;
  nickname?: string | null;
  metadata?: Record<string, string> | null;
  unit_amount?: number | null;
  recurring?: { interval?: string | null } | null;
  /** Expanded product (or just its id) — only the object form helps. */
  product?: string | ProductLike | null;
};

export type ProductLike = {
  id?: string;
  name?: string | null;
  metadata?: Record<string, string> | null;
  /** Stripe types this `void` on a live Product and `true` on a deleted
   *  one — kept loose so both satisfy the shape. */
  deleted?: unknown;
};

/** "pro" / "plus" spelled out in a metadata value, lookup key, nickname, or
 *  product name — word-bounded so "Pro" doesn't match "Protection". */
function tierFromLabel(label: string | null | undefined): PaidTier | null {
  if (!label) return null;
  // Underscores count as word characters for \b, so "pipglyph_pro_monthly"
  // would never match — normalise every separator to a space first.
  const text = label.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\bpro\b/.test(text)) return "pro";
  if (/\bplus\b/.test(text)) return "plus";
  return null;
}

function tierFromMetadata(
  metadata: Record<string, string> | null | undefined,
): PaidTier | null {
  const raw = (metadata?.tier ?? metadata?.plan ?? metadata?.pipglyph_tier ?? "")
    .trim()
    .toLowerCase();
  return raw === "pro" || raw === "plus" ? raw : null;
}

/** Match a recurring amount (in the currency's minor unit) against the plan
 *  catalog: monthly priceUsd × 100, annual annualUsd × 100. */
export function tierForAmount(
  unitAmount: number | null | undefined,
  interval: string | null | undefined,
): PaidTier | null {
  if (unitAmount == null || !interval) return null;
  for (const plan of PLANS) {
    if (plan.tier === "free") continue;
    const expected =
      interval === "month"
        ? Math.round(plan.priceUsd * 100)
        : interval === "year" && plan.annualUsd != null
          ? Math.round(plan.annualUsd * 100)
          : null;
    if (expected != null && expected === unitAmount) return plan.tier as PaidTier;
  }
  return null;
}

/**
 * Resolve the tier a Stripe price sells. Order: configured env id →
 * price metadata (`tier`/`plan`) → lookup key / nickname → expanded product
 * metadata or name → recurring amount vs the plan catalog. Null when nothing
 * matches — callers decide what that means (the sync layer never demotes an
 * active subscriber on null).
 */
export function tierForPrice(price: PriceLike | null | undefined): PlanTier | null {
  if (!price) return null;
  const byId = tierForPriceId(price.id ?? null);
  if (byId) return byId;
  const byMeta = tierFromMetadata(price.metadata);
  if (byMeta) return byMeta;
  const byLabel =
    tierFromLabel(price.lookup_key) ?? tierFromLabel(price.nickname);
  if (byLabel) return byLabel;
  const product = typeof price.product === "object" ? price.product : null;
  if (product && product.deleted !== true) {
    const byProduct =
      tierFromMetadata(product.metadata) ?? tierFromLabel(product.name);
    if (byProduct) return byProduct;
  }
  return tierForAmount(price.unit_amount, price.recurring?.interval);
}

/** Resolve a tier from a product alone (used after a lazy product fetch). */
export function tierForProduct(product: ProductLike | null | undefined): PlanTier | null {
  if (!product || product.deleted === true) return null;
  return tierFromMetadata(product.metadata) ?? tierFromLabel(product.name);
}
