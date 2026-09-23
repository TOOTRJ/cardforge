import { describe, expect, it } from "vitest";
import { formatMoney, summarizeBillingDetails } from "@/lib/billing/subscription-details";

// ---------------------------------------------------------------------------
// The billing page's Stripe read, shaped from objects captured in the Stripe
// SANDBOX on 2026-09-22 (a paid Plus subscription and a no-card trial) — the
// exact field layout of the pinned API version (current_period_end lives on
// the subscription ITEM, invoices carry parent.subscription_details).
// ---------------------------------------------------------------------------

const paidSubscription = {
  status: "active",
  cancel_at_period_end: false,
  trial_end: null,
  default_payment_method: {
    card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2034 },
  },
  items: {
    data: [
      {
        current_period_end: 1792722400,
        price: { unit_amount: 600, currency: "usd", recurring: { interval: "month" } },
      },
    ],
  },
};

const trial = {
  status: "trialing",
  cancel_at_period_end: false,
  trial_end: 1790735200,
  default_payment_method: null,
  items: {
    data: [
      {
        current_period_end: 1790735200,
        price: { unit_amount: 600, currency: "usd", recurring: { interval: "month" } },
      },
    ],
  },
};

const paidInvoice = {
  id: "in_1",
  number: "VHMFQH7Y-0001",
  status: "paid",
  amount_paid: 600,
  amount_due: 600,
  currency: "usd",
  created: 1790130400,
  hosted_invoice_url: "https://invoice.stripe.com/i/x",
};

describe("summarizeBillingDetails", () => {
  it("reads price, interval, period end and the card from a paid subscription", () => {
    const details = summarizeBillingDetails({
      customer: { invoice_settings: { default_payment_method: null } },
      subscription: paidSubscription,
      invoices: [paidInvoice, { ...paidInvoice, id: "in_draft", status: "draft" }],
    });
    expect(details.subscription).toEqual({
      status: "active",
      interval: "month",
      amountCents: 600,
      currency: "usd",
      currentPeriodEnd: "2026-10-23T02:26:40.000Z",
      trialEnd: null,
      cancelAtPeriodEnd: false,
    });
    expect(details.paymentMethod).toEqual({ brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 });
    // Drafts are Stripe's in-progress objects, never something to show.
    expect(details.invoices.map((i) => i.id)).toEqual(["in_1"]);
    expect(details.invoices[0]).toMatchObject({
      number: "VHMFQH7Y-0001",
      status: "paid",
      amountCents: 600,
      hostedUrl: "https://invoice.stripe.com/i/x",
      created: "2026-09-23T02:26:40.000Z",
    });
  });

  it("a no-card trial: trial end set, no payment method, falls back to the customer's default card when one exists", () => {
    const noCard = summarizeBillingDetails({ customer: {}, subscription: trial, invoices: [] });
    expect(noCard.subscription?.trialEnd).toBe("2026-09-30T02:26:40.000Z");
    expect(noCard.paymentMethod).toBeNull();

    const cardAddedLater = summarizeBillingDetails({
      customer: {
        invoice_settings: {
          default_payment_method: { card: { brand: "mastercard", last4: "5100", exp_month: 1, exp_year: 2030 } },
        },
      },
      subscription: trial,
      invoices: [],
    });
    expect(cardAddedLater.paymentMethod?.last4).toBe("5100");
  });

  it("an unpaid invoice shows the amount due; a deleted customer contributes no card", () => {
    const details = summarizeBillingDetails({
      customer: { deleted: true, invoice_settings: { default_payment_method: { card: { last4: "0000" } } } },
      subscription: null,
      invoices: [{ ...paidInvoice, status: "open", amount_paid: 0, amount_due: 1500 }],
    });
    expect(details.subscription).toBeNull();
    expect(details.paymentMethod).toBeNull();
    expect(details.invoices[0]).toMatchObject({ status: "open", amountCents: 1500 });
  });
});

describe("formatMoney", () => {
  it("drops the cents for whole amounts and keeps them otherwise", () => {
    expect(formatMoney(600)).toBe("$6");
    expect(formatMoney(15000)).toBe("$150");
    expect(formatMoney(950)).toBe("$9.50");
  });
});
