import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findDelinquentSubscription,
  findLiveSubscription,
  grantCreditsForSync,
  pickPrimarySubscription,
  resolveSubscriptionTier,
  syncSubscriptionForUser,
  type SubscriptionLike,
} from "@/lib/stripe/subscription-sync";
import { MONTHLY_CREDITS, TRIAL_CREDITS } from "@/lib/billing/plans";

// ---------------------------------------------------------------------------
// Stubs. The admin stub records profile writes; the stripe stub serves a
// canned subscription list (or throws, to exercise the API-less path).
// ---------------------------------------------------------------------------

function makeAdmin(profile: Record<string, unknown> = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: table === "profiles" ? { id: "user-1", ...profile } : null,
                  error: null,
                }),
              };
            },
            // No refill rows this month (credit-refill.ts's LIKE read).
            like: async () => ({ data: [], error: null }),
          };
        },
        update(values: Record<string, unknown>) {
          return {
            eq: async () => {
              updates.push(values);
              return { error: null };
            },
          };
        },
      };
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: 0, error: null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, updates, rpcs };
}

function makeStripe(subs: SubscriptionLike[] | null, products: Record<string, unknown> = {}) {
  const stripe = {
    subscriptions: {
      list: async () => {
        if (subs === null) throw new Error("no api");
        return { data: subs };
      },
    },
    products: {
      retrieve: async (id: string) => {
        if (!(id in products)) throw new Error("no such product");
        return products[id];
      },
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stripe as any;
}

const PERIOD_END = 1893456000;
function sub(
  id: string,
  status: string,
  price: SubscriptionLike["items"]["data"][number]["price"],
  extra: Partial<SubscriptionLike> = {},
): SubscriptionLike {
  return {
    id,
    status,
    customer: "cus_1",
    created: 1,
    cancel_at_period_end: false,
    items: { data: [{ id: `si_${id}`, price, current_period_end: PERIOD_END }] },
    ...extra,
  };
}

beforeEach(() => {
  process.env.STRIPE_PRICE_PLUS_MONTHLY = "price_plus";
  process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro";
});
afterEach(() => {
  delete process.env.STRIPE_PRICE_PLUS_MONTHLY;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
});

describe("pickPrimarySubscription", () => {
  const tierOf = (s: SubscriptionLike) =>
    s.items.data[0]?.price?.id === "price_pro"
      ? ("pro" as const)
      : s.items.data[0]?.price?.id === "price_plus"
        ? ("plus" as const)
        : null;

  it("ignores lapsed subscriptions and prefers the highest live tier", () => {
    const trial = sub("sub_trial", "trialing", { id: "price_plus" }, { created: 1 });
    const pro = sub("sub_pro", "active", { id: "price_pro" }, { created: 2 });
    const dead = sub("sub_dead", "canceled", { id: "price_pro" }, { created: 3 });
    expect(pickPrimarySubscription([trial, pro, dead], tierOf)?.id).toBe("sub_pro");
    expect(pickPrimarySubscription([dead], tierOf)).toBeNull();
  });

  it("breaks ties by recency and ranks an unknown tier above Plus but below Pro", () => {
    const older = sub("sub_a", "active", { id: "price_plus" }, { created: 1 });
    const newer = sub("sub_b", "active", { id: "price_plus" }, { created: 2 });
    expect(pickPrimarySubscription([older, newer], tierOf)?.id).toBe("sub_b");

    const unknown = sub("sub_u", "active", { id: "price_mystery" }, { created: 1 });
    const plus = sub("sub_p", "active", { id: "price_plus" }, { created: 2 });
    const pro = sub("sub_x", "active", { id: "price_pro" }, { created: 0 });
    expect(pickPrimarySubscription([unknown, plus], tierOf)?.id).toBe("sub_u");
    expect(pickPrimarySubscription([unknown, pro], tierOf)?.id).toBe("sub_x");
  });
});

describe("resolveSubscriptionTier", () => {
  it("falls back to the product's name when the price itself is opaque", async () => {
    const stripe = makeStripe([], { prod_1: { id: "prod_1", name: "PipGlyph Pro" } });
    const s = sub("sub_1", "active", { id: "price_mystery", product: "prod_1" });
    expect(await resolveSubscriptionTier(s, stripe)).toBe("pro");
  });

  it("returns null when nothing about the price or product identifies a tier", async () => {
    const stripe = makeStripe([], { prod_1: { id: "prod_1", name: "Mystery" } });
    const s = sub("sub_1", "active", { id: "price_mystery", product: "prod_1" });
    expect(await resolveSubscriptionTier(s, stripe)).toBeNull();
  });
});

describe("syncSubscriptionForUser", () => {
  it("REGRESSION 2026-09-14: a portal plan switch to an unlisted Pro price maps by amount — never free", async () => {
    // The customer upgraded Plus trial → Pro through the Customer Portal.
    // The new price wasn't in STRIPE_PRICE_PRO_MONTHLY; the old handler
    // wrote tier=free, status=active.
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "trialing" });
    const event = sub("sub_1", "active", {
      id: "price_new_pro",
      unit_amount: 1500,
      recurring: { interval: "month" },
    });
    const result = await syncSubscriptionForUser(admin, makeStripe([event]), "user-1", {
      eventSub: event,
    });
    expect(result.tier).toBe("pro");
    expect(result.unresolvedPrice).toBe(false);
    expect(updates[0]).toMatchObject({
      subscription_tier: "pro",
      subscription_status: "active",
      stripe_subscription_id: "sub_1",
    });
  });

  it("never demotes an ACTIVE subscription whose price cannot be mapped", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "pro", subscription_status: "active" });
    const event = sub("sub_1", "active", { id: "price_mystery", unit_amount: 999, recurring: { interval: "month" } });
    const result = await syncSubscriptionForUser(admin, makeStripe([event]), "user-1", { eventSub: event });
    expect(result.tier).toBe("pro");
    expect(result.unresolvedPrice).toBe(true);
    expect(updates[0]).toMatchObject({ subscription_tier: "pro", subscription_status: "active" });

    // With no paid history at all, an active-but-unmapped subscriber gets
    // the lowest PAID tier — a paying customer must never land on free.
    const fresh = makeAdmin({ subscription_tier: "free", subscription_status: null });
    const r2 = await syncSubscriptionForUser(fresh.admin, makeStripe([event]), "user-1", { eventSub: event });
    expect(r2.tier).toBe("plus");
    expect(r2.unresolvedPrice).toBe(true);
  });

  it("a deleted event for a lingering trial does not demote the paid subscription", async () => {
    // Two subscriptions: the no-card Plus trial (now canceling) and the Pro
    // the customer bought. The trial's `deleted` event must resync to Pro.
    const { admin, updates } = makeAdmin({ subscription_tier: "pro", subscription_status: "active", stripe_subscription_id: "sub_pro" });
    const trial = sub("sub_trial", "trialing", { id: "price_plus" }, { created: 1 });
    const pro = sub("sub_pro", "active", { id: "price_pro" }, { created: 2 });
    const result = await syncSubscriptionForUser(
      admin,
      makeStripe([trial, pro]), // Stripe's list may still show the trial as live
      "user-1",
      { eventSub: trial, eventDeleted: true },
    );
    expect(result.subscriptionId).toBe("sub_pro");
    expect(result.tier).toBe("pro");
    expect(updates[0]).toMatchObject({
      subscription_tier: "pro",
      subscription_status: "active",
      stripe_subscription_id: "sub_pro",
    });
  });

  it("a deleted event with nothing else live downgrades to free/canceled", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "active" });
    const only = sub("sub_1", "active", { id: "price_plus" });
    const result = await syncSubscriptionForUser(admin, makeStripe([only]), "user-1", {
      eventSub: only,
      eventDeleted: true,
    });
    expect(result.tier).toBe("free");
    expect(updates[0]).toMatchObject({
      subscription_tier: "free",
      subscription_status: "canceled",
      stripe_subscription_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
    });
  });

  it("without the Stripe API (event-only), behaves like the single-subscription webhook", async () => {
    const { admin, updates } = makeAdmin();
    const event = sub("sub_1", "past_due", { id: "price_plus" }, { cancel_at_period_end: true });
    const result = await syncSubscriptionForUser(admin, makeStripe(null), "user-1", { eventSub: event });
    expect(result.source).toBe("event");
    expect(result.tier).toBe("plus");
    expect(updates[0]).toMatchObject({
      subscription_tier: "plus",
      subscription_status: "past_due",
      cancel_at_period_end: true,
    });
    expect(typeof updates[0].current_period_end).toBe("string");
  });

  it("a resync with no event picks the live primary from Stripe", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "free", subscription_status: "active", stripe_customer_id: "cus_1" });
    const pro = sub("sub_pro", "active", { id: "price_pro" });
    const result = await syncSubscriptionForUser(admin, makeStripe([pro]), "user-1");
    expect(result.source).toBe("primary");
    expect(updates[0]).toMatchObject({ subscription_tier: "pro", subscription_status: "active" });
  });
});

describe("grantCreditsForSync", () => {
  it("grants the synced tier's month, skips trials that aren't being created, skips lapsed", async () => {
    const { admin, rpcs } = makeAdmin();
    await grantCreditsForSync(
      { userId: "user-1", subscriptionId: "sub_1", tier: "pro", status: "active", unresolvedPrice: false, source: "primary" },
      admin,
      { isCreationEvent: false },
    );
    expect(rpcs[0]?.args).toMatchObject({ p_amount: MONTHLY_CREDITS.pro, p_reason: "subscription_refill" });

    const trial = makeAdmin();
    await grantCreditsForSync(
      { userId: "user-1", subscriptionId: "sub_1", tier: "plus", status: "trialing", unresolvedPrice: false, source: "event" },
      trial.admin,
      { isCreationEvent: false },
    );
    expect(trial.rpcs).toHaveLength(0);

    const lapsed = makeAdmin();
    await grantCreditsForSync(
      { userId: "user-1", subscriptionId: null, tier: "free", status: "canceled", unresolvedPrice: false, source: "event" },
      lapsed.admin,
      { isCreationEvent: true },
    );
    expect(lapsed.rpcs).toHaveLength(0);
  });

  it("a trial being CREATED gets the trial tranche under the month's base key — not the full allotment", async () => {
    const { admin, rpcs } = makeAdmin();
    await grantCreditsForSync(
      { userId: "user-1", subscriptionId: "sub_1", tier: "pro", status: "trialing", unresolvedPrice: false, source: "primary" },
      admin,
      { isCreationEvent: true },
    );
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].args).toMatchObject({ p_amount: TRIAL_CREDITS, p_reason: "trial_grant" });
    expect(String(rpcs[0].args.p_idempotency_key)).toMatch(/^refill:user-1:\d{4}-\d{2}$/);
  });
});

describe("findDelinquentSubscription", () => {
  it("returns the NEWEST past_due / unpaid / incomplete subscription, ignoring live and canceled ones", async () => {
    const canceled = sub("sub_c", "canceled", { id: "price_plus" }, { created: 9 });
    const older = sub("sub_old", "unpaid", { id: "price_plus" }, { created: 1 });
    const newer = sub("sub_new", "incomplete", { id: "price_pro" }, { created: 2 });
    expect((await findDelinquentSubscription(makeStripe([canceled, older, newer]), "cus_1"))?.id).toBe("sub_new");
    expect((await findDelinquentSubscription(makeStripe([sub("sub_pd", "past_due", { id: "price_pro" })]), "cus_1"))?.id).toBe("sub_pd");
    expect(await findDelinquentSubscription(makeStripe([sub("sub_ok", "active", { id: "price_pro" })]), "cus_1")).toBeNull();
    expect(await findDelinquentSubscription(makeStripe(null), "cus_1")).toBeNull();
  });
});

describe("findLiveSubscription", () => {
  it("returns the primary live subscription or null", async () => {
    const trial = sub("sub_trial", "trialing", { id: "price_plus" }, { created: 1 });
    const pro = sub("sub_pro", "active", { id: "price_pro" }, { created: 2 });
    expect((await findLiveSubscription(makeStripe([trial, pro]), "cus_1"))?.id).toBe("sub_pro");
    expect(await findLiveSubscription(makeStripe([sub("x", "canceled", { id: "price_pro" })]), "cus_1")).toBeNull();
    expect(await findLiveSubscription(makeStripe(null), "cus_1")).toBeNull();
  });
});
