import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKS, TRIAL_DAYS } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Checkout + portal actions. The rules that cost money when wrong:
//   * never start a SECOND subscription — an active one switches price in
//     place (portal confirm flow), a no-card trial is superseded (metadata
//     the webhook uses to cancel it once the new one is paid);
//   * one trial per account, decided by Stripe's subscription history;
//   * a new customer is linked through the service role and the write is
//     verified (a trigger revert reports no error — that broke the first
//     live trial);
//   * pack purchases carry server-set metadata the webhook trusts.
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  profile: null as null | { stripe_customer_id: string | null; subscription_status?: string | null },
  adminConfigured: true,
  stripeConfigured: true,
  linkedId: "cus_new",
  live: null as null | {
    id: string;
    status: string;
    trial_end?: number | null;
    items: { data: Array<{ id?: string; price: { id: string } }> };
  },
  delinquent: null as null | { id: string; status: string },
  history: [] as Array<{ id: string; status?: string }>,
  historyThrows: false,
  checkoutThrows: false,
  subscriptionsList: vi.fn(),
  customersCreate: vi.fn(),
  checkoutCreate: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: async () => s.user,
  getCurrentProfile: async () => s.profile,
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => s.adminConfigured,
  createAdminClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: { stripe_customer_id: s.linkedId }, error: null }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/site-url", () => ({ getSiteBaseUrl: () => "https://test.local" }));
vi.mock("@/lib/stripe/client", () => ({
  isStripeConfigured: () => s.stripeConfigured,
  getStripe: () => ({
    customers: { create: s.customersCreate },
    // The catalog answers by lookup key ("pro_monthly" → "price_pro_monthly"),
    // the same ids the mocked env mapping below produces.
    prices: {
      list: async ({ lookup_keys }: { lookup_keys: string[] }) => ({
        data: [{ id: `price_${lookup_keys[0]}` }],
      }),
    },
    subscriptions: { list: (args: unknown) => s.subscriptionsList(args) },
    checkout: { sessions: { create: s.checkoutCreate } },
    billingPortal: { sessions: { create: s.portalCreate } },
  }),
}));
vi.mock("@/lib/stripe/config", () => ({
  priceIdForTier: (tier: string, period: string) => `price_${tier}_${period}`,
  priceIdForPack: (pack: string) => `price_pack_${pack}`,
}));
vi.mock("@/lib/stripe/subscription-sync", () => ({
  findLiveSubscription: async () => s.live,
  findDelinquentSubscription: async () => s.delinquent,
}));

import { createCheckoutSessionAction, createPortalSessionAction } from "@/lib/stripe/actions";
import { clearPriceCache } from "@/lib/stripe/prices";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const checkoutParams = () => s.checkoutCreate.mock.calls[0]?.[0] as Record<string, unknown> & {
  subscription_data?: Record<string, unknown>;
  metadata?: Record<string, string>;
};

beforeEach(() => {
  clearPriceCache();
  s.user = { id: USER, email: "x@example.test" };
  s.profile = { stripe_customer_id: "cus_1" };
  s.adminConfigured = true;
  s.stripeConfigured = true;
  s.linkedId = "cus_new";
  s.live = null;
  s.delinquent = null;
  s.history = [];
  s.historyThrows = false;
  s.checkoutThrows = false;
  s.subscriptionsList.mockReset().mockImplementation(async () => {
    if (s.historyThrows) throw new Error("stripe down");
    return { data: s.history };
  });
  s.customersCreate.mockReset().mockResolvedValue({ id: "cus_new" });
  s.checkoutCreate.mockReset().mockImplementation(async () => {
    if (s.checkoutThrows) throw new Error("stripe down");
    return { url: "https://checkout.test/session" };
  });
  s.portalCreate.mockReset().mockResolvedValue({ url: "https://portal.test/session" });
});

describe("createCheckoutSessionAction", () => {
  it("is unavailable without Stripe, and needs a signed-in user", async () => {
    s.stripeConfigured = false;
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).toEqual({
      ok: false,
      error: "Billing isn't available right now.",
    });
    s.stripeConfigured = true;
    s.user = null;
    expect((await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).ok).toBe(false);
    expect(s.checkoutCreate).not.toHaveBeenCalled();
  });

  it("gives a first-time subscriber the card-optional trial", async () => {
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toEqual({ ok: true, url: "https://checkout.test/session" });
    const params = checkoutParams();
    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: USER,
      line_items: [{ price: "price_pro_monthly", quantity: 1 }],
      payment_method_collection: "if_required",
      success_url: "https://test.local/dashboard?billing=success",
    });
    expect(params.subscription_data).toMatchObject({
      metadata: { supabase_user_id: USER },
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
    expect(params.metadata).toBeUndefined();
  });

  it("gives no second trial once Stripe has ANY subscription on record", async () => {
    s.history = [{ id: "sub_old" }];
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus", period: "annual" });
    const params = checkoutParams();
    expect(params.line_items).toEqual([{ price: "price_plus_annual", quantity: 1 }]);
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params).not.toHaveProperty("payment_method_collection");
  });

  it("one trial per account: a lapsed Plus trial gets no Pro trial either — the history query asks Stripe for EVERY status", async () => {
    // The trial that ended (no card → canceled at day 7) must count; Stripe's
    // default list omits canceled subscriptions, so `status: "all"` is the
    // whole rule. An abandoned checkout (incomplete_expired) counts too.
    for (const status of ["canceled", "incomplete_expired"]) {
      s.checkoutCreate.mockClear();
      s.history = [{ id: "sub_trial", status }];
      await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
      const params = checkoutParams();
      expect(params.subscription_data, status).not.toHaveProperty("trial_period_days");
      expect(params.subscription_data, status).not.toHaveProperty("trial_end");
      expect(params, status).not.toHaveProperty("payment_method_collection");
      expect(s.subscriptionsList).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_1", status: "all" }),
      );
    }
  });

  it("fails TOWARD no trial when Stripe's history can't be read", async () => {
    s.historyThrows = true;
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(result.ok).toBe(true);
    expect(checkoutParams().subscription_data).not.toHaveProperty("trial_period_days");
  });

  it("the profile's own subscription history denies a trial even when Stripe shows none", async () => {
    // Second, independent record: the webhook-written status outlives a
    // replaced/lost Stripe customer.
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    s.history = [];
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(checkoutParams().subscription_data).not.toHaveProperty("trial_period_days");
    expect(s.subscriptionsList).not.toHaveBeenCalled();
  });

  it("a plan switch DURING a trial keeps the trial's end date on the new plan, still without a card", async () => {
    const fiveDaysOut = Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60;
    s.live = {
      id: "sub_trial",
      status: "trialing",
      trial_end: fiveDaysOut,
      items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] },
    };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    const params = checkoutParams();
    expect(params.metadata).toEqual({ supersedes_subscription_id: "sub_trial" });
    expect(params.subscription_data).toMatchObject({
      trial_end: fiveDaysOut,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params.payment_method_collection).toBe("if_required");
    expect(s.portalCreate).not.toHaveBeenCalled();
  });

  it("with under 48 hours of trial left (Stripe's minimum) the switch simply starts paying", async () => {
    s.live = {
      id: "sub_trial",
      status: "trialing",
      trial_end: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] },
    };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    const params = checkoutParams();
    expect(params.subscription_data).not.toHaveProperty("trial_end");
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params).not.toHaveProperty("payment_method_collection");
  });

  it("downgrades Pro → Plus (and annual ↔ monthly) in place through the same portal confirm flow", async () => {
    s.live = { id: "sub_live", status: "active", items: { data: [{ id: "si_1", price: { id: "price_pro_monthly" } }] } };
    const down = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(down).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.portalCreate.mock.calls[0]?.[0]).toMatchObject({
      return_url: "https://test.local/settings#billing",
      flow_data: {
        subscription_update_confirm: { subscription: "sub_live", items: [{ id: "si_1", price: "price_plus_monthly", quantity: 1 }] },
        after_completion: { type: "redirect", redirect: { return_url: "https://test.local/dashboard?billing=success" } },
      },
    });
    s.portalCreate.mockClear();
    const period = await createCheckoutSessionAction({ kind: "subscription", tier: "pro", period: "annual" });
    expect(period.ok).toBe(true);
    expect(s.portalCreate.mock.calls[0]?.[0].flow_data.subscription_update_confirm.items[0].price).toBe("price_pro_annual");
    expect(s.checkoutCreate).not.toHaveBeenCalled();
  });

  it("refuses a plan switch it can't address (no subscription item)", async () => {
    s.live = { id: "sub_live", status: "active", items: { data: [{ price: { id: "price_pro_monthly" } }] } };
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "plus" })).toEqual({
      ok: false,
      error: "Couldn't read your current plan.",
    });
  });

  it("switches an ACTIVE subscription in place through the portal instead of a second checkout", async () => {
    s.live = { id: "sub_live", status: "active", items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] } };
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.checkoutCreate).not.toHaveBeenCalled();
    expect(s.portalCreate.mock.calls[0]?.[0]).toMatchObject({
      customer: "cus_1",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: {
          subscription: "sub_live",
          items: [{ id: "si_1", price: "price_pro_monthly", quantity: 1 }],
        },
      },
    });
  });

  it("sends a past-due customer to the portal to fix the card — never a second subscription", async () => {
    s.live = null;
    s.delinquent = { id: "sub_pd", status: "past_due" };
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.checkoutCreate).not.toHaveBeenCalled();
    expect(s.portalCreate).toHaveBeenCalledWith({
      customer: "cus_1",
      return_url: "https://test.local/settings#billing",
    });
  });

  it("refuses the plan the customer is already on", async () => {
    s.live = { id: "sub_live", status: "active", items: { data: [{ id: "si_1", price: { id: "price_pro_monthly" } }] } };
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).toEqual({
      ok: false,
      error: "You're already on that plan.",
    });
  });

  it("supersedes a no-card trial: fresh checkout, no new trial, the trial's id in metadata", async () => {
    s.live = { id: "sub_trial", status: "trialing", items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] } };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    const params = checkoutParams();
    expect(params.metadata).toEqual({ supersedes_subscription_id: "sub_trial" });
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(s.portalCreate).not.toHaveBeenCalled();
  });

  it("mints and links a Stripe customer on first use — and refuses when the link didn't land", async () => {
    s.profile = { stripe_customer_id: null };
    const ok = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(ok.ok).toBe(true);
    expect(s.customersCreate).toHaveBeenCalledWith({
      email: "x@example.test",
      metadata: { supabase_user_id: USER },
    });
    expect(checkoutParams().customer).toBe("cus_new");

    s.checkoutCreate.mockClear();
    s.linkedId = "cus_stale"; // the protect_billing_columns trigger reverted the write
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).toEqual({
      ok: false,
      error: "Couldn't link your billing account. Try again.",
    });
    expect(s.checkoutCreate).not.toHaveBeenCalled();

    s.adminConfigured = false; // can't link → can't mint
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).toEqual({
      ok: false,
      error: "Billing isn't available right now.",
    });
  });

  it("sells a credit pack as a one-time payment with server-set metadata", async () => {
    await createCheckoutSessionAction({ kind: "pack", pack: "small" });
    expect(checkoutParams()).toMatchObject({
      mode: "payment",
      customer: "cus_1",
      line_items: [{ price: "price_pack_small", quantity: 1 }],
      metadata: {
        supabase_user_id: USER,
        purchase_kind: "pack",
        pack_credits: String(CREDIT_PACKS.small.credits),
      },
      success_url: "https://test.local/settings?billing=credits",
    });
  });

  it("turns a Stripe failure into a friendly error", async () => {
    s.checkoutThrows = true;
    expect(await createCheckoutSessionAction({ kind: "pack", pack: "large" })).toEqual({
      ok: false,
      error: "Stripe checkout failed. Please try again.",
    });
  });
});

describe("createPortalSessionAction", () => {
  it("needs an existing billing account", async () => {
    s.profile = { stripe_customer_id: null };
    expect(await createPortalSessionAction()).toEqual({ ok: false, error: "You don't have a billing account yet." });
  });
  it("opens the portal for the customer and returns to settings", async () => {
    expect(await createPortalSessionAction()).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.portalCreate).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://test.local/settings" });
  });
});
