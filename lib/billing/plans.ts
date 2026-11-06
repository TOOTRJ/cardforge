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

/** Decks are unlimited on every plan — public, unlisted or private. Owner
 *  decision 2026-10-29, after migration 0145 shipped a private-deck cap and
 *  0147 dropped it: "there is not going to be a deck cap because that is
 *  what other sites do. Where paid conversion happens is with card limits."
 *  Never bring a deck cap back without the owner. The plan cards say it
 *  once, on Free ("Everything in Free" carries it up). */
export const UNLIMITED_DECKS_LINE = "Unlimited decks — public, unlisted or private";

// ---------------------------------------------------------------------------
// Saved-card capacity is THE paid benefit (owner finding 2026-11-06: users
// convert to save more cards, not for the AI —
// docs/research/card-capacity-conversion-2026-11.md). Every surface that
// names a paid plan leads with it, in words built here from CARD_CAPACITY —
// never a literal number in a component, so a cap that changes in this
// table (and in migration 0104) can't leave a page quoting the old one.
// THE RULE, in the owner's words (2026-11-06): "while a Plus or Pro plan is
// active the user's account has full access to the plan's card limit" —
// the cap is the plan's for as long as the plan runs, never a permanent
// promise. The cap is SOFT: nothing is ever deleted; when a plan ends the
// cards stay (viewable, editable, downloadable) and saving a NEW one needs
// room under the current plan's cap (the Evernote / Trello rule, never
// Dropbox's deletion clause) — the copy says both.
// ---------------------------------------------------------------------------

/** A cap as words: "50", "500" or "unlimited". */
export function capacityWord(tier: PlanTier): string {
  const cap = CARD_CAPACITY[tier];
  return cap === CARD_CAPACITY_UNLIMITED ? "unlimited" : cap.toLocaleString("en-US");
}

/** The tier that lifts a tier's cap — Free → Plus, Plus → Pro, Pro none. */
export function nextCapacityTier(tier: PlanTier): PaidTier | null {
  if (tier === "free") return "plus";
  if (tier === "plus") return "pro";
  return null;
}

const TIER_LABEL: Record<PlanTier, string> = { free: "Free", plus: "Plus", pro: "Pro" };

/** The rule as a clause, for a paid tier: "while Plus is active you have its
 *  full limit of 500 saved cards" / "while Pro is active there is no limit". */
export function planLimitClause(tier: PaidTier): string {
  const cap = CARD_CAPACITY[tier];
  return cap === CARD_CAPACITY_UNLIMITED
    ? `while ${TIER_LABEL[tier]} is active there is no limit`
    : `while ${TIER_LABEL[tier]} is active you have its full limit of ${cap.toLocaleString("en-US")} saved cards`;
}

/** "Up to 50 saved cards" / "Up to 500 saved cards while Plus is active" /
 *  "Unlimited saved cards while Pro is active": a plan's FIRST feature
 *  line, from CARD_CAPACITY (the plan cards, the home page's plan tiles,
 *  the Settings summary). */
export function savedCardsLine(tier: PlanTier): string {
  const cap = CARD_CAPACITY[tier];
  const line = cap === CARD_CAPACITY_UNLIMITED ? "Unlimited saved cards" : `Up to ${cap.toLocaleString("en-US")} saved cards`;
  return tier === "free" ? line : `${line} while ${TIER_LABEL[tier]} is active`;
}

/** The pricing page's capacity line, the rule in the owner's words: "While
 *  a Plus or Pro plan is active, your account has the plan's full card
 *  limit: Plus holds 500 saved cards, Pro holds them all. Free holds 50." */
export function capacityHoldsLine(): string {
  return `While a Plus or Pro plan is active, your account has the plan's full card limit: Plus holds ${capacityWord("plus")} saved cards, Pro holds them all. Free holds ${capacityWord("free")}.`;
}

/** The numbers alone, for an eyebrow: "Free holds 50 cards · Plus 500 ·
 *  Pro unlimited". */
export function capacityFactsLine(): string {
  return `Free holds ${capacityWord("free")} cards · Plus ${capacityWord("plus")} · Pro ${capacityWord("pro")}`;
}

/** The one-sentence pitch the billing page uses: "Your plan's full card
 *  limit while it's active — up to 500 saved cards on Plus, unlimited on
 *  Pro." */
export function capacityPitch(): string {
  return `Your plan's full card limit while it's active — up to ${capacityWord("plus")} saved cards on Plus, unlimited on Pro.`;
}

/** The soft-cap fact, said wherever a limit is named. */
export const CARDS_ARE_SAFE =
  "Nothing is ever deleted: when a plan ends your cards stay — viewable, editable, downloadable — and saving a new one needs room under your current plan's cap.";

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
/** The days every new account banks at signup (migration 0179,
 *  lib/billing/day-bank.ts): the first checkout's free period. Client-safe. */
export const SIGNUP_BANK_DAYS = 7;
/** The legacy name of the same number (the "7-day trial" before the bank). */
export const TRIAL_DAYS = SIGNUP_BANK_DAYS;

/** The credits a FREE PERIOD brings, once per account (owner 2026-11-06):
 *  the first checkout's banked days, or the first "Apply banked days"
 *  (lib/billing/credit-refill.ts `grantFreePeriodCredits`). The old trial
 *  tranche was 25. */
export const FREE_PERIOD_CREDITS = 10;

/** A trial that ends without converting gets one win-back offer: this much
 *  off the first month, applied automatically by the checkout action within
 *  the window (the `trial_lapsed` notification is the eligibility record).
 *  Coupon `TRIAL_WINBACK_COUPON_ID` exists with the same id on live and
 *  sandbox, `duration: once`, restricted to the Plus/Pro products. */
export const TRIAL_WINBACK_DISCOUNT_PCT = 20;
export const TRIAL_WINBACK_COUPON_ID = "TRIAL_WINBACK_20";
export const TRIAL_WINBACK_WINDOW_DAYS = 30;

// PLAN CREDITS ARE ONE-TIME (owner decision 2026-11-06, replacing the monthly
// allotment of 30 / 100): a tier's stock lands ONCE per account with the
// FIRST PAID invoice of a plan on that tier (lib/billing/credit-refill.ts
// `grantPlanCreditsOnce`; Pro after Plus grants the difference). Nothing
// refills — not monthly, not yearly; packs are the way to more. FREE gets
// SIGNUP_CREDITS once (the profiles.credits default). Every surface says
// "with your first payment" / "to start", never "a month".
export const PLAN_CREDITS_ONCE: Record<PaidTier, number> = {
  plus: 60,
  pro: 120,
};

/** The one-time plan credits of a tier, 0 for free. */
export function planCreditsOnceFor(tier: PlanTier): number {
  return tier === "plus" || tier === "pro" ? PLAN_CREDITS_ONCE[tier] : 0;
}

/** Credits every new account starts with — the `profiles.credits` column
 *  default (migration 0027; the signup trigger writes the matching ledger
 *  row). Change the two together. */
export const SIGNUP_CREDITS = 5;

// Consumable top-up packs (one-time Stripe `payment` checkout). Purchased
// credits never expire. Keys double as
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
    // Capacity FIRST on every plan (owner 2026-11-06): it is the one line
    // people pay for, and plan-capacity-headline.test.ts holds the order.
    features: [
      savedCardsLine("free"),
      `${SIGNUP_CREDITS} AI credits to start — packs add more, and never expire`,
      "Every MTG-style frame currently available on PipGlyph",
      "Low-res PNG export (watermarked)",
      UNLIMITED_DECKS_LINE,
      "Community gallery & sharing",
    ],
  },
  {
    tier: "plus",
    name: "Plus",
    priceUsd: 6,
    annualUsd: 60,
    tagline: `Room for ${capacityWord("plus")} cards, downloaded clean and hi-res.`,
    featured: true,
    features: [
      savedCardsLine("plus"),
      `${PLAN_CREDITS_ONCE.plus} AI credits with your first payment`,
      ...PLUS_PRINT_PERKS,
      "Everything in Free",
    ],
    comingSoon: PAID_COMING_SOON,
  },
  {
    tier: "pro",
    name: "Pro",
    priceUsd: 15,
    annualUsd: 150,
    tagline: "Unlimited cards, print sheets and deck-aware AI.",
    // Every AI tool is open to every tier and credits are the limiter; the
    // ONLY tier-gated AI features are the deck-aware ones (owner decision,
    // 2026-09-15). Never list perks that aren't shipped (the old "priority
    // AI queue" line had no implementation behind it) — nor ones that are
    // paused: AI deck building is (TODO DK1, lib/ai/deck-ai-pause.ts), so the
    // tagline and the credits line no longer sell a whole AI deck.
    features: [
      savedCardsLine("pro"),
      `${PLAN_CREDITS_ONCE.pro} AI credits with your first payment`,
      "AI cards & ideas designed for a specific deck",
      ...PRO_PRINT_PERKS,
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
/** "Running low": ≤ LOW_CREDITS_PAID on a paid plan, ≤ LOW_CREDITS_FREE on
 *  free (a free account's 5 starter credits would read "low" from the start
 *  at 3). Fixed numbers since credits are one-time (owner 2026-11-06). */
export const LOW_CREDITS_PAID = 3;
export const LOW_CREDITS_FREE = 1;
export function isLowCredits(balance: number, isPaid: boolean): boolean {
  if (isUnlimitedCredits(balance)) return false;
  return balance <= (isPaid ? LOW_CREDITS_PAID : LOW_CREDITS_FREE);
}

/** The "unlimited" sentinel admin / billing-off entitlements carry
 *  (Number.MAX_SAFE_INTEGER). */
export function isUnlimitedCredits(credits: number): boolean {
  return credits >= Number.MAX_SAFE_INTEGER;
}

/** Human display for a credit balance — the unlimited sentinel must never
 *  render raw (an admin's header chip once read 9007199254740991). */
export function formatCredits(credits: number): string {
  return isUnlimitedCredits(credits) ? "∞" : String(credits);
}

// ---------------------------------------------------------------------------
// The calendar month, kept for the refill cron's run label and alert payload
// (`app/api/cron/refill-credits`). The monthly refill it once keyed
// (`refill:<user>:<period>`) ended 2026-11-06 — plan credits are one-time
// (lib/billing/credit-refill.ts); the ledger's older `refill:` rows stay.
// ---------------------------------------------------------------------------

/** Calendar-month key, e.g. "2026-06" (UTC). */
export function currentCreditPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}
