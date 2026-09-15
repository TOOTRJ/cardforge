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

/** Tier ordering — the single rank table entitlements (requireTier) and the
 *  Stripe sync layer (primary-subscription choice) both read. */
export const TIER_RANK: Record<PlanTier, number> = { free: 0, plus: 1, pro: 2 };
export type PaidTier = "plus" | "pro";
export type PackKey = "small" | "large";
export type BillingPeriod = "monthly" | "annual";

// Free trial on paid subscriptions: full access for a week, no card required
// (checkout collects payment `if_required`; a trial with no payment method
// cancels at day 7). One trial per account — enforced at checkout by the
// customer's Stripe subscription history.
export const TRIAL_DAYS = 7;

// Monthly credit allotment per tier — EVERY tier refills monthly via the
// daily cron (Free included, owner decision 2026-09-15; Plus/Pro also on
// the subscription webhook). A new account starts with Free's allotment via
// the profiles.credits default.
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
// Pro-only teasers (owner, 2026-09-15): the deck-building layer on top of
// today's deck-aware card design — still a tease, never sold as live.
const PRO_COMING_SOON = [
  ...PAID_COMING_SOON,
  "Smart AI deck building with AI deck intelligence",
];

export const PLANS: PlanDisplay[] = [
  {
    tier: "free",
    name: "Free",
    priceUsd: 0,
    tagline: "Design and share custom cards, forever free.",
    features: [
      "5 AI credits every month — every AI tool included",
      "Every MTG-style frame & finish",
      "Low-res PNG export (watermarked)",
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
      "Watermark-free downloads",
      "High-resolution (1500×2100) PNG",
      "Print-ready PDF export",
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
    // Every AI tool is open to every tier and credits are the limiter; the
    // ONLY tier-gated AI features are the deck-aware ones (owner decision,
    // 2026-09-15). Never list perks that aren't shipped (the old "priority
    // AI queue" line had no implementation behind it).
    features: [
      "75 AI credits every month — enough for whole decks",
      "AI cards & ideas designed for a specific deck",
      "Batch & whole-deck export, 3×3 print sheets",
      "Unlimited saved cards",
      "Everything in Plus",
    ],
    comingSoon: PRO_COMING_SOON,
  },
];

export function planForTier(tier: PlanTier): PlanDisplay {
  return PLANS.find((p) => p.tier === tier) ?? PLANS[0];
}

/** True for the "unlimited" sentinel that admin/billing-off entitlements
 *  carry (Number.MAX_SAFE_INTEGER). */
export function isUnlimitedCredits(credits: number): boolean {
  return credits >= Number.MAX_SAFE_INTEGER;
}

/** Human display for a credit balance — the unlimited sentinel must never
 *  render raw (an admin's header chip once read 9007199254740991). */
export function formatCredits(credits: number): string {
  return isUnlimitedCredits(credits) ? "∞" : String(credits);
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

/** Idempotency key for the mid-month top-up when a user upgrades tiers after
 *  this month's refill already granted. Keyed per TIER so a re-upgrade in the
 *  same month (plus → pro → plus → pro) can never double-grant the delta. */
export function creditUpgradeKey(
  userId: string,
  period: string,
  tier: PlanTier,
): string {
  return `refill:${userId}:${period}:upgrade:${tier}`;
}
