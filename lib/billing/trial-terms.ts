import { type BillingPeriod, type PaidTier, planForTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// The trial terms Checkout shows under its button (`custom_text.submit`, set
// by createCheckoutSessionAction): when the free period ends, what is charged
// from then, how to cancel — the card networks' required notice
// (docs/BILLING.md §9). Its own module: lib/stripe/actions.ts is "use server",
// where every export must be an async server action.
// ---------------------------------------------------------------------------

/** UTC date, labelled as such — the one date every viewer reads the same. */
export function trialTermsLine(tier: PaidTier, period: BillingPeriod, endsAtSec: number, complimentary: boolean): string {
  const plan = planForTier(tier);
  const price = period === "annual" ? `$${plan.annualUsd ?? plan.priceUsd * 12} a year` : `$${plan.priceUsd} a month`;
  const ends = new Date(endsAtSec * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const what = complimentary ? "Your complimentary period" : "Your free trial";
  return `${what} ends on ${ends} (UTC). From then, ${plan.name} is ${price}, charged to this card until you cancel. Cancel any time before then on your billing page and nothing is charged.`;
}

