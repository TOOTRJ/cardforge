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

/** Saved-card capacity per tier; `CARD_CAPACITY_UNLIMITED` for no cap. The
 *  database enforces the same numbers (migration 0104, card_capacity_for) —
 *  change both together; tests/unit/billing/card-capacity.test.ts checks. */
export const CARD_CAPACITY_UNLIMITED = -1;
export const CARD_CAPACITY: Record<PlanTier, number> = {
  free: 50,
  plus: 500,
  pro: CARD_CAPACITY_UNLIMITED,
};

/** PRIVATE + UNLISTED decks per tier (owner decision D1, 2026-10-28) — public
 *  decks are unlimited on every plan; same unlimited sentinel as cards. The
 *  database enforces the same numbers (migration 0145, deck_capacity_for) —
 *  change both together; tests/unit/billing/deck-capacity.test.ts checks. */
export const DECK_CAPACITY: Record<PlanTier, number> = {
  free: 1,
  plus: 3,
  pro: CARD_CAPACITY_UNLIMITED,
};

/** The visibilities a deck cap counts; a public deck never does (D1). The
 *  trigger in 0145 names the same two. */
export const CAPPED_DECK_VISIBILITIES = ["private", "unlisted"] as const;

/** "Up to 50 saved cards" / "Unlimited saved cards" — a plan's card line,
 *  from CARD_CAPACITY (the plan cards, the billing page's free-plan copy). */
export function savedCardsLine(tier: PlanTier): string {
  const cap = CARD_CAPACITY[tier];
  return cap === CARD_CAPACITY_UNLIMITED ? "Unlimited saved cards" : `Up to ${cap.toLocaleString("en-US")} saved cards`;
}

/** "1 private or unlisted deck" / "3 private or unlisted decks" — the capped
 *  part of a plan's deck line, from DECK_CAPACITY. */
export function privateDecksPhrase(tier: PlanTier): string {
  const cap = DECK_CAPACITY[tier];
  if (cap === CARD_CAPACITY_UNLIMITED) return "unlimited private and unlisted decks";
  return `${cap} private or unlisted deck${cap === 1 ? "" : "s"}`;
}

/** "Free includes 1 private or unlisted deck, Plus 3, and Pro as many as you
 *  like." — every plan's cap in one sentence (the upgrade modal, the FAQ). */
export function privateDecksByPlanSentence(): string {
  const count = (tier: PlanTier) =>
    DECK_CAPACITY[tier] === CARD_CAPACITY_UNLIMITED ? "as many as you like" : String(DECK_CAPACITY[tier]);
  return `Free includes ${privateDecksPhrase("free")}, Plus ${count("plus")}, and Pro ${count("pro")}.`;
}

/** A plan's deck line: public decks are unlimited on every plan; the cap is
 *  on private and unlisted ones. */
export function decksLine(tier: PlanTier): string {
  return DECK_CAPACITY[tier] === CARD_CAPACITY_UNLIMITED
    ? "Unlimited decks — public, unlisted or private"
    : `Unlimited public decks, plus ${privateDecksPhrase(tier)}`;
}
export type PaidTier = "plus" | "pro";
export type PackKey = "mini" | "small" | "large";
export type BillingPeriod = "monthly" | "annual";

// Free trial on paid subscriptions: full access for a week. A CARD IS
// REQUIRED at checkout (owner decision 2026-09-24, reversing the no-card
// trial): Stripe charges the plan price when the trial ends unless the user
// cancels first — the trial-ending reminder (3 days out) is the card
// networks' notice. Card-required trials convert at 2–3× the no-card rate and
// stop throwaway accounts burning AI credits. Legacy no-card trials that
// still exist keep their own terms (cancel at day 7 without a card).
export const TRIAL_DAYS = 7;

/** Credits granted when a trial STARTS — a taste, not the full allotment.
 *  The plan's full monthly credits land with the first payment (the
 *  month-wide shortfall logic in credit-refill.ts tops this up). */
export const TRIAL_CREDITS = 25;

/** A trial that ends without converting gets one win-back offer: this much
 *  off the first month, applied automatically by the checkout action within
 *  the window (the `trial_lapsed` notification is the eligibility record).
 *  Coupon `TRIAL_WINBACK_COUPON_ID` exists with the same id on live and
 *  sandbox, `duration: once`, restricted to the Plus/Pro products. */
export const TRIAL_WINBACK_DISCOUNT_PCT = 20;
export const TRIAL_WINBACK_COUPON_ID = "TRIAL_WINBACK_20";
export const TRIAL_WINBACK_WINDOW_DAYS = 30;

// Monthly credit allotment per tier. Plus/Pro refill monthly (the daily cron
// + the subscription webhook). FREE DOES NOT REFILL (owner decision
// 2026-09-24, reversing 2026-09-15): a new account gets SIGNUP_CREDITS once,
// via the profiles.credits default, and after that only a pack or a plan adds
// credits — the out-of-credits moment is where the upgrade modal and packs
// sell, and with a monthly free refill it almost never happened (one account
// ever ran dry). Every surface that used to say "5 a month" now says "5 to
// start"; keep them in step with this table.
// Sized so even a max-usage subscriber keeps AI cost (~$0.11 per generation,
// measured) under ~40% of net revenue. Tune in tandem with prices below.
export const MONTHLY_CREDITS: Record<PlanTier, number> = {
  free: 0,
  plus: 30,
  pro: 100,
};

/** Credits every new account starts with — the `profiles.credits` column
 *  default (migration 0027; the signup trigger writes the matching ledger
 *  row). Change the two together. */
export const SIGNUP_CREDITS = 5;

// Consumable top-up packs (one-time Stripe `payment` checkout). Purchased
// credits never expire (unlike a plan's monthly allotment). Keys double as
// Stripe lookup keys (`pack_<key>`, lib/stripe/prices.ts) and product
// metadata (`pack: <key>`) on BOTH the live and sandbox catalogs.
export const CREDIT_PACKS: Record<
  PackKey,
  { credits: number; priceUsd: number; label: string }
> = {
  mini: { credits: 10, priceUsd: 4, label: "10 credits" },
  small: { credits: 30, priceUsd: 8, label: "30 credits" },
  large: { credits: 100, priceUsd: 24, label: "100 credits" },
};

/** Display order for pack grids: impulse → value. */
export const PACK_ORDER: PackKey[] = ["mini", "small", "large"];

/** Subscribers (an ACTIVE Plus/Pro subscription — not a no-card trial, not
 *  a comp) pay this much less for packs. The checkout action applies the
 *  Stripe coupon `PACK_SUBSCRIBER_COUPON_ID` (same id on live and sandbox,
 *  restricted to the pack products) server-side; the client only ever
 *  displays the discounted number. */
export const PACK_SUBSCRIBER_DISCOUNT_PCT = 20;
export const PACK_SUBSCRIBER_COUPON_ID = "SUBSCRIBER_PACKS_20";

/** A pack's price after the subscriber discount, in dollars (cents-exact). */
export function discountedPackPriceUsd(pack: PackKey): number {
  return Math.round(CREDIT_PACKS[pack].priceUsd * (100 - PACK_SUBSCRIBER_DISCOUNT_PCT)) / 100;
}

/** "$4" / "$6.40" — dollars → display. */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

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

/** Stripe subscription statuses that mean "the subscription still exists but
 *  its payment is broken": perks are off (entitlements treat them as free) and
 *  the fix is the billing portal — never a second subscription. Client-safe so
 *  /pricing can offer the right button. */
export const DELINQUENT_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "past_due",
  "unpaid",
  "incomplete",
]);

// ---------------------------------------------------------------------------
// The download and print perks AS BUILT (TODO 6.26) — the ONE source the
// plan cards (/pricing, /dashboard/billing) and the upgrade modal's export
// reasons say them from; the FAQ (lib/content/faq.ts, "Exports & printing")
// says the same in longer prose, and tests/unit/billing/print-perks-copy.test.ts
// holds every surface to PRINT_PERK_FACTS. Each line is a gate that exists:
//   Plus (a paid viewer — isPaid / removeWatermark / maxExportPreset "hd"):
//     the clean 1500 × 2100 PNG or JPEG (app/api/cards/[id]/png), the print
//     files — 800 ppi (PRINT_800_PPI_PAID_ONLY), the 1/8″ bleed and the
//     MakePlayingCards file (lib/cards/print-export.ts) — and the one-card
//     PDF at true size, with or without the bleed (app/api/cards/[id]/pdf).
//   Pro (allowBatchExport): sheets — a card's "Sheet of copies" (the pdf
//     route's sheet layouts), any cards picked in My Cards (POST
//     /api/cards/export) and a deck (app/api/decks/[id]/download) — on US
//     Letter or A4 with the shared options (components/cards/
//     print-sheet-options.tsx: gap, cut guides, 63 × 88 mm, the bleed), and
//     the ZIPs of card images (HD, standard, MakePlayingCards) with a deck's
//     report.
// Copy only: never a price, a limit or an entitlement.
// ---------------------------------------------------------------------------

/** Plus's download and print lines, as the plan card lists them. */
export const PLUS_PRINT_PERKS: readonly string[] = [
  "Watermark-free downloads — 1500 × 2100 PNG or JPEG",
  "Print files: 800 ppi, a 1/8″ bleed, or sized for MakePlayingCards",
  "Print-ready PDF of one card at true size, with or without the bleed",
];

/** Pro's, on top of Plus's. */
export const PRO_PRINT_PERKS: readonly string[] = [
  "Print sheets of any cards you pick — US Letter or A4, gaps, cut guides, 63 × 88 mm, bleed",
  "Whole-deck & batch export: print PDFs and image ZIPs (MakePlayingCards too)",
];

/** The same perks as the upgrade modal's sentences, per reason. */
export const PRINT_PERK_COPY = {
  /** Asked for a clean image (the download modal's "Remove the mark"). */
  clean:
    "Plus and Pro download every card without the PipGlyph mark: a 1500 × 2100 PNG or JPEG, and print files at 800 ppi, with a 1/8″ bleed or sized for MakePlayingCards. The free watermarked image is always available.",
  /** Asked for a PDF. */
  pdf: "A print-ready PDF of one card at true size (2.5″ × 3.5″), with or without a 1/8″ bleed and crop marks, is a Plus feature. Pro adds print sheets.",
  /** Asked for sheets or a selection export. */
  sheets:
    "Pro prints any cards you pick onto US Letter or A4 sheets — mixed, with your own copies, gaps, cut guides, 63 × 88 mm cards and the 1/8″ bleed — and exports a whole deck or selection as print PDFs and image ZIPs, MakePlayingCards files included.",
} as const;

/** The facts each tier's print copy states — every surface that sells the
 *  print features names each of them (the copy test). */
export const PRINT_PERK_FACTS: Record<PaidTier, readonly RegExp[]> = {
  plus: [/1500 × 2100/, /800 ppi/, /1\/8/, /MakePlayingCards/, /PDF/],
  pro: [/sheet/i, /Letter/, /A4/, /63 × 88 mm/, /cut/i, /ZIP/],
};

/** The coming-soon print-and-ship service (owner 2026-10-28): PipGlyph prints
 *  the cards and mails them. Worded so nobody takes it for the print EXPORTS
 *  above, which exist; never a date or a price. */
export const PRINTED_CARDS_COMING_SOON = "Printed cards, shipped to you";

// Perks in development that paid tiers will get at no extra cost. Shared by
// both paid tiers so the storefront can't drift.
const PAID_COMING_SOON = [
  "Premium custom frames",
  PRINTED_CARDS_COMING_SOON,
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
      "5 AI credits at sign-up (no monthly refill — packs and plans add more)",
      "Every MTG-style frame currently available on PipGlyph",
      "Low-res PNG export (watermarked)",
      savedCardsLine("free"),
      decksLine("free"),
      "Community gallery & sharing",
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
      ...PLUS_PRINT_PERKS,
      savedCardsLine("plus"),
      decksLine("plus"),
      "Everything in Free",
    ],
    comingSoon: PAID_COMING_SOON,
  },
  {
    tier: "pro",
    name: "Pro",
    priceUsd: 15,
    annualUsd: 150,
    tagline: "For power users who design for their decks and print them.",
    // Every AI tool is open to every tier and credits are the limiter; the
    // ONLY tier-gated AI features are the deck-aware ones (owner decision,
    // 2026-09-15). Never list perks that aren't shipped (the old "priority
    // AI queue" line had no implementation behind it) — nor ones that are
    // paused: AI deck building is (TODO DK1, lib/ai/deck-ai-pause.ts), so the
    // tagline and the credits line no longer sell a whole AI deck.
    features: [
      "100 AI credits every month",
      "AI cards & ideas designed for a specific deck",
      ...PRO_PRINT_PERKS,
      savedCardsLine("pro"),
      decksLine("pro"),
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
/** "Running low" = at or under a fifth of the plan's monthly allotment (min 1):
 *  Free (no refill) → ≤1, Plus 30 → ≤6, Pro 100 → ≤20. The old flat `≤ 5`
 *  equalled Free's then-monthly refill, so every free user saw the red
 *  warning permanently. */
const LOW_CREDIT_FRACTION = 0.2;
export function isLowCredits(balance: number, monthlyAllotment: number): boolean {
  if (isUnlimitedCredits(balance)) return false;
  return balance <= Math.max(1, Math.floor(monthlyAllotment * LOW_CREDIT_FRACTION));
}

function isUnlimitedCredits(credits: number): boolean {
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
