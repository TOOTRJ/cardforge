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

// Free trial on paid subscriptions: full access for a week, no card required
// (checkout collects payment `if_required`; a trial with no payment method
// cancels at day 7). One trial per account — enforced at checkout by the
// customer's Stripe subscription history.
export const TRIAL_DAYS = 7;

// Monthly credit allotment per tier. Free is the one-time signup grant (no auto
// refill yet); Plus/Pro are granted each billing cycle on Stripe `invoice.paid`.
// Sized so even a max-usage subscriber keeps AI cost (~$0.11 per generation,
// measured) under ~40% of net revenue. Tune in tandem with prices below.
export const MONTHLY_CREDITS: Record<PlanTier, number> = {
  free: 5,
  plus: 30,
  pro: 75,
};

// Consumable top-up packs (one-time Stripe `payment` checkout). Purchased
// credits never expire (unlike monthly allotment).
export const CREDIT_PACKS: Record<
  PackKey,
  { credits: number; priceUsd: number; label: string }
> = {
  small: { credits: 30, priceUsd: 8, label: "30 credits" },
  large: { credits: 100, priceUsd: 24, label: "100 credits" },
};

export type PlanDisplay = {
  tier: PlanTier;
  name: string;
  priceUsd: number; // monthly
  /** Total annual price (billed yearly). "2 months free" = monthly × 10. */
  annualUsd?: number;
  tagline: string;
  features: string[];
  /** Teased-but-not-shipped perks, rendered under a "Coming soon!" heading —
   *  never sell these as live. */
  comingSoon?: string[];
  /** Visually emphasized + steered-to "most popular" tier. */
  featured?: boolean;
};

// Perks in development that paid tiers will get at no extra cost. Shared by
// both paid tiers so the storefront can't drift.
const PAID_COMING_SOON = [
  "Premium custom frames",
  "Card printing",
  "Custom sets",
];

export const PLANS: PlanDisplay[] = [
  {
    tier: "free",
    name: "Free",
    priceUsd: 0,
    tagline: "Design and share custom cards, forever free.",
    features: [
      "5 AI generation credits to start",
      "Every MTG-style frame & finish",
      "PNG export (watermarked)",
      "Up to 50 saved cards",
      "Community gallery, decks & sharing",
    ],
  },
  {
    tier: "plus",
    name: "Plus",
    priceUsd: 6,
    annualUsd: 60,
    tagline: "For regular creators who want clean, hi-res cards.",
    featured: true,
    features: [
      "30 AI credits every month",
      "Watermark-free exports",
      "High-resolution (1500×2100) downloads",
      "Up to 500 saved cards",
      "Everything in Free",
    ],
    comingSoon: PAID_COMING_SOON,
  },
  {
    tier: "pro",
    name: "Pro",
    priceUsd: 15,
    annualUsd: 150,
    tagline: "For power users building whole decks with AI.",
    features: [
      "75 AI credits every month",
      "AI “generate a whole deck”",
      "Batch & whole-deck export",
      "Unlimited saved cards",
      "Priority AI queue",
      "Everything in Plus",
    ],
    comingSoon: PAID_COMING_SOON,
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
