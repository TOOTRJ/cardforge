import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_PACKS, PACK_SUBSCRIBER_COUPON_ID, TRIAL_DAYS, TRIAL_WINBACK_COUPON_ID } from "@/lib/billing/plans";

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
  profile: null as null | {
    stripe_customer_id: string | null;
    subscription_status?: string | null;
    stripe_subscription_id?: string | null;
  },
  adminConfigured: true,
  stripeConfigured: true,
  linkedId: "cus_new",
  lapsedTrial: false,
  live: null as null | {
    id: string;
    status: string;
    trial_end?: number | null;
    cancel_at_period_end?: boolean;
    cancel_at?: number | null;
    schedule?: string | null;
    default_payment_method?: string | null;
    items: {
      data: Array<{ id?: string; price: { id: string; recurring?: { interval: string } } }>;
    };
  },
  delinquent: null as null | { id: string; status: string },
  history: [] as Array<{ id: string; status?: string }>,
  historyThrows: false,
  checkoutThrows: false,
  funnelInserts: [] as Array<Record<string, unknown>>,
  subscriptionsList: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  scheduleCreate: vi.fn(),
  scheduleUpdate: vi.fn(),
  scheduleRelease: vi.fn(),
  syncSubscription: vi.fn(),
  revalidated: [] as string[],
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
      // Funnel rows (checkout_started) — recorded, answered with an id.
      insert: (row: Record<string, unknown>) => {
        s.funnelInserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "fe_1" }, error: null }) }) };
      },
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({ data: { stripe_customer_id: s.linkedId }, error: null }),
          }),
        }),
      }),
      // The win-back eligibility read (a recent trial_lapsed notification).
      select: () => {
        const chain = {
          eq: () => chain,
          gte: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: s.lapsedTrial ? { id: "n_lapsed" } : null, error: null }),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    s.revalidated.push(path);
  },
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
    subscriptions: {
      list: (args: unknown) => s.subscriptionsList(args),
      update: s.subscriptionsUpdate,
      retrieve: s.subscriptionsRetrieve,
    },
    subscriptionSchedules: {
      create: s.scheduleCreate,
      update: s.scheduleUpdate,
      release: s.scheduleRelease,
    },
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
  customerIdOf: (customer: string | { id: string } | null | undefined) =>
    !customer ? null : typeof customer === "string" ? customer : customer.id,
  isLiveStatus: (status: string | null | undefined) => status === "active" || status === "trialing",
  syncSubscriptionForUser: (...args: unknown[]) => s.syncSubscription(...args),
  subscriptionHasPaymentMethod: async (sub: { default_payment_method?: string | null }) =>
    Boolean(sub.default_payment_method),
  // The mocked catalog's ids spell their tier ("price_pro_annual").
  resolveSubscriptionTier: async (sub: { items: { data: Array<{ price: { id: string } }> } }) => {
    const id = sub.items.data[0]?.price.id ?? "";
    return id.includes("pro") ? "pro" : id.includes("plus") ? "plus" : null;
  },
}));

import {
  cancelScheduledPlanChangeAction,
  createCheckoutSessionAction,
  createPortalSessionAction,
  getResumePreviewAction,
  resumeSubscriptionAction,
} from "@/lib/stripe/actions";
import { isPlanDowngrade } from "@/lib/billing/plan-change";
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
  s.lapsedTrial = false;
  s.funnelInserts = [];
  s.revalidated = [];
  s.syncSubscription.mockReset().mockResolvedValue({});
  s.delinquent = null;
  s.history = [];
  s.historyThrows = false;
  s.checkoutThrows = false;
  s.subscriptionsList.mockReset().mockImplementation(async () => {
    if (s.historyThrows) throw new Error("stripe down");
    return { data: s.history };
  });
  s.subscriptionsUpdate.mockReset().mockResolvedValue({});
  s.subscriptionsRetrieve.mockReset().mockImplementation(async () => s.live);
  s.scheduleCreate.mockReset().mockResolvedValue({
    id: "sub_sched_1",
    phases: [
      {
        start_date: 1_790_000_000,
        end_date: 1_792_600_000,
        items: [{ price: { id: "price_pro_monthly" }, quantity: 1 }],
      },
    ],
  });
  s.scheduleUpdate.mockReset().mockResolvedValue({ id: "sub_sched_1" });
  s.scheduleRelease.mockReset().mockResolvedValue({ id: "sub_sched_1" });
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

  it("gives a first-time subscriber the 7-day trial — card REQUIRED (Stripe's default collection), cancel-safe", async () => {
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toEqual({ ok: true, url: "https://checkout.test/session" });
    const params = checkoutParams();
    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      client_reference_id: USER,
      line_items: [{ price: "price_pro_monthly", quantity: 1 }],
      // checkout.session.expired reads what was being bought from here.
      metadata: { supabase_user_id: USER, purchase_kind: "subscription", tier: "pro", period: "monthly" },
      allow_promotion_codes: true,
      success_url: "https://test.local/dashboard?billing=success",
    });
    expect(params.subscription_data).toMatchObject({
      metadata: { supabase_user_id: USER },
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
    // Nothing superseded on a first subscription — only the purchase stamp.
    expect(params.metadata).not.toHaveProperty("supersedes_subscription_id");
    // Card required: Checkout's default collection, never `if_required`.
    expect(params).not.toHaveProperty("payment_method_collection");
    expect(params.metadata).toMatchObject({ discount: "none" });
    // Funnel: the click became a checkout_started row, and its id rides in the
    // session metadata so the webhook can tie completion back to it.
    expect(s.funnelInserts).toEqual([
      { event: "checkout_started", user_id: USER, props: { kind: "subscription", tier: "pro", period: "monthly", trial: true, discount: "none" }, source: "server" },
    ]);
    expect(params.metadata).toMatchObject({ funnel_id: "fe_1" });
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

  it("a LEGACY no-card trial switching plans is superseded by a checkout that keeps the trial's end date and collects the card", async () => {
    const fiveDaysOut = Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60;
    s.live = {
      id: "sub_trial",
      status: "trialing",
      trial_end: fiveDaysOut,
      items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] },
    };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    const params = checkoutParams();
    expect(params.metadata).toEqual({
      supabase_user_id: USER,
      purchase_kind: "subscription",
      tier: "pro",
      period: "monthly",
      discount: "none",
      supersedes_subscription_id: "sub_trial",
      funnel_id: "fe_1",
    });
    expect(params.subscription_data).toMatchObject({
      trial_end: fiveDaysOut,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params).not.toHaveProperty("payment_method_collection");
    expect(s.portalCreate).not.toHaveBeenCalled();
  });

  it("a CARD-BACKED trial switches plans in place through the portal (continue_trial keeps the trial) — no second checkout", async () => {
    s.live = {
      id: "sub_trial",
      status: "trialing",
      trial_end: Math.floor(Date.now() / 1000) + 5 * 24 * 60 * 60,
      default_payment_method: "pm_1",
      items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] },
    };
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.portalCreate.mock.calls[0]?.[0]).toMatchObject({
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: { subscription: "sub_trial", items: [{ id: "si_1", price: "price_pro_monthly", quantity: 1 }] },
      },
    });
    expect(s.checkoutCreate).not.toHaveBeenCalled();
  });

  it("win-back: a trial that lapsed within 30 days buys its first month with the coupon applied server-side (no promo-code box)", async () => {
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    s.history = [{ id: "sub_old_trial", status: "canceled" }];
    s.lapsedTrial = true;
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    const params = checkoutParams();
    expect(params.discounts).toEqual([{ coupon: TRIAL_WINBACK_COUPON_ID }]);
    expect(params).not.toHaveProperty("allow_promotion_codes");
    expect(params.metadata).toMatchObject({ discount: "trial_winback" });
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");

    // No lapsed trial on record → full price, promo codes allowed.
    s.checkoutCreate.mockClear();
    s.lapsedTrial = false;
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(checkoutParams()).not.toHaveProperty("discounts");
    expect(checkoutParams().allow_promotion_codes).toBe(true);
  });

  it("win-back: a missing coupon sells at full price instead of failing", async () => {
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    s.history = [{ id: "sub_old_trial", status: "canceled" }];
    s.lapsedTrial = true;
    s.checkoutCreate.mockReset().mockImplementationOnce(async () => {
      throw new Error("No such coupon: 'TRIAL_WINBACK_20'");
    }).mockResolvedValue({ url: "https://checkout.test/full" });
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "plus" })).toEqual({ ok: true, url: "https://checkout.test/full" });
    const retry = s.checkoutCreate.mock.calls[1][0];
    expect(retry).not.toHaveProperty("discounts");
    expect(retry.allow_promotion_codes).toBe(true);
    expect(retry.metadata.discount).toBe("none");
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

  it("schedules a DOWNGRADE (Pro → Plus) for the end of the paid period: schedule from the subscription, current phase kept as is, one phase on the new price, then release", async () => {
    s.live = {
      id: "sub_live",
      status: "active",
      items: { data: [{ id: "si_1", price: { id: "price_pro_monthly", recurring: { interval: "month" } } }] },
    };
    const down = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(down).toEqual({ ok: true, url: "https://test.local/dashboard/billing?billing=scheduled" });
    expect(s.scheduleCreate).toHaveBeenCalledWith({ from_subscription: "sub_live" });
    expect(s.scheduleUpdate).toHaveBeenCalledWith("sub_sched_1", {
      end_behavior: "release",
      phases: [
        {
          start_date: 1_790_000_000,
          end_date: 1_792_600_000,
          items: [{ price: "price_pro_monthly", quantity: 1 }],
        },
        {
          items: [{ price: "price_plus_monthly", quantity: 1 }],
          duration: { interval: "month", interval_count: 1 },
          proration_behavior: "none",
        },
      ],
    });
    // Nothing charged or credited now, no portal, no second subscription.
    expect(s.portalCreate).not.toHaveBeenCalled();
    expect(s.checkoutCreate).not.toHaveBeenCalled();
    expect(s.scheduleRelease).not.toHaveBeenCalled();
    expect(s.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("annual → monthly on the same tier is a downgrade (scheduled, a one-year phase is not); monthly → annual is an upgrade (portal, at once)", async () => {
    s.live = {
      id: "sub_live",
      status: "active",
      items: { data: [{ id: "si_1", price: { id: "price_pro_annual", recurring: { interval: "year" } } }] },
    };
    const toMonthly = await createCheckoutSessionAction({ kind: "subscription", tier: "pro", period: "monthly" });
    expect(toMonthly).toEqual({ ok: true, url: "https://test.local/dashboard/billing?billing=scheduled" });
    expect(s.scheduleUpdate.mock.calls[0]?.[1].phases[1]).toMatchObject({
      items: [{ price: "price_pro_monthly", quantity: 1 }],
      duration: { interval: "month", interval_count: 1 },
    });
    expect(s.portalCreate).not.toHaveBeenCalled();

    s.scheduleCreate.mockClear();
    s.live = {
      id: "sub_live",
      status: "active",
      items: { data: [{ id: "si_1", price: { id: "price_pro_monthly", recurring: { interval: "month" } } }] },
    };
    const toAnnual = await createCheckoutSessionAction({ kind: "subscription", tier: "pro", period: "annual" });
    expect(toAnnual).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.portalCreate.mock.calls[0]?.[0]).toMatchObject({
      return_url: "https://test.local/dashboard/billing",
      flow_data: {
        subscription_update_confirm: { subscription: "sub_live", items: [{ id: "si_1", price: "price_pro_annual", quantity: 1 }] },
        after_completion: { type: "redirect", redirect: { return_url: "https://test.local/dashboard?billing=success" } },
      },
    });
    expect(s.scheduleCreate).not.toHaveBeenCalled();
  });

  it("a downgrade replaces a pending one and un-cancels a plan set to end — the click asked for Plus after this period, not nothing", async () => {
    s.live = {
      id: "sub_live",
      status: "active",
      cancel_at_period_end: true,
      schedule: "sub_sched_old",
      items: { data: [{ id: "si_1", price: { id: "price_pro_monthly", recurring: { interval: "month" } } }] },
    };
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(result.ok).toBe(true);
    expect(s.scheduleRelease).toHaveBeenCalledWith("sub_sched_old");
    expect(s.subscriptionsUpdate).toHaveBeenCalledWith("sub_live", { cancel_at_period_end: false });
    expect(s.scheduleCreate).toHaveBeenCalledWith({ from_subscription: "sub_live" });
    // Order: release → un-cancel → new schedule (Stripe refuses a schedule
    // on a subscription that already has one or is set to cancel).
    const order = [s.scheduleRelease, s.subscriptionsUpdate, s.scheduleCreate].map(
      (fn) => fn.mock.invocationCallOrder[0],
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("a plan cancelled by DATE (the portal's cancel_at, flag false) is resumed with cancel_at: \"\" and THEN downgraded", async () => {
    // The sandbox shape of a Customer Portal cancellation on a flexible-
    // billing subscription: cancel_at = the item's period end, flag false.
    // On main this was refused ("Resume it first"): the un-cancel only knew
    // the flag.
    s.live = {
      id: "sub_live",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: 1792722400,
      items: { data: [{ id: "si_1", price: { id: "price_pro_monthly", recurring: { interval: "month" } } }] },
    };
    s.subscriptionsUpdate.mockImplementation(async (_id: string, params: Record<string, unknown>) => ({
      ...s.live,
      ...("cancel_at" in params ? { cancel_at: null } : {}),
    }));
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(result).toEqual({ ok: true, url: "https://test.local/dashboard/billing?billing=scheduled" });
    // ONE parameter per call — Stripe refuses cancel_at together with
    // cancel_at_period_end (sandbox, 2026-10-07).
    expect(s.subscriptionsUpdate.mock.calls).toEqual([["sub_live", { cancel_at: "" }]]);
    expect(s.subscriptionsUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      s.scheduleCreate.mock.invocationCallOrder[0],
    );
    expect(s.scheduleCreate).toHaveBeenCalledWith({ from_subscription: "sub_live" });
  });

  it("a downgrade on a plan that could NOT be resumed schedules nothing (the new price would never start)", async () => {
    s.live = {
      id: "sub_live",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: 1792722400,
      items: { data: [{ id: "si_1", price: { id: "price_pro_monthly", recurring: { interval: "month" } } }] },
    };
    // Stripe answers with the cancellation still in place.
    s.subscriptionsUpdate.mockImplementation(async () => ({ ...s.live }));
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/Resume it on the billing page first/);
    expect(s.scheduleCreate).not.toHaveBeenCalled();
  });

  it("a downgrade that un-cancels and THEN fails to schedule says the plan now renews — never a generic error over a silent resume", async () => {
    s.live = {
      id: "sub_live",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: 1792722400,
      items: { data: [{ id: "si_1", price: { id: "price_pro_monthly", recurring: { interval: "month" } } }] },
    };
    s.subscriptionsUpdate.mockImplementation(async () => ({ ...s.live, cancel_at: null }));
    s.scheduleCreate.mockRejectedValueOnce(new Error("stripe down"));
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/was resumed and now renews as usual/);
    expect(result.ok === false && result.error).toMatch(/couldn't be scheduled/);
    // The pages that named the cancellation are refreshed: it is gone.
    expect(s.revalidated).toEqual(expect.arrayContaining(["/dashboard", "/settings"]));
    // A plan that was NOT cancelled keeps the ordinary error path.
    s.live = { ...s.live, cancel_at: null };
    s.scheduleCreate.mockRejectedValueOnce(new Error("stripe down"));
    // (And it is ANSWERED, not thrown: `return scheduleDowngrade(…)` without
    // an await used to let the rejection past the action's catch, unlogged.)
    const plain = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(plain).toEqual({ ok: false, error: "Stripe checkout failed. Please try again." });
  });

  it("an UPGRADE on a plan that is set to end goes to the portal's confirm page untouched — Stripe renews it on confirm", async () => {
    // Read on the sandbox's confirm page (2026-10-07): "Your subscription is
    // currently scheduled to cancel on …. By confirming, your updated
    // subscription will be renewed". So no un-cancel here: a customer who
    // backs out of the confirm page must still have a cancelled plan.
    s.live = {
      id: "sub_live",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: 1792722400,
      items: { data: [{ id: "si_1", price: { id: "price_plus_monthly", recurring: { interval: "month" } } }] },
    };
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(s.portalCreate.mock.calls[0][0].flow_data.type).toBe("subscription_update_confirm");
  });

  it("an UPGRADE drops a pending downgrade first, then confirms in the portal (a scheduled subscription can't be updated there)", async () => {
    s.live = {
      id: "sub_live",
      status: "active",
      schedule: "sub_sched_old",
      items: { data: [{ id: "si_1", price: { id: "price_plus_monthly", recurring: { interval: "month" } } }] },
    };
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.scheduleRelease).toHaveBeenCalledWith("sub_sched_old");
    expect(s.scheduleRelease.mock.invocationCallOrder[0]).toBeLessThan(s.portalCreate.mock.invocationCallOrder[0]);
    expect(s.scheduleCreate).not.toHaveBeenCalled();
  });

  it("isPlanDowngrade: lower tier, or annual → monthly on the same tier; an unknown current price counts as an upgrade", () => {
    expect(isPlanDowngrade({ tier: "pro", interval: "month" }, { tier: "plus", period: "monthly" })).toBe(true);
    expect(isPlanDowngrade({ tier: "pro", interval: "year" }, { tier: "plus", period: "annual" })).toBe(true);
    expect(isPlanDowngrade({ tier: "pro", interval: "year" }, { tier: "pro", period: "monthly" })).toBe(true);
    expect(isPlanDowngrade({ tier: "pro", interval: "month" }, { tier: "pro", period: "annual" })).toBe(false);
    expect(isPlanDowngrade({ tier: "plus", interval: "year" }, { tier: "pro", period: "monthly" })).toBe(false);
    expect(isPlanDowngrade({ tier: "plus", interval: "month" }, { tier: "pro", period: "annual" })).toBe(false);
    expect(isPlanDowngrade({ tier: null, interval: "month" }, { tier: "plus", period: "monthly" })).toBe(false);
  });

  it("refuses a plan switch it can't address (no subscription item)", async () => {
    s.live = { id: "sub_live", status: "active", items: { data: [{ price: { id: "price_plus_monthly" } }] } };
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).toEqual({
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
      return_url: "https://test.local/dashboard/billing",
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
    expect(params.metadata).toEqual({
      supabase_user_id: USER,
      purchase_kind: "subscription",
      tier: "pro",
      period: "monthly",
      discount: "none",
      supersedes_subscription_id: "sub_trial",
      funnel_id: "fe_1",
    });
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

  it("sells a credit pack as a one-time payment with server-set metadata — full price without a subscription", async () => {
    await createCheckoutSessionAction({ kind: "pack", pack: "small" });
    expect(checkoutParams()).toMatchObject({
      mode: "payment",
      customer: "cus_1",
      line_items: [{ price: "price_pack_small", quantity: 1 }],
      metadata: {
        supabase_user_id: USER,
        purchase_kind: "pack",
        pack: "small",
        pack_credits: String(CREDIT_PACKS.small.credits),
        discount: "none",
      },
      success_url: "https://test.local/dashboard/billing?billing=credits",
    });
    expect(checkoutParams()).not.toHaveProperty("discounts");
    expect(s.funnelInserts).toEqual([
      { event: "checkout_started", user_id: USER, props: { kind: "pack", pack: "small", credits: 30, discount: "none" }, source: "server" },
    ]);
    expect(checkoutParams().metadata).toMatchObject({ funnel_id: "fe_1" });
  });

  it("the 10-credit impulse pack resolves by its own lookup key", async () => {
    await createCheckoutSessionAction({ kind: "pack", pack: "mini" });
    expect(checkoutParams()).toMatchObject({
      line_items: [{ price: "price_pack_mini", quantity: 1 }],
      metadata: { pack: "mini", pack_credits: "10" },
    });
  });

  it("an ACTIVE subscriber gets the subscriber coupon applied server-side; a trial does not", async () => {
    s.live = { id: "sub_live", status: "active", items: { data: [{ id: "si_1", price: { id: "price_pro_monthly" } }] } };
    await createCheckoutSessionAction({ kind: "pack", pack: "large" });
    expect(checkoutParams()).toMatchObject({
      discounts: [{ coupon: PACK_SUBSCRIBER_COUPON_ID }],
      metadata: { discount: "subscriber", pack_credits: "100" },
    });

    s.checkoutCreate.mockClear();
    s.live = { id: "sub_trial", status: "trialing", items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] } };
    await createCheckoutSessionAction({ kind: "pack", pack: "large" });
    expect(checkoutParams()).not.toHaveProperty("discounts");
    expect(checkoutParams().metadata).toMatchObject({ discount: "none" });
  });

  it("a missing coupon never blocks a sale: the pack is sold at full price and the failure logged", async () => {
    s.live = { id: "sub_live", status: "active", items: { data: [{ id: "si_1", price: { id: "price_pro_monthly" } }] } };
    s.checkoutCreate.mockReset().mockImplementationOnce(async () => {
      throw new Error("No such coupon: 'SUBSCRIBER_PACKS_20'");
    }).mockResolvedValue({ url: "https://checkout.test/full-price" });
    const result = await createCheckoutSessionAction({ kind: "pack", pack: "small" });
    expect(result).toEqual({ ok: true, url: "https://checkout.test/full-price" });
    expect(s.checkoutCreate).toHaveBeenCalledTimes(2);
    expect(s.checkoutCreate.mock.calls[1][0]).not.toHaveProperty("discounts");
  });

  it("turns a Stripe failure into a friendly error", async () => {
    s.checkoutThrows = true;
    expect(await createCheckoutSessionAction({ kind: "pack", pack: "large" })).toEqual({
      ok: false,
      error: "Stripe checkout failed. Please try again.",
    });
  });
});

describe("resumeSubscriptionAction — one-click Resume", () => {
  const PERIOD_END = 1794097332;
  const item = (interval = "month") => ({
    id: "si_1",
    current_period_end: PERIOD_END,
    price: { id: "price_pro_monthly", unit_amount: 1500, currency: "usd", recurring: { interval } },
  });
  /** Stripe's answers: update() applies the parameter to the stored sub. */
  function stripeHolds(sub: Record<string, unknown>) {
    let current = { ...sub };
    s.subscriptionsRetrieve.mockImplementation(async () => current);
    s.subscriptionsUpdate.mockImplementation(async (_id: string, params: Record<string, unknown>) => {
      if ("cancel_at" in params && "cancel_at_period_end" in params) {
        throw new Error("Received both cancel_at_period_end and cancel_at parameters. Please pass in only one.");
      }
      if (params.cancel_at === "") current = { ...current, cancel_at: null, canceled_at: null };
      if (params.cancel_at_period_end === false) {
        // Classic billing mirrors the flag into cancel_at; clearing the flag clears both.
        current = { ...current, cancel_at_period_end: false, cancel_at: null, canceled_at: null };
      }
      return current;
    });
  }
  beforeEach(() => {
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live", subscription_status: "active" };
  });

  it("needs Stripe, a signed-in user and a subscription of the caller's own", async () => {
    s.stripeConfigured = false;
    expect(await resumeSubscriptionAction()).toEqual({ ok: false, error: "Billing isn't available right now." });
    s.stripeConfigured = true;
    s.user = null;
    expect(await resumeSubscriptionAction()).toEqual({ ok: false, error: "Please sign in to manage billing." });
    s.user = { id: USER, email: "x@example.test" };
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: null };
    expect(await resumeSubscriptionAction()).toEqual({ ok: false, error: "There's no plan to resume." });
    // The stored subscription belongs to ANOTHER customer: never touched.
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live" };
    stripeHolds({ id: "sub_live", status: "active", customer: "cus_someone_else", cancel_at: PERIOD_END, items: { data: [item()] } });
    expect(await resumeSubscriptionAction()).toEqual({ ok: false, error: "There's no plan to resume." });
    expect(s.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("the portal's shape (flexible billing: cancel_at = period end, flag false) is cleared with cancel_at: \"\" — one call, one parameter", async () => {
    stripeHolds({
      id: "sub_live",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: false,
      cancel_at: PERIOD_END,
      canceled_at: 1791418974,
      schedule: null,
      items: { data: [item()] },
    });
    const result = await resumeSubscriptionAction({ surface: "dashboard" });
    expect(result).toEqual({ ok: true, url: "https://test.local/dashboard/billing?billing=resumed" });
    expect(s.subscriptionsRetrieve).toHaveBeenCalledWith("sub_live", { expand: ["schedule"] });
    expect(s.subscriptionsUpdate.mock.calls).toEqual([["sub_live", { cancel_at: "" }]]);
    // The profile is resynced from the resumed subscription, through the
    // one sync, so the next page already says "Renews on".
    expect(s.syncSubscription).toHaveBeenCalledTimes(1);
    const [, , userId, options] = s.syncSubscription.mock.calls[0];
    expect(userId).toBe(USER);
    expect(options).toMatchObject({ customerId: "cus_1", currentSub: { id: "sub_live", cancel_at: null } });
    expect(s.revalidated).toEqual(expect.arrayContaining(["/dashboard", "/settings"]));
    // Funnel: a money step, allow-listed name and props.
    expect(s.funnelInserts).toEqual([
      expect.objectContaining({
        event: "subscription_resumed",
        user_id: USER,
        props: { tier: "pro", interval: "month", trial: false, subscriptionId: "sub_live", surface: "dashboard" },
      }),
    ]);
  });

  it("the classic shape (cancel_at_period_end: true, cancel_at mirrored) is cleared with the flag alone", async () => {
    stripeHolds({
      id: "sub_live",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: true,
      cancel_at: PERIOD_END,
      items: { data: [item()] },
    });
    expect((await resumeSubscriptionAction()).ok).toBe(true);
    expect(s.subscriptionsUpdate.mock.calls).toEqual([["sub_live", { cancel_at_period_end: false }]]);
  });

  it("a flag AND a date that survives it: two calls, never both parameters in one", async () => {
    let current: Record<string, unknown> = {
      id: "sub_live",
      status: "active",
      customer: "cus_1",
      cancel_at_period_end: true,
      cancel_at: PERIOD_END + 86400 * 40,
      items: { data: [item()] },
    };
    s.subscriptionsRetrieve.mockImplementation(async () => current);
    s.subscriptionsUpdate.mockImplementation(async (_id: string, params: Record<string, unknown>) => {
      expect(Object.keys(params)).toHaveLength(1);
      if (params.cancel_at_period_end === false) current = { ...current, cancel_at_period_end: false };
      if (params.cancel_at === "") current = { ...current, cancel_at: null };
      return current;
    });
    expect((await resumeSubscriptionAction()).ok).toBe(true);
    expect(s.subscriptionsUpdate.mock.calls).toEqual([
      ["sub_live", { cancel_at_period_end: false }],
      ["sub_live", { cancel_at: "" }],
    ]);
  });

  it("a cancelled TRIAL resumes the same way and is recorded as a trial", async () => {
    stripeHolds({
      id: "sub_live",
      status: "trialing",
      customer: "cus_1",
      trial_end: PERIOD_END,
      cancel_at: PERIOD_END,
      items: { data: [item()] },
    });
    expect((await resumeSubscriptionAction({ surface: "billing" })).ok).toBe(true);
    expect(s.subscriptionsUpdate.mock.calls).toEqual([["sub_live", { cancel_at: "" }]]);
    expect(s.funnelInserts[0]).toMatchObject({ event: "subscription_resumed", props: { trial: true, surface: "billing" } });
  });

  it("a schedule that ends in a cancellation is switched to release", async () => {
    let scheduleBehavior = "cancel";
    s.subscriptionsRetrieve.mockImplementation(async () => ({
      id: "sub_live",
      status: "active",
      customer: "cus_1",
      cancel_at: null,
      schedule: { id: "sub_sched_9", end_behavior: scheduleBehavior, phases: [{ end_date: PERIOD_END }] },
      items: { data: [item()] },
    }));
    s.scheduleUpdate.mockImplementation(async (_id: string, params: { end_behavior: string }) => {
      scheduleBehavior = params.end_behavior;
      return { id: "sub_sched_9" };
    });
    expect((await resumeSubscriptionAction()).ok).toBe(true);
    expect(s.scheduleUpdate).toHaveBeenCalledWith("sub_sched_9", { end_behavior: "release" });
    expect(s.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("a plan that is not ending any more (resumed in another tab) answers ok without writing to Stripe or the funnel", async () => {
    stripeHolds({ id: "sub_live", status: "active", customer: "cus_1", cancel_at: null, items: { data: [item()] } });
    expect((await resumeSubscriptionAction()).ok).toBe(true);
    expect(s.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(s.funnelInserts).toEqual([]);
    // …but the profile is still resynced: that is what made the button show.
    expect(s.syncSubscription).toHaveBeenCalledTimes(1);
  });

  it("an ENDED subscription can't be resumed (a new plan is a new checkout) and nothing is written", async () => {
    stripeHolds({ id: "sub_live", status: "canceled", customer: "cus_1", items: { data: [item()] } });
    const result = await resumeSubscriptionAction();
    expect(result).toEqual({ ok: false, error: "This plan has already ended. Pick a plan to start a new one." });
    expect(s.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("a PAST-DUE subscription has not ended: no \"pick a new plan\" (that would bill twice) — the portal fixes the payment", async () => {
    stripeHolds({ id: "sub_live", status: "past_due", customer: "cus_1", cancel_at: PERIOD_END, items: { data: [item()] } });
    const result = await resumeSubscriptionAction();
    expect(result).toMatchObject({ ok: false, fallback: "portal" });
    expect(result.ok === false && result.error).not.toMatch(/already ended/);
    expect(s.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(s.funnelInserts).toEqual([]);
  });

  it("Stripe refusing, or leaving the plan set to end, falls back to the portal — and nothing is recorded as resumed", async () => {
    stripeHolds({ id: "sub_live", status: "active", customer: "cus_1", cancel_at: PERIOD_END, items: { data: [item()] } });
    s.subscriptionsUpdate.mockRejectedValue(new Error("stripe down"));
    expect(await resumeSubscriptionAction()).toMatchObject({ ok: false, fallback: "portal" });
    // Stripe answers 200 but the cancellation is still there.
    s.subscriptionsUpdate.mockReset().mockImplementation(async () => ({
      id: "sub_live",
      status: "active",
      cancel_at: PERIOD_END,
      items: { data: [item()] },
    }));
    expect(await resumeSubscriptionAction()).toMatchObject({ ok: false, fallback: "portal" });
    expect(s.funnelInserts).toEqual([]);
    expect(s.syncSubscription).not.toHaveBeenCalled();
  });

  it("a failed profile resync does not fail the resume (Stripe is right; the webhook repeats the sync)", async () => {
    stripeHolds({ id: "sub_live", status: "active", customer: "cus_1", cancel_at: PERIOD_END, items: { data: [item()] } });
    s.syncSubscription.mockRejectedValue(new Error("db down"));
    expect((await resumeSubscriptionAction()).ok).toBe(true);
  });

  it("getResumePreviewAction: the plan, the price and the next bill date from Stripe — a trial bills at its end", async () => {
    stripeHolds({ id: "sub_live", status: "active", customer: "cus_1", cancel_at: PERIOD_END, items: { data: [item("year")] } });
    expect(await getResumePreviewAction()).toEqual({
      ok: true,
      planName: "Pro",
      trial: false,
      nextBillAt: new Date(PERIOD_END * 1000).toISOString(),
      priceLine: "$15 / year",
    });
    stripeHolds({
      id: "sub_live",
      status: "trialing",
      customer: "cus_1",
      trial_end: PERIOD_END - 86400,
      cancel_at: PERIOD_END - 86400,
      items: { data: [item()] },
    });
    expect(await getResumePreviewAction()).toMatchObject({
      ok: true,
      trial: true,
      nextBillAt: new Date((PERIOD_END - 86400) * 1000).toISOString(),
      priceLine: "$15 / month",
    });
    stripeHolds({ id: "sub_live", status: "canceled", customer: "cus_1", items: { data: [item()] } });
    expect(await getResumePreviewAction()).toEqual({ ok: false, error: "There's no plan to resume." });
  });
});

describe("cancelScheduledPlanChangeAction", () => {
  it("releases the schedule on the profile's subscription and lands back on the billing page", async () => {
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live" };
    s.live = { id: "sub_live", status: "active", schedule: "sub_sched_1", items: { data: [] } };
    expect(await cancelScheduledPlanChangeAction()).toEqual({
      ok: true,
      url: "https://test.local/dashboard/billing?billing=kept",
    });
    expect(s.subscriptionsRetrieve).toHaveBeenCalledWith("sub_live");
    expect(s.scheduleRelease).toHaveBeenCalledWith("sub_sched_1");
  });

  it("reports when there is nothing scheduled, and needs a subscription + a signed-in user", async () => {
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live" };
    s.live = { id: "sub_live", status: "active", schedule: null, items: { data: [] } };
    expect(await cancelScheduledPlanChangeAction()).toEqual({ ok: false, error: "There's no scheduled plan change." });
    expect(s.scheduleRelease).not.toHaveBeenCalled();

    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: null };
    expect((await cancelScheduledPlanChangeAction()).ok).toBe(false);
    s.user = null;
    expect((await cancelScheduledPlanChangeAction()).ok).toBe(false);
  });

  it("turns a Stripe failure into a friendly error", async () => {
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live" };
    s.live = { id: "sub_live", status: "active", schedule: "sub_sched_1", items: { data: [] } };
    s.scheduleRelease.mockRejectedValueOnce(new Error("stripe down"));
    expect(await cancelScheduledPlanChangeAction()).toEqual({
      ok: false,
      error: "Couldn't cancel the plan change. Try again.",
    });
  });
});

describe("createPortalSessionAction", () => {
  it("needs an existing billing account", async () => {
    s.profile = { stripe_customer_id: null };
    expect(await createPortalSessionAction()).toEqual({ ok: false, error: "You don't have a billing account yet." });
  });
  it("opens the portal home for the customer and returns to the billing page", async () => {
    expect(await createPortalSessionAction()).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.portalCreate).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://test.local/dashboard/billing" });
  });

  it("deep-links the payment-method and cancel flows; cancel needs the profile's live subscription", async () => {
    await createPortalSessionAction("payment_method_update");
    expect(s.portalCreate.mock.calls[0]?.[0]).toMatchObject({ flow_data: { type: "payment_method_update" } });

    s.portalCreate.mockClear();
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: "sub_live" };
    await createPortalSessionAction("subscription_cancel");
    expect(s.portalCreate.mock.calls[0]?.[0]).toMatchObject({
      flow_data: { type: "subscription_cancel", subscription_cancel: { subscription: "sub_live" } },
    });

    s.portalCreate.mockClear();
    s.profile = { stripe_customer_id: "cus_1", stripe_subscription_id: null };
    expect(await createPortalSessionAction("subscription_cancel")).toEqual({
      ok: false,
      error: "There's no active subscription to cancel.",
    });
    expect(s.portalCreate).not.toHaveBeenCalled();
  });
});
