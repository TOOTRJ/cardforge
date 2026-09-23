import "server-only";

import { getStripe, isStripeConfigured } from "@/lib/stripe/client";

// ---------------------------------------------------------------------------
// What the billing page shows from Stripe itself — the bits the profile row
// does not carry: price + interval, trial end, the card on file, recent
// invoices. Read-only, best effort (null when Stripe isn't configured, the
// user has no customer, or Stripe is unreachable — the page then falls back
// to the profile's tier/status). Structural input types so unit tests can
// feed plain objects and the SDK's evolving types never leak into the UI.
// ---------------------------------------------------------------------------

export type PaymentMethodSummary = {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type InvoiceSummary = {
  id: string;
  number: string | null;
  status: string | null;
  /** Amount paid (or due when unpaid), in the currency's minor unit. */
  amountCents: number;
  currency: string;
  /** ISO timestamp. */
  created: string;
  hostedUrl: string | null;
};

export type SubscriptionSummary = {
  status: string;
  interval: "month" | "year" | null;
  /** Recurring amount in the currency's minor unit (null when unknown). */
  amountCents: number | null;
  currency: string;
  /** ISO timestamps. */
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export type StripeBillingDetails = {
  subscription: SubscriptionSummary | null;
  paymentMethod: PaymentMethodSummary | null;
  invoices: InvoiceSummary[];
};

type PaymentMethodLike = {
  card?: { brand?: string | null; last4?: string | null; exp_month?: number | null; exp_year?: number | null } | null;
} | null;

export type CustomerLike = {
  deleted?: unknown;
  invoice_settings?: { default_payment_method?: string | PaymentMethodLike | null } | null;
};

export type SubscriptionDetailsLike = {
  status: string;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  default_payment_method?: string | PaymentMethodLike | null;
  items: {
    data: Array<{
      current_period_end?: number | null;
      price?: {
        unit_amount?: number | null;
        currency?: string | null;
        recurring?: { interval?: string | null } | null;
      } | null;
    }>;
  };
};

export type InvoiceLike = {
  id: string;
  number?: string | null;
  status?: string | null;
  amount_paid?: number | null;
  amount_due?: number | null;
  currency?: string | null;
  created: number;
  hosted_invoice_url?: string | null;
};

function iso(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;
}

function paymentMethodSummary(pm: string | PaymentMethodLike | null | undefined): PaymentMethodSummary | null {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  const { brand, last4, exp_month, exp_year } = pm.card;
  if (!last4) return null;
  return {
    brand: brand ?? "card",
    last4,
    expMonth: exp_month ?? 0,
    expYear: exp_year ?? 0,
  };
}

/** Pure: shape Stripe's objects into what the page renders. */
export function summarizeBillingDetails(input: {
  customer: CustomerLike | null;
  subscription: SubscriptionDetailsLike | null;
  invoices: InvoiceLike[];
}): StripeBillingDetails {
  const sub = input.subscription;
  const item = sub?.items?.data?.[0];
  const interval = item?.price?.recurring?.interval;
  const subscription: SubscriptionSummary | null = sub
    ? {
        status: sub.status,
        interval: interval === "month" || interval === "year" ? interval : null,
        amountCents: typeof item?.price?.unit_amount === "number" ? item.price.unit_amount : null,
        currency: item?.price?.currency ?? "usd",
        currentPeriodEnd: iso(item?.current_period_end),
        trialEnd: iso(sub.trial_end),
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      }
    : null;

  // The subscription's own payment method wins; the customer's default is
  // the fallback (Checkout stores it there for a no-card trial that later
  // adds a card in the portal).
  const paymentMethod =
    paymentMethodSummary(sub?.default_payment_method) ??
    (input.customer && input.customer.deleted !== true
      ? paymentMethodSummary(input.customer.invoice_settings?.default_payment_method)
      : null);

  const invoices = input.invoices
    .filter((invoice) => invoice.status !== "draft")
    .map((invoice) => ({
      id: invoice.id,
      number: invoice.number ?? null,
      status: invoice.status ?? null,
      amountCents:
        invoice.status === "paid"
          ? (invoice.amount_paid ?? 0)
          : (invoice.amount_due ?? invoice.amount_paid ?? 0),
      currency: invoice.currency ?? "usd",
      created: new Date(invoice.created * 1000).toISOString(),
      hostedUrl: invoice.hosted_invoice_url ?? null,
    }));

  return { subscription, paymentMethod, invoices };
}

/** Live read for the billing page. Never throws. */
export async function getStripeBillingDetails(
  customerId: string | null | undefined,
  subscriptionId: string | null | undefined,
): Promise<StripeBillingDetails | null> {
  if (!isStripeConfigured() || !customerId) return null;
  try {
    const stripe = getStripe();
    const [customer, subscription, invoices] = await Promise.all([
      stripe.customers.retrieve(customerId, {
        expand: ["invoice_settings.default_payment_method"],
      }),
      subscriptionId
        ? stripe.subscriptions
            .retrieve(subscriptionId, { expand: ["default_payment_method"] })
            .catch(() => null)
        : Promise.resolve(null),
      stripe.invoices.list({ customer: customerId, limit: 6 }),
    ]);
    return summarizeBillingDetails({
      customer: customer as unknown as CustomerLike,
      subscription: subscription as unknown as SubscriptionDetailsLike | null,
      invoices: invoices.data as unknown as InvoiceLike[],
    });
  } catch {
    return null;
  }
}

/** "$6.00" — minor units → a display string. */
export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
