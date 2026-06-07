// Client-safe billing catalog — plan display + credit amounts. NO secrets, NO
// env access, so this is importable from both server and client components
// (the pricing page, the upgrade modal, the settings billing panel).
//
// IP posture: the paid value is OUR technology (AI credits, watermark-free
// hi-res exports, original frames, capacity) — never WotC trade dress. Every
// MTG-style frame stays available on the Free tier.
//
// Stripe price IDs live server-side in lib/stripe/config.ts (env-driven). The
// UI refers to plans/packs by these stable keys, never by raw price id.

export type PlanTier = "free" | "plus" | "pro";
export type PaidTier = "plus" | "pro";
export type PackKey = "small" | "large";
export type BillingPeriod = "monthly" | "annual";

// 1 credit = 1 AI generation (a card concept or a piece of card art).
export const CREDIT_UNIT = "AI generation";

// Monthly credit allotment per tier. Free is the one-time signup grant (no auto
// refill yet); Plus/Pro are granted each billing cycle on Stripe `invoice.paid`.
export const MONTHLY_CREDITS: Record<PlanTier, number> = {
  free: 25,
  plus: 200,
  pro: 1000,
};

// Consumable top-up packs (one-time Stripe `payment` checkout). Purchased
// credits never expire (unlike monthly allotment).
export const CREDIT_PACKS: Record<
  PackKey,
  { credits: number; priceUsd: number; label: string }
> = {
  small: { credits: 100, priceUsd: 5, label: "100 credits" },
  large: { credits: 500, priceUsd: 20, label: "500 credits" },
};

export type PlanDisplay = {
  tier: PlanTier;
  name: string;
  priceUsd: number; // monthly
  /** Total annual price (billed yearly). "2 months free" = monthly × 10. */
  annualUsd?: number;
  tagline: string;
  features: string[];
  /** Visually emphasized + steered-to "most popular" tier. */
  featured?: boolean;
};

export const PLANS: PlanDisplay[] = [
  {
    tier: "free",
    name: "Free",
    priceUsd: 0,
    tagline: "Design and share custom cards, forever free.",
    features: [
      "25 AI generation credits to start",
      "Every MTG-style frame & finish",
      "PNG export (watermarked)",
      "Up to 50 saved cards",
      "Community gallery, sets & sharing",
    ],
  },
  {
    tier: "plus",
    name: "Plus",
    priceUsd: 9,
    annualUsd: 90,
    tagline: "For regular creators who want clean, hi-res cards.",
    featured: true,
    features: [
      "200 AI credits every month",
      "Watermark-free exports",
      "High-resolution (1500×2100) downloads",
      "Original premium frames & finishes",
      "Up to 500 saved cards",
      "Everything in Free",
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    priceUsd: 19,
    annualUsd: 190,
    tagline: "For power users building whole sets with AI.",
    features: [
      "1,000 AI credits every month",
      "AI “generate a whole set”",
      "Batch & whole-set export",
      "Unlimited saved cards",
      "Priority AI queue",
      "Everything in Plus",
    ],
  },
];

export function planForTier(tier: PlanTier): PlanDisplay {
  return PLANS.find((p) => p.tier === tier) ?? PLANS[0];
}

// ---------------------------------------------------------------------------
// Monthly credit refills (cron-driven, so monthly AND annual plans both get a
// monthly allotment). Refills are idempotent per user per calendar month via a
// synthetic key stored in credit_ledger.idempotency_key.
// ---------------------------------------------------------------------------

/** Calendar-month key, e.g. "2026-06" (UTC). */
export function currentCreditPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Idempotency key for a user's monthly subscription refill. */
export function creditRefillKey(userId: string, period: string): string {
  return `refill:${userId}:${period}`;
}
