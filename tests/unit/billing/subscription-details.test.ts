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
      pendingChange: null,
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

describe("summarizeBillingDetails — scheduled downgrade", () => {
  // The shape lib/stripe/actions.ts scheduleDowngrade leaves behind, read
  // back with expand: ["schedule.phases.items.price"].
  const farFuture = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
  const schedule = {
    current_phase: { start_date: farFuture - 30 * 24 * 60 * 60, end_date: farFuture },
    phases: [
      {
        start_date: farFuture - 30 * 24 * 60 * 60,
        end_date: farFuture,
        items: [{ price: { id: "price_pro", unit_amount: 1500, currency: "usd", recurring: { interval: "month" }, lookup_key: "pro_monthly" }, quantity: 1 }],
      },
      {
        start_date: farFuture,
        end_date: farFuture + 30 * 24 * 60 * 60,
        items: [{ price: { id: "price_plus", unit_amount: 600, currency: "usd", recurring: { interval: "month" }, lookup_key: "plus_monthly" }, quantity: 1 }],
      },
    ],
  };

  it("reads the NEXT phase's price, tier and start date", () => {
    const details = summarizeBillingDetails({
      customer: null,
      subscription: { ...paidSubscription, schedule },
      invoices: [],
    });
    expect(details.subscription?.pendingChange).toEqual({
      startsAt: new Date(farFuture * 1000).toISOString(),
      tier: "plus",
      interval: "month",
      amountCents: 600,
      currency: "usd",
    });
  });

  it("no schedule, an unexpanded schedule id, or a schedule with nothing after the current phase → no pending change", () => {
    const of = (value: unknown) =>
      summarizeBillingDetails({
        customer: null,
        subscription: { ...paidSubscription, schedule: value as never },
        invoices: [],
      }).subscription?.pendingChange;
    expect(of(null)).toBeNull();
    expect(of("sub_sched_1")).toBeNull();
    expect(of({ ...schedule, phases: schedule.phases.slice(0, 1) })).toBeNull();
  });

  it("an unexpanded price still yields the date, with no tier or amount", () => {
    const details = summarizeBillingDetails({
      customer: null,
      subscription: {
        ...paidSubscription,
        schedule: { ...schedule, phases: [schedule.phases[0], { ...schedule.phases[1], items: [{ price: "price_plus" }] }] },
      },
      invoices: [],
    });
    expect(details.subscription?.pendingChange).toEqual({
      startsAt: new Date(farFuture * 1000).toISOString(),
      tier: null,
      interval: null,
      amountCents: null,
      currency: "usd",
    });
  });
});

describe("formatMoney", () => {
  it("drops the cents for whole amounts and keeps them otherwise", () => {
    expect(formatMoney(600)).toBe("$6");
    expect(formatMoney(15000)).toBe("$150");
    expect(formatMoney(950)).toBe("$9.50");
  });
});
