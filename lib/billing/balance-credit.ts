import type Stripe from "stripe";
import { planForTier, type PlanTier } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Stripe CUSTOMER-BALANCE credits — the one way PipGlyph gives a PAYING user
// free time without touching their subscription's status, dates or trial
// (docs/BILLING.md "Comps and a live subscription"). A credit is a NEGATIVE
// balance transaction: Stripe takes it off the customer's next invoices by
// itself, before the card is charged. A claw-back is a POSITIVE one.
//
// Shared by the admin comp on an active plan (lib/billing/comp-stripe-apply.ts)
// and the referral programme's free month for a payer (lib/referrals/*, the
// stacked PR): both price their time from the subscription's OWN price, so an
// annual payer is credited a share of the year, never a monthly list price.
// ---------------------------------------------------------------------------

export type RecurringPriceLike =
  | {
      unit_amount?: number | null;
      currency?: string | null;
      recurring?: { interval?: string | null; interval_count?: number | null } | null;
    }
  | null
  | undefined;

const DAY_MS = 86_400_000;

/** The subscription's price for ONE YEAR in cents, unrounded: a monthly price
 *  × 12, a yearly one as it is (÷ its interval count). The plan's monthly list
 *  price × 12 when Stripe's price can't be read. */
export function yearlyCentsOf(price: RecurringPriceLike, tier: PlanTier): number {
  const unit = price?.unit_amount;
  const interval = price?.recurring?.interval;
  const count = Math.max(1, price?.recurring?.interval_count ?? 1);
  if (typeof unit === "number" && unit > 0) {
    if (interval === "year") return unit / count;
    if (interval === "month") return (unit * 12) / count;
    if (interval === "week") return (unit * 52) / count;
    if (interval === "day") return (unit * 365) / count;
  }
  return planForTier(tier).priceUsd * 100 * 12;
}

/** One month of the subscription in cents: the monthly price, or a twelfth
 *  of a yearly one (rounded) — the referral programme's "one free month". */
export function oneMonthCents(price: RecurringPriceLike, tier: PlanTier): number {
  return Math.round(yearlyCentsOf(price, tier) / 12);
}

/** `ms` moved `n` calendar months on (UTC), the day clamped to the month's
 *  last (Jan 31 + 1 month = Feb 28/29). */
function addMonthsUtc(ms: number, n: number): number {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

/**
 * How long a period is, in WHOLE calendar months plus the days left over:
 * a period that ends less than a day short of a whole month (an admin's picker
 * lands at midnight, not at the second the comp was saved) counts as that
 * whole month; the rest is whole days, rounded to the nearest.
 */
export function periodMonthsAndDays(startSec: number, endSec: number): { months: number; days: number } {
  const start = startSec * 1000;
  const end = endSec * 1000;
  if (!(end > start)) return { months: 0, days: 0 };
  let months = 0;
  while (addMonthsUtc(start, months + 1) < end + DAY_MS) months += 1;
  const anchor = addMonthsUtc(start, months);
  const days = Math.max(0, Math.round((end - anchor) / DAY_MS));
  return { months, days };
}

/**
 * The credit that makes a period FREE on a subscription (cents, rounded once):
 *
 *   yearly price × (whole months ÷ 12 + leftover days ÷ 365)
 *
 * so a whole-month comp on a monthly plan is exactly price × months, a
 * whole-month comp on an annual plan is the year's price ÷ 12 × months, and
 * anything else is prorated per day on the year's price (÷ 365).
 */
export function periodCreditCents(input: {
  price: RecurringPriceLike;
  tier: PlanTier;
  startSec: number;
  endSec: number;
}): number {
  const { months, days } = periodMonthsAndDays(input.startSec, input.endSec);
  const yearly = yearlyCentsOf(input.price, input.tier);
  return Math.max(0, Math.round(yearly * (months / 12 + days / 365)));
}

/** Put `cents` of CREDIT on the customer's balance (a negative transaction).
 *  `idempotencyKey` is required: a retried call must never credit twice. */
export async function creditCustomerBalance(
  stripe: Stripe,
  input: {
    customerId: string;
    cents: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  },
): Promise<Stripe.CustomerBalanceTransaction> {
  if (!(input.cents > 0)) throw new Error("creditCustomerBalance: amount must be positive");
  return stripe.customers.createBalanceTransaction(
    input.customerId,
    {
      amount: -Math.round(input.cents),
      currency: input.currency,
      description: input.description,
      metadata: input.metadata,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}

/** Take `cents` of credit BACK (a positive transaction). The caller caps it
 *  at what is still unspent (`unspentCreditCents`): a claw-back never leaves
 *  the customer owing money for credit an invoice already used. */
export async function clawBackCustomerBalance(
  stripe: Stripe,
  input: {
    customerId: string;
    cents: number;
    currency: string;
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  },
): Promise<Stripe.CustomerBalanceTransaction> {
  if (!(input.cents > 0)) throw new Error("clawBackCustomerBalance: amount must be positive");
  return stripe.customers.createBalanceTransaction(
    input.customerId,
    {
      amount: Math.round(input.cents),
      currency: input.currency,
      description: input.description,
      metadata: input.metadata,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}

/** The credit still on the customer's balance (cents ≥ 0): Stripe's
 *  `balance` is negative while the customer is in credit. */
export function unspentCreditCents(customer: { balance?: number | null } | null | undefined): number {
  const balance = customer?.balance ?? 0;
  return balance < 0 ? -balance : 0;
}

/**
 * The NET credit already posted under one ledger key (cents; credits minus
 * claw-backs): the sum of the customer's balance transactions whose
 * `metadata[metadataKey]` equals `value`, negated. Stripe is the ledger —
 * a re-save reads it and posts only the difference.
 */
export async function netCreditPosted(
  stripe: Stripe,
  customerId: string,
  metadataKey: string,
  value: string,
): Promise<number> {
  let net = 0;
  let startingAfter: string | undefined;
  // 10 pages of 100 — a customer's whole balance history, many times over.
  for (let page = 0; page < 10; page += 1) {
    const list = await stripe.customers.listBalanceTransactions(customerId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const txn of list.data) {
      if (txn.metadata?.[metadataKey] === value) net -= txn.amount;
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return net;
}
