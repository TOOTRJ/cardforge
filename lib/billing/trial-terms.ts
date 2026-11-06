import { type BillingPeriod, type PaidTier, planForTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// The trial terms Checkout shows under its button (`custom_text.submit`, set
// by createCheckoutSessionAction): when the free period ends, what is charged
// from then, how to cancel — the card networks' required notice
// (docs/BILLING.md §9). Its own module: lib/stripe/actions.ts is "use server",
// where every export must be an async server action.
// ---------------------------------------------------------------------------

/**
 * The LENGTH of the free period, never its date: Checkout's own order
 * summary already prints the first charge's date in the buyer's time zone
 * ("Then $15.00 per month starting November 12"), and a UTC date of ours
 * beside it read as the next day on an evening checkout — two dates for one
 * moment (preview pass 2026-11-06). The line points at that date.
 */
export function trialTermsLine(tier: PaidTier, period: BillingPeriod, freeSeconds: number, complimentary: boolean): string {
  const plan = planForTier(tier);
  const price = period === "annual" ? `$${plan.annualUsd ?? plan.priceUsd * 12} a year` : `$${plan.priceUsd} a month`;
  const days = Math.max(1, Math.round(freeSeconds / 86_400));
  const length = `${days} day${days === 1 ? "" : "s"}`;
  const what = complimentary ? `Your complimentary period lasts ${length}` : `Your free trial lasts ${length}`;
  return `${what} and ends on the date in the order summary. From then, ${plan.name} is ${price}, charged to this card until you cancel. Cancel any time before then on your billing page and nothing is charged.`;
}

