import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    comp_tier?: string | null;
    comp_expires_at?: string | null;
  },
  adminConfigured: true,
  stripeConfigured: true,
  linkedId: "cus_new",
  /** What the conditional link write answers (null = no row matched:
   *  another request linked first, or the write was reverted). */
  linkWrite: "cus_new" as string | null,
  /** What the re-read of the profile's customer answers. */
  linkRead: null as string | null,
  customersDel: vi.fn(),
  lapsedTrial: false,
  live: null as null | {
    id: string;
    status: string;
    trial_end?: number | null;
    cancel_at_period_end?: boolean;
    cancel_at?: number | null;
    schedule?: string | null;
    default_payment_method?: string | null;
    metadata?: Record<string, string>;
    items: {
      data: Array<{ id?: string; price: { id: string; recurring?: { interval: string } } }>;
    };
  },
  delinquent: null as null | { id: string; status: string },
  // The checkout action's ONE read of the customer's list: null = unreadable.
  listUnreadable: false,
  // What the trial_lapsed row names, and whose subscription that is.
  lapsedSubscriptionId: "sub_lapsed",
  lapsedSubscriptionCustomer: "cus_1",
  lapsedRetrieveThrows: false,
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
  customersSearch: vi.fn(),
  bankCalls: [] as Array<{ userId: string; signupEligible: boolean }>,
  /** undefined = the default 7 signup days; null = nothing to apply. */
  bank: undefined as undefined | null | { batchId: string; days: number },
  bankEarned: null as null | { batchId: string; days: number },
  bankSettled: vi.fn<(admin: unknown, batchId: string, outcome: unknown) => Promise<{ ok: boolean; days: number }>>(async () => ({ ok: true, days: 0 })),
  bankStamped: [] as Array<{ batchId: string; sessionId: string }>,
  bankReclaimed: 0,
  /** Subscription history of OTHER Stripe customers under the same email. */
  otherHistory: [] as Array<{ id: string; status?: string }>,
  lapsedRedeemed: false,
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
      // The conditional customer link: UPDATE … WHERE stripe_customer_id IS NULL.
      update: () => ({
        eq: () => ({
          is: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: s.linkWrite ? { stripe_customer_id: s.linkWrite } : null,
                error: null,
              }),
            }),
          }),
        }),
      }),
      // The win-back eligibility read (a recent trial_lapsed notification),
      // and the profile re-read after a link write that landed nothing.
      select: (columns?: string) => {
        const chain = {
          eq: () => chain,
          gte: () => chain,
          limit: () => chain,
          maybeSingle: async () =>
            columns === "stripe_customer_id"
              ? { data: { stripe_customer_id: s.linkRead }, error: null }
              : {
                  data: s.lapsedTrial
                    ? { id: "n_lapsed", payload: { subscriptionId: s.lapsedSubscriptionId, ...(s.lapsedRedeemed ? { redeemedAt: "2026-11-01T00:00:00Z" } : {}) } }
                    : null,
                  error: null,
                },
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
    customers: { create: s.customersCreate, del: s.customersDel, search: s.customersSearch },
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
// The referral program is NO part of a checkout any more (owner 2026-11-11:
// a referral rewards the friend when their cards are saved, so nothing is
// banked ahead of a checkout — 0180's `preBankFriendDays` is gone). Every
// entry point the module has, or had, is a TRAP here: a checkout that
// reaches one throws, and the test below reads each as never called.
const referralServer = vi.hoisted(() => {
  const trap = (name: string) =>
    vi.fn<(...args: unknown[]) => Promise<never>>(async () => {
      throw new Error(`the checkout called lib/referrals/server ${name}()`);
    });
  return {
    preBankFriendDays: trap("preBankFriendDays"),
    advanceReferral: trap("advanceReferral"),
    qualifyReferral: trap("qualifyReferral"),
    noteReferralPlan: trap("noteReferralPlan"),
    rewardReferral: trap("rewardReferral"),
    recordReferralSignup: trap("recordReferralSignup"),
    sweepReferralRewards: trap("sweepReferralRewards"),
    grantOwedSides: trap("grantOwedSides"),
  };
});
vi.mock("@/lib/referrals/server", () => referralServer);
vi.mock("@/lib/stripe/config", () => ({
  priceIdForTier: (tier: string, period: string) => `price_${tier}_${period}`,
  priceIdForPack: (pack: string) => `price_pack_${pack}`,
}));
// The days bank (0179): the checkout asks it for the free period. The
// signup days answer when the one-free-period rule holds (`signupEligible`),
// earned days whatever the rule says (`s.bankEarned`).
vi.mock("@/lib/billing/day-bank", () => ({
  prepareCheckoutBank: async (_admin: unknown, userId: string, opts: { signupEligible: boolean; skipIfEndsBefore?: number | null }) => {
    s.bankCalls.push({ userId, signupEligible: opts.signupEligible });
    const bank = opts.signupEligible ? (s.bank === undefined ? { batchId: "bb_1", days: 7 } : s.bank) : s.bankEarned;
    // The real one leaves the days banked under a comp that outlasts them.
    if (bank && opts.skipIfEndsBefore != null && Math.floor(Date.now() / 1000) + bank.days * 86_400 <= opts.skipIfEndsBefore) return null;
    return bank;
  },
  settleBankBatch: (admin: unknown, batchId: string, outcome: unknown) => s.bankSettled(admin, batchId, outcome),
  stampBankBatchSession: async (_admin: unknown, batchId: string, sessionId: string) => {
    s.bankStamped.push({ batchId, sessionId });
  },
  reclaimOpenCheckouts: async () => {
    s.bankReclaimed += 1;
    return 0;
  },
}));
vi.mock("@/lib/stripe/subscription-sync", () => ({
  findCheckoutSubscriptions: async () => (s.listUnreadable ? null : { live: s.live, delinquent: s.delinquent }),
  findLiveSubscription: async () => s.live,
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
import { TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";
import { planRevoke } from "@/lib/billing/free-days";

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
  s.linkWrite = "cus_new";
  s.linkRead = null;
  s.customersDel.mockReset().mockResolvedValue({});
  s.live = null;
  s.lapsedTrial = false;
  s.funnelInserts = [];
  s.revalidated = [];
  s.syncSubscription.mockReset().mockResolvedValue({});
  s.delinquent = null;
  s.listUnreadable = false;
  s.lapsedSubscriptionId = "sub_lapsed";
  s.lapsedSubscriptionCustomer = "cus_1";
  s.lapsedRetrieveThrows = false;
  s.history = [];
  s.historyThrows = false;
  s.checkoutThrows = false;
  s.subscriptionsList.mockReset().mockImplementation(async (params?: { customer?: string }) => {
    if (s.historyThrows) throw new Error("stripe down");
    // Another Stripe customer under the same email (the per-email check).
    if (params?.customer && params.customer !== "cus_1" && params.customer !== s.linkWrite) return { data: s.otherHistory };
    return { data: s.history };
  });
  s.otherHistory = [];
  s.lapsedRedeemed = false;
  s.customersSearch.mockReset().mockResolvedValue({ data: [] });
  s.bankCalls = [];
  s.bank = undefined;
  s.bankEarned = null;
  s.bankSettled.mockClear();
  s.subscriptionsUpdate.mockReset().mockResolvedValue({});
  s.subscriptionsRetrieve.mockReset().mockImplementation(async (id: string) => {
    // The win-back check reads the subscription the trial_lapsed row names.
    if (id === s.lapsedSubscriptionId) {
      if (s.lapsedRetrieveThrows) throw new Error("stripe down");
      return { id, customer: s.lapsedSubscriptionCustomer };
    }
    return s.live;
  });
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
    return { id: "cs_test_1", url: "https://checkout.test/session" };
  });
  s.bankStamped = [];
  s.bankReclaimed = 0;
  s.portalCreate.mockReset().mockResolvedValue({ url: "https://portal.test/session" });
  for (const trap of Object.values(referralServer)) trap.mockClear();
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
    // The days bank IS the free period (0179): the 7 signup days as whole
    // days from the moment the checkout completes (`trial_period_days`,
    // never an instant a slow checkout eats into); the reservation rides in
    // the session metadata for the webhook to settle, and the session is
    // stamped on the batch so an abandoned Checkout can be reclaimed.
    expect(params.subscription_data).toMatchObject({
      metadata: { supabase_user_id: USER },
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
    expect(params.subscription_data).not.toHaveProperty("trial_end");
    expect(params.metadata).toMatchObject({ bank_batch: "bb_1", bank_days: "7" });
    expect(s.bankCalls).toEqual([{ userId: USER, signupEligible: true }]);
    expect(s.bankReclaimed).toBe(1);
    expect(s.bankStamped).toEqual([{ batchId: "bb_1", sessionId: "cs_test_1" }]);
    // Nothing superseded on a first subscription — only the purchase stamp.
    expect(params.metadata).not.toHaveProperty("supersedes_subscription_id");
    // Card required: Checkout's default collection, never `if_required`.
    expect(params).not.toHaveProperty("payment_method_collection");
    expect(params.metadata).toMatchObject({ discount: "none" });
    // The card networks' trial terms, under Checkout's button (BA6): the end
    // date, what is charged from then, how to cancel.
    expect(params.custom_text).toEqual({
      // The LENGTH, never a date: Checkout's summary prints the date in the buyer's zone.
      submit: { message: "Your free trial lasts 7 days and ends on the date in the order summary. From then, Pro is $15 a month, charged to this card until you cancel. Cancel any time before then on your billing page and nothing is charged." },
    });
    // One trial per EMAIL: every Stripe customer under the address was asked.
    expect(s.customersSearch).toHaveBeenCalledWith({ query: 'email:"x@example.test"', limit: 20 });
    // Funnel: the click became a checkout_started row, and its id rides in the
    // session metadata so the webhook can tie completion back to it.
    expect(s.funnelInserts).toEqual([
      { event: "checkout_started", user_id: USER, props: { kind: "subscription", tier: "pro", period: "monthly", trial: true, bankDays: 7, discount: "none" }, source: "server" },
    ]);
    expect(params.metadata).toMatchObject({ funnel_id: "fe_1" });
  });

  it("gives no second trial once Stripe has ANY subscription on record", async () => {
    s.history = [{ id: "sub_old" }];
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus", period: "annual" });
    const params = checkoutParams();
    expect(params.line_items).toEqual([{ price: "price_plus_annual", quantity: 1 }]);
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params.subscription_data).not.toHaveProperty("trial_end");
    // The signup days are judged NOT owed — the bank revokes them.
    expect(s.bankCalls).toEqual([{ userId: USER, signupEligible: false }]);
    expect(params).not.toHaveProperty("payment_method_collection");
    // No free period → no trial terms under the button.
    expect(params).not.toHaveProperty("custom_text");
  });

  it("one trial per EMAIL (audit 2026-11-05 P3): a deleted account's old Stripe customer under the same address denies the trial; Stripe's word match is narrowed to the exact address", async () => {
    s.customersSearch.mockResolvedValue({
      data: [
        { id: "cus_old", email: "X@example.test" },
        { id: "cus_1", email: "x@example.test" },
        // Stripe's exact match is a WORD match: these come back too and must not count.
        { id: "cus_near", email: "a.x@example.test" },
        { id: "cus_gone", email: "x@example.test", deleted: true },
      ],
    });
    s.otherHistory = [{ id: "sub_from_deleted_account", status: "canceled" }];
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(checkoutParams().subscription_data).not.toHaveProperty("trial_period_days");
    expect(checkoutParams()).not.toHaveProperty("custom_text");
    const asked = s.subscriptionsList.mock.calls.map((c) => c[0]?.customer);
    expect(asked).toContain("cus_old");
    expect(asked).not.toContain("cus_near");
    expect(asked).not.toContain("cus_gone");
    // The customer's own id is asked once (the first read), never again from the search.
    expect(asked.filter((c) => c === "cus_1")).toHaveLength(1);

    // A near-miss alone (a.x@…) denies nothing — the first-timer keeps the trial.
    s.checkoutCreate.mockClear();
    s.subscriptionsList.mockClear();
    s.customersSearch.mockResolvedValue({ data: [{ id: "cus_near", email: "a.x@example.test" }] });
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(checkoutParams().subscription_data).toMatchObject({ trial_period_days: expect.any(Number) });
    expect(s.subscriptionsList.mock.calls.map((c) => c[0]?.customer)).toEqual(["cus_1"]);

    // The address is lowercased and a double quote escaped in Stripe's documented shape.
    s.checkoutCreate.mockClear();
    s.customersSearch.mockResolvedValue({ data: [] });
    s.user = { id: USER, email: 'O"Brien@Example.test' };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(s.customersSearch).toHaveBeenLastCalledWith({ query: 'email:"o\\"brien@example.test"', limit: 20 });
    expect(checkoutParams().subscription_data).toMatchObject({ trial_period_days: expect.any(Number) });

    // The email search failing is "unknown": the checkout waits (P1-1).
    s.checkoutCreate.mockClear();
    s.customersSearch.mockRejectedValue(new Error("search down"));
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/Couldn't check your free days/) });
    expect(s.checkoutCreate).not.toHaveBeenCalled();
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

  it("a COMPED user who subscribes is charged only when the comp ends (owner rule 2026-10-30)", async () => {
    const compEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const compEndSec = Math.floor(Date.parse(compEnd) / 1000);
    // Trial-eligible: the comp's end is later than the bank's 7 days, so the
    // comp holds the first charge and the days STAY BANKED (check P1-3) —
    // never spent inside a period that was free anyway.
    s.profile = { stripe_customer_id: "cus_1", comp_tier: "pro", comp_expires_at: compEnd };
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    let params = checkoutParams();
    expect(params.subscription_data).toMatchObject({
      trial_end: compEndSec,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
    });
    expect(params.subscription_data).not.toHaveProperty("trial_period_days");
    expect(params.metadata).not.toHaveProperty("bank_batch");
    expect(params).not.toHaveProperty("payment_method_collection");
    // Not trial-eligible: the comp alone holds the first charge.
    s.checkoutCreate.mockClear();
    s.history = [{ id: "sub_old", status: "canceled" }];
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    params = checkoutParams();
    expect(params.subscription_data).toMatchObject({ trial_end: compEndSec });
    // A plan ABOVE the comp is bought now: no hold.
    s.checkoutCreate.mockClear();
    s.profile = { stripe_customer_id: "cus_1", comp_tier: "plus", comp_expires_at: compEnd };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    params = checkoutParams();
    expect(params.subscription_data).not.toHaveProperty("trial_end");
  });

  it("a comp hold names the trial end it would have had WITHOUT the comp, so revoking the free days releases it (finding 1)", async () => {
    const compEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const compEndSec = Math.floor(Date.parse(compEnd) / 1000);
    const nowSec = () => Math.floor(Date.now() / 1000);

    // Not trial-eligible (a former subscriber): the hold's "own end" is the
    // checkout itself — clearing the comp ends the trial NOW and charges.
    s.history = [{ id: "sub_old", status: "canceled" }];
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled", comp_tier: "plus", comp_expires_at: compEnd };
    const before = nowSec();
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    let data = checkoutParams().subscription_data as { trial_end: number; metadata: Record<string, string> };
    expect(data.trial_end).toBe(compEndSec);
    const own = Number(data.metadata[TRIAL_END_BEFORE_COMP_KEY]);
    expect(own).toBeGreaterThanOrEqual(before);
    expect(own).toBeLessThanOrEqual(nowSec());
    expect(data.metadata.supabase_user_id).toBe(USER);
    // The subscription Stripe creates from it, then the admin REVOKES the
    // 30-day grant behind the comp (lib/billing/free-days.ts): the trial goes
    // back to its own end — the checkout itself, which has passed — so it
    // ends NOW and charges.
    const grant = { id: "g1", tier: "plus" as const, units: 1, ends_at: compEnd, status: "applied" };
    let sub = { id: "sub_new", status: "trialing", trial_end: data.trial_end, metadata: data.metadata };
    expect(planRevoke({ grant, profile: s.profile, sub, otherGrants: [] })).toEqual({
      kind: "revoke",
      overlay: { comp_tier: null, comp_expires_at: null },
      trial: { subscriptionId: "sub_new", trialEnd: "now", beforeComp: "" },
    });

    // Trial-eligible: the bank's 7 days end inside the comp, so they stay
    // banked and the hold's own end is the checkout itself too — clearing
    // the comp charges now, and the user still has their banked days.
    s.checkoutCreate.mockClear();
    s.history = [];
    s.profile = { stripe_customer_id: "cus_1", comp_tier: "plus", comp_expires_at: compEnd };
    const before2 = nowSec();
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    data = checkoutParams().subscription_data as { trial_end: number; metadata: Record<string, string> };
    expect(data.trial_end).toBe(compEndSec);
    const own2 = Number(data.metadata[TRIAL_END_BEFORE_COMP_KEY]);
    expect(own2).toBeGreaterThanOrEqual(before2);
    expect(own2).toBeLessThanOrEqual(nowSec());
    expect(checkoutParams().metadata).not.toHaveProperty("bank_batch");
    sub = { id: "sub_new", status: "trialing", trial_end: data.trial_end, metadata: data.metadata };
    expect(planRevoke({ grant, profile: s.profile, sub, otherGrants: [] })).toMatchObject({
      kind: "revoke",
      trial: { subscriptionId: "sub_new", trialEnd: "now", beforeComp: "" },
    });

    // No comp: no hold, no metadata key.
    s.checkoutCreate.mockClear();
    s.profile = { stripe_customer_id: "cus_1" };
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect((checkoutParams().subscription_data as { metadata: Record<string, string> }).metadata).toEqual({ supabase_user_id: USER });
  });

  it("the terms line says 'complimentary period' only when the COMP sets the end — a comp shorter than the 7-day trial leaves a plain trial (check P3-2)", async () => {
    s.profile = { stripe_customer_id: "cus_1", comp_tier: "pro", comp_expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString() };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect((checkoutParams().custom_text as { submit: { message: string } }).submit.message).toMatch(/^Your free trial lasts 7 days and ends on the date in the order summary\./);
    s.checkoutCreate.mockClear();
    s.profile = { stripe_customer_id: "cus_1", comp_tier: "pro", comp_expires_at: new Date(Date.now() + 40 * 86_400_000).toISOString() };
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect((checkoutParams().custom_text as { submit: { message: string } }).submit.message).toMatch(/^Your complimentary period lasts 40 days and ends on the date in the order summary\./);
  });

  it("a comp that ends BEFORE the bank's days: the bank is the free period and the comp holds nothing", async () => {
    // 3 days out, inside the bank's 7.
    s.profile = {
      stripe_customer_id: "cus_1",
      comp_tier: "plus",
      comp_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    };
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    const data = checkoutParams().subscription_data as { trial_period_days: number; metadata: Record<string, string> };
    expect(data.trial_period_days).toBe(TRIAL_DAYS);
    expect(data).not.toHaveProperty("trial_end");
    expect(checkoutParams().metadata).toMatchObject({ bank_batch: "bb_1" });
    // No hold: nothing to move when the comp is cleared, no key.
    expect(data.metadata).toEqual({ supabase_user_id: USER });
  });

  it("never spends the win-back coupon on a comp hold's $0 first invoice (finding 6)", async () => {
    s.history = [{ id: "sub_old", status: "canceled" }];
    s.lapsedTrial = true;
    s.profile = {
      stripe_customer_id: "cus_1",
      subscription_status: "canceled",
      comp_tier: "plus",
      comp_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    const params = checkoutParams();
    expect(params).not.toHaveProperty("discounts");
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.metadata).toMatchObject({ discount: "none" });
    // The same lapsed former trialist with no comp still gets it.
    s.checkoutCreate.mockClear();
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(checkoutParams().discounts).toEqual([{ coupon: TRIAL_WINBACK_COUPON_ID }]);
  });

  it("REFUSES the checkout when Stripe's history can't be read — never a verdict on a hiccup (check P1-1: a revoked signup entry is for good)", async () => {
    // In production the checkout refuses before this branch (the same list
    // read fails first — see the "REFUSES to sell" case); the mock answers
    // the checkout read and lets the trial read throw on its own, so the
    // trial rule's failure mode is still pinned.
    s.historyThrows = true;
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(result).toEqual({ ok: false, error: "Couldn't check your free days with Stripe. Try again in a moment." });
    expect(s.checkoutCreate).not.toHaveBeenCalled();
    // The bank was never asked: the signup entry is neither made nor revoked.
    expect(s.bankCalls).toEqual([]);
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

  it("a PAYING plan under free days (trialing + pipglyph_hold_from = active): a DOWNGRADE is scheduled for the free days' end, an upgrade switches now through the portal (0176)", async () => {
    const held = {
      id: "sub_held",
      status: "trialing",
      trial_end: Math.floor(Date.now() / 1000) + 40 * 24 * 60 * 60,
      default_payment_method: "pm_1",
      metadata: { pipglyph_hold_from: "active" },
      items: { data: [{ id: "si_1", price: { id: "price_pro_monthly", recurring: { interval: "month" } } }] },
    };
    s.live = held;
    const down = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(down).toEqual({ ok: true, url: "https://test.local/dashboard/billing?billing=scheduled" });
    expect(s.scheduleCreate).toHaveBeenCalledWith({ from_subscription: "sub_held" });
    expect(s.portalCreate).not.toHaveBeenCalled();
    expect(s.checkoutCreate).not.toHaveBeenCalled();

    s.scheduleCreate.mockClear();
    s.live = { ...held, items: { data: [{ id: "si_1", price: { id: "price_plus_monthly", recurring: { interval: "month" } } }] } };
    const up = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(up).toEqual({ ok: true, url: "https://portal.test/session" });
    expect(s.portalCreate.mock.calls[0]?.[0]).toMatchObject({ flow_data: { type: "subscription_update_confirm" } });
    expect(s.scheduleCreate).not.toHaveBeenCalled();
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

  it("win-back: MONTHLY plans only (a `once` coupon on a year took 20 % off the year), and a row already redeemed is spent (BA6)", async () => {
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    s.history = [{ id: "sub_old_trial", status: "canceled" }];
    s.lapsedTrial = true;
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro", period: "annual" });
    expect(checkoutParams()).not.toHaveProperty("discounts");
    expect(checkoutParams().metadata?.discount).toBe("none");
    expect(checkoutParams().allow_promotion_codes).toBe(true);

    s.checkoutCreate.mockClear();
    s.lapsedRedeemed = true;
    await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(checkoutParams()).not.toHaveProperty("discounts");
    expect(checkoutParams().metadata?.discount).toBe("none");
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

  it("the days bank: an account that trialled before checks out its EARNED days as a free period (owner 2026-11-06), and nothing banked means no free period", async () => {
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    s.history = [{ id: "sub_old_trial", status: "canceled" }];
    s.bankEarned = { batchId: "bb_2", days: 5 };
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    const data = checkoutParams().subscription_data as { trial_period_days: number };
    expect(data.trial_period_days).toBe(5);
    expect(checkoutParams().metadata).toMatchObject({ bank_batch: "bb_2", bank_days: "5" });
    expect(checkoutParams().custom_text).toEqual({ submit: { message: expect.stringMatching(/^Your free trial lasts 5 days/) } });
    expect(s.bankCalls).toEqual([{ userId: USER, signupEligible: false }]);

    s.checkoutCreate.mockClear();
    s.bankStamped = [];
    s.bankEarned = null;
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(checkoutParams().subscription_data).not.toHaveProperty("trial_end");
    expect(checkoutParams().subscription_data).not.toHaveProperty("trial_period_days");
    expect(checkoutParams()).not.toHaveProperty("custom_text");
    expect(s.bankStamped).toEqual([]);
    expect(checkoutParams().metadata).not.toHaveProperty("bank_batch");
  });

  // Owner 2026-11-11: the referral rewards a friend on their cards alone, so
  // their days are in the bank before any checkout (or arrive later and are
  // applied from the billing page). 0180 banked them from INSIDE the checkout
  // (`preBankFriendDays(admin, userId)`, before the bank was reserved); that
  // call and its import are gone.
  it("a checkout does nothing for the referral program: lib/referrals/server is not imported and none of its entry points runs — the bank is prepared as for anyone", async () => {
    // A first subscription with the signup days, and one checking out earned
    // days (where a referred friend's days sit): the two paths that reserve
    // the bank.
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).toEqual({ ok: true, url: "https://checkout.test/session" });
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    s.history = [{ id: "sub_old_trial", status: "canceled" }];
    s.bankEarned = { batchId: "bb_2", days: 7 };
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "plus" })).toEqual({ ok: true, url: "https://checkout.test/session" });
    // …and a pack, which never touched it.
    expect((await createCheckoutSessionAction({ kind: "pack", pack: "small" })).ok).toBe(true);

    for (const [name, trap] of Object.entries(referralServer)) expect(trap, name).not.toHaveBeenCalled();
    // The bank is asked once per subscription checkout, after the open
    // checkouts are reclaimed — nothing was banked first.
    expect(s.bankCalls).toEqual([
      { userId: USER, signupEligible: true },
      { userId: USER, signupEligible: false },
    ]);
    expect(s.bankReclaimed).toBe(2);
    expect(s.checkoutCreate.mock.calls.map((c) => (c[0] as { metadata: Record<string, string> }).metadata.bank_batch)).toEqual(["bb_1", "bb_2", undefined]);

    // The import is gone, not only unused on these paths.
    const source = readFileSync(join(process.cwd(), "lib/stripe/actions.ts"), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(source).not.toMatch(/lib\/referrals\/server/);
    expect(source).not.toMatch(/preBankFriendDays|advanceReferral|noteReferralPlan|qualifyReferral/);
  });

  it("the days bank: a Checkout that can't be created hands the reserved days straight back", async () => {
    s.checkoutCreate.mockReset().mockRejectedValue(new Error("stripe down"));
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(result.ok).toBe(false);
    expect(s.bankSettled).toHaveBeenCalledWith(expect.anything(), "bb_1", { kind: "banked" });
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

  it("REFUSES to sell when the customer's subscription list can't be read (audit 2026-11-05 P1-2)", async () => {
    // An active Pro subscriber clicks "Switch to Plus" during a Stripe
    // hiccup: "nothing found" because nothing could be read used to fall
    // through to a fresh checkout — a second subscription, charged at once.
    s.listUnreadable = true;
    s.live = null;
    s.delinquent = null;
    const result = await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(result).toEqual({ ok: false, error: "Couldn't check your plan with Stripe. Try again in a moment." });
    expect(s.checkoutCreate).not.toHaveBeenCalled();
    expect(s.portalCreate).not.toHaveBeenCalled();
    expect(s.scheduleCreate).not.toHaveBeenCalled();
    expect(s.funnelInserts).toEqual([]);
  });

  it("the win-back discount needs a trial_lapsed row naming the buyer's OWN subscription (audit 2026-11-05 P1-1)", async () => {
    s.profile = { stripe_customer_id: "cus_1", subscription_status: "canceled" };
    s.lapsedTrial = true;
    // Another customer's subscription in the payload: full price.
    s.lapsedSubscriptionCustomer = "cus_someone_else";
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(checkoutParams()).not.toHaveProperty("discounts");
    expect(checkoutParams().allow_promotion_codes).toBe(true);

    // Stripe can't be read: full price, never a discount on a guess.
    s.checkoutCreate.mockClear();
    s.lapsedSubscriptionCustomer = "cus_1";
    s.lapsedRetrieveThrows = true;
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(checkoutParams()).not.toHaveProperty("discounts");

    // A row with no subscription in it (nothing the webhook writes): full price.
    s.checkoutCreate.mockClear();
    s.lapsedRetrieveThrows = false;
    s.lapsedSubscriptionId = "";
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(checkoutParams()).not.toHaveProperty("discounts");

    // The buyer's own lapsed trial: the discount.
    s.checkoutCreate.mockClear();
    s.lapsedSubscriptionId = "sub_lapsed";
    await createCheckoutSessionAction({ kind: "subscription", tier: "plus" });
    expect(checkoutParams().discounts).toEqual([{ coupon: TRIAL_WINBACK_COUPON_ID }]);
    expect(s.subscriptionsRetrieve).toHaveBeenCalledWith("sub_lapsed");
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
    s.linkWrite = null; // nothing landed (a trigger revert reports no error)…
    s.linkRead = null; // …and the re-read shows no customer either: refuse
    expect(await createCheckoutSessionAction({ kind: "subscription", tier: "pro" })).toEqual({
      ok: false,
      error: "Couldn't link your billing account. Try again.",
    });
    expect(s.checkoutCreate).not.toHaveBeenCalled();
    expect(s.customersDel).not.toHaveBeenCalled();

    // Two checkouts at once (audit 2026-11-05, P2-7): the other request's
    // customer was linked first — use it and let the freshly minted one go.
    s.linkWrite = null;
    s.linkRead = "cus_first";
    const raced = await createCheckoutSessionAction({ kind: "subscription", tier: "pro" });
    expect(raced.ok).toBe(true);
    expect(checkoutParams().customer).toBe("cus_first");
    expect(s.customersDel).toHaveBeenCalledWith("cus_new");

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

    // A PAYING plan under a free-days hold reads trialing (lib/billing/free-days.ts): still a subscriber.
    s.checkoutCreate.mockClear();
    s.live = { id: "sub_held", status: "trialing", metadata: { pipglyph_hold_from: "active" }, items: { data: [{ id: "si_1", price: { id: "price_plus_monthly" } }] } };
    await createCheckoutSessionAction({ kind: "pack", pack: "large" });
    expect(checkoutParams().metadata).toMatchObject({ discount: "subscriber" });
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
