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

  it("a portal cancellation that sets only cancel_at (flag false) is stored as ending", async () => {
    // The Customer Portal / newer API versions write a cancellation DATE and
    // can leave cancel_at_period_end false. On main the profile kept
    // cancel_at_period_end=false and Settings said "Renews on".
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "active" });
    const cancelled = sub("sub_1", "active", { id: "price_plus" }, { cancel_at_period_end: false, cancel_at: PERIOD_END });
    await syncSubscriptionForUser(admin, makeStripe([cancelled]), "user-1", { eventSub: cancelled });
    expect(updates[0]).toMatchObject({ subscription_status: "active", cancel_at_period_end: true });
  });

  it("a cancel_at in a LATER period is not 'ends at this period end' (it renews first)", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "active" });
    const later = sub("sub_1", "active", { id: "price_plus" }, { cancel_at: PERIOD_END + 45 * 86400 });
    await syncSubscriptionForUser(admin, makeStripe([later]), "user-1", { eventSub: later });
    expect(updates[0]).toMatchObject({ cancel_at_period_end: false });
  });

  it("resuming (cancel_at cleared) clears the flag", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "active" });
    const resumed = sub("sub_1", "active", { id: "price_plus" }, { cancel_at: null });
    await syncSubscriptionForUser(admin, makeStripe([resumed]), "user-1", { eventSub: resumed });
    expect(updates[0]).toMatchObject({ cancel_at_period_end: false });
  });

  it("stores WHEN a cancelled plan stops and when it was cancelled (0135) — the pages that read only the profile need the date", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "active" });
    const cancelled = sub("sub_1", "active", { id: "price_plus" }, { cancel_at: PERIOD_END, canceled_at: PERIOD_END - 86400 });
    const result = await syncSubscriptionForUser(admin, makeStripe([cancelled]), "user-1", { eventSub: cancelled });
    expect(updates[0]).toMatchObject({
      cancel_at_period_end: true,
      subscription_ends_at: new Date(PERIOD_END * 1000).toISOString(),
      subscription_canceled_at: new Date((PERIOD_END - 86400) * 1000).toISOString(),
    });
    expect(result.endsAt).toBe(new Date(PERIOD_END * 1000).toISOString());
  });

  it("a later-period cancellation keeps the flag false but stores its date; a renewing plan stores nulls", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "active" });
    const later = sub("sub_1", "active", { id: "price_plus" }, { cancel_at: PERIOD_END + 45 * 86400 });
    await syncSubscriptionForUser(admin, makeStripe([later]), "user-1", { eventSub: later });
    expect(updates[0]).toMatchObject({
      cancel_at_period_end: false,
      subscription_ends_at: new Date((PERIOD_END + 45 * 86400) * 1000).toISOString(),
    });
    // A stale canceled_at on a plan that renews is not a cancellation.
    const renewing = sub("sub_1", "active", { id: "price_plus" }, { cancel_at: null, canceled_at: 123 });
    await syncSubscriptionForUser(admin, makeStripe([renewing]), "user-1", { eventSub: renewing });
    expect(updates[1]).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: null, subscription_canceled_at: null });
  });

  it("a cancelled TRIAL's date is the trial end; a deleted or past-due subscription stores no pending cancellation", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "trialing" });
    const trial = sub("sub_1", "trialing", { id: "price_plus" }, { cancel_at_period_end: true, trial_end: PERIOD_END - 5 * 86400 });
    await syncSubscriptionForUser(admin, makeStripe([trial]), "user-1", { eventSub: trial });
    expect(updates[0]).toMatchObject({ subscription_ends_at: new Date((PERIOD_END - 5 * 86400) * 1000).toISOString() });
    const gone = sub("sub_1", "canceled", { id: "price_plus" }, { cancel_at: PERIOD_END });
    await syncSubscriptionForUser(admin, makeStripe([gone]), "user-1", { eventSub: gone, eventDeleted: true });
    expect(updates[1]).toMatchObject({ subscription_status: "canceled", subscription_ends_at: null, subscription_canceled_at: null });
    const pastDue = sub("sub_1", "past_due", { id: "price_plus" }, { cancel_at: PERIOD_END });
    await syncSubscriptionForUser(admin, makeStripe([pastDue]), "user-1", { eventSub: pastDue });
    expect(updates[2]).toMatchObject({ subscription_status: "past_due", subscription_ends_at: null });
  });

  it("a resync with no event picks the live primary from Stripe", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "free", subscription_status: "active", stripe_customer_id: "cus_1" });
    const pro = sub("sub_pro", "active", { id: "price_pro" });
    const result = await syncSubscriptionForUser(admin, makeStripe([pro]), "user-1");
    expect(result.source).toBe("primary");
    expect(updates[0]).toMatchObject({ subscription_tier: "pro", subscription_status: "active" });
  });
});

// ---------------------------------------------------------------------------
// Event order (2026-10-07). Stripe neither delivers events in the order it
// generates them nor delivers each once — https://docs.stripe.com/webhooks
// #event-ordering — so an event names the subscription and Stripe's CURRENT
// state is what gets written. `makeLiveStripe` is Stripe "now": what a list
// and a retrieve answer, whatever snapshot the event carries.
// ---------------------------------------------------------------------------

function makeLiveStripe(opts: {
  /** What `subscriptions.list` answers (null = the call fails). */
  list: SubscriptionLike[] | null;
  /** What `subscriptions.retrieve` answers by id (absent = the call fails). */
  byId?: Record<string, SubscriptionLike>;
}) {
  const retrieved: string[] = [];
  const stripe = {
    subscriptions: {
      list: async () => {
        if (opts.list === null) throw new Error("no api");
        return { data: opts.list };
      },
      retrieve: async (id: string) => {
        retrieved.push(id);
        const found = opts.byId?.[id];
        if (!found) throw new Error("no such subscription");
        return found;
      },
    },
    products: { retrieve: async () => { throw new Error("no such product") } },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { stripe: stripe as any, retrieved };
}
/** Stripe "now" holding exactly these subscriptions, in both reads. */
const stripeNow = (...subs: SubscriptionLike[]) =>
  makeLiveStripe({ list: subs, byId: Object.fromEntries(subs.map((s) => [s.id, s])) });

describe("syncSubscriptionForUser — event order", () => {
  const PLUS = { id: "price_plus" };
  const ENDS = new Date(PERIOD_END * 1000).toISOString();
  const cancelledSnap = () =>
    sub("sub_1", "active", PLUS, { cancel_at: PERIOD_END, canceled_at: PERIOD_END - 86400 });
  const renewingSnap = () => sub("sub_1", "active", PLUS, { cancel_at: null, canceled_at: null });
  const paid = { subscription_tier: "plus", subscription_status: "active", stripe_subscription_id: "sub_1" };

  it("cancel then resume, delivered IN order: ending, then renews", async () => {
    const { admin, updates } = makeAdmin(paid);
    // 1. the cancellation's event, while Stripe says cancelled
    await syncSubscriptionForUser(admin, stripeNow(cancelledSnap()).stripe, "user-1", { eventSub: cancelledSnap() });
    expect(updates[0]).toMatchObject({ cancel_at_period_end: true, subscription_ends_at: ENDS });
    // 2. the resume's event, while Stripe says renewing
    await syncSubscriptionForUser(admin, stripeNow(renewingSnap()).stripe, "user-1", { eventSub: renewingSnap() });
    expect(updates[1]).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: null, subscription_canceled_at: null });
  });

  it("cancel then resume, delivered OUT of order: the late cancellation event does not store 'ending'", async () => {
    const { admin, updates } = makeAdmin(paid);
    // Stripe has been "renewing" since the resume; both events arrive after it.
    const now = () => stripeNow(renewingSnap()).stripe;
    await syncSubscriptionForUser(admin, now(), "user-1", { eventSub: renewingSnap() });
    await syncSubscriptionForUser(admin, now(), "user-1", { eventSub: cancelledSnap() });
    for (const write of updates) {
      expect(write).toMatchObject({
        subscription_status: "active",
        cancel_at_period_end: false,
        subscription_ends_at: null,
        subscription_canceled_at: null,
      });
    }
    expect(updates).toHaveLength(2);
  });

  it("a RETRY of the old cancellation event, long after the resume, changes nothing", async () => {
    const { admin, updates } = makeAdmin(paid);
    const { stripe, retrieved } = stripeNow(renewingSnap());
    const result = await syncSubscriptionForUser(admin, stripe, "user-1", { eventSub: cancelledSnap() });
    expect(retrieved).toEqual(["sub_1"]); // the object was fetched, not trusted from the event
    expect(result.endsAt).toBeNull();
    expect(updates[0]).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: null });
  });

  it("the read by id beats a LIST that still shows the old state", async () => {
    const { admin, updates } = makeAdmin(paid);
    const stripe = makeLiveStripe({ list: [cancelledSnap()], byId: { sub_1: renewingSnap() } }).stripe;
    await syncSubscriptionForUser(admin, stripe, "user-1", { eventSub: cancelledSnap() });
    expect(updates[0]).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: null });
  });

  it("the reverse race: a late RESUME-era event after a new cancellation stores 'ending'", async () => {
    const { admin, updates } = makeAdmin(paid);
    await syncSubscriptionForUser(admin, stripeNow(cancelledSnap()).stripe, "user-1", { eventSub: renewingSnap() });
    expect(updates[0]).toMatchObject({ cancel_at_period_end: true, subscription_ends_at: ENDS });
  });

  it("deleted: the event wins even when Stripe's reads still show the subscription live", async () => {
    const { admin, updates } = makeAdmin(paid);
    const live = renewingSnap();
    const result = await syncSubscriptionForUser(admin, stripeNow(live).stripe, "user-1", {
      eventSub: { ...live, status: "canceled" },
      eventDeleted: true,
    });
    expect(result).toMatchObject({ tier: "free", status: "canceled", subscriptionId: null });
    expect(updates[0]).toMatchObject({
      subscription_tier: "free",
      subscription_status: "canceled",
      stripe_subscription_id: null,
      current_period_end: null,
      subscription_ends_at: null,
    });
  });

  it("an old `updated` event arriving AFTER the deletion does not bring the plan back", async () => {
    // On main the event's "active" snapshot was merged over the list and the
    // profile went back to a live Plus plan — for good, a dead subscription
    // sends no further event.
    const { admin, updates } = makeAdmin({ subscription_tier: "free", subscription_status: "canceled", stripe_subscription_id: null });
    const gone = sub("sub_1", "canceled", PLUS);
    const result = await syncSubscriptionForUser(admin, stripeNow(gone).stripe, "user-1", { eventSub: cancelledSnap() });
    expect(result).toMatchObject({ tier: "free", status: "canceled", subscriptionId: null });
    expect(updates[0]).toMatchObject({
      subscription_tier: "free",
      subscription_status: "canceled",
      stripe_subscription_id: null,
    });
  });

  it("…and that late event never demotes a customer whose OTHER subscription is live", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "pro", subscription_status: "active", stripe_subscription_id: "sub_pro" });
    const gone = sub("sub_1", "canceled", PLUS, { created: 1 });
    const pro = sub("sub_pro", "active", { id: "price_pro" }, { created: 2 });
    const result = await syncSubscriptionForUser(admin, stripeNow(gone, pro).stripe, "user-1", { eventSub: cancelledSnap() });
    expect(result).toMatchObject({ tier: "pro", subscriptionId: "sub_pro", source: "primary" });
    expect(updates[0]).toMatchObject({ subscription_tier: "pro", subscription_status: "active", stripe_subscription_id: "sub_pro" });
  });

  it("a late event for the PRIMARY subscription cannot hand the profile to a lower one", async () => {
    // Old snapshot: the Pro was past_due. Now: it is active again.
    const { admin, updates } = makeAdmin({ subscription_tier: "pro", subscription_status: "active" });
    const plus = sub("sub_plus", "active", PLUS, { created: 1 });
    const pro = sub("sub_pro", "active", { id: "price_pro" }, { created: 2 });
    await syncSubscriptionForUser(admin, stripeNow(plus, pro).stripe, "user-1", {
      eventSub: { ...pro, status: "past_due" },
    });
    expect(updates[0]).toMatchObject({ subscription_tier: "pro", stripe_subscription_id: "sub_pro" });
  });

  it("created: a subscription the list does not show yet is read by id", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "free", subscription_status: null });
    const created = sub("sub_new", "active", { id: "price_pro" });
    const stripe = makeLiveStripe({ list: [], byId: { sub_new: created } }).stripe;
    const result = await syncSubscriptionForUser(admin, stripe, "user-1", { eventSub: created });
    expect(result).toMatchObject({ tier: "pro", status: "active", subscriptionId: "sub_new", source: "primary" });
    expect(updates[0]).toMatchObject({ subscription_tier: "pro", stripe_subscription_id: "sub_new" });
  });

  it("created: when neither read knows it yet, the event's snapshot still starts the plan (never a silent no-op)", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "free", subscription_status: null });
    const created = sub("sub_new", "trialing", PLUS, { trial_end: PERIOD_END });
    const stripe = makeLiveStripe({ list: [] }).stripe;
    const result = await syncSubscriptionForUser(admin, stripe, "user-1", { eventSub: created });
    expect(result).toMatchObject({ tier: "plus", status: "trialing", subscriptionId: "sub_new" });
    expect(updates[0]).toMatchObject({ subscription_tier: "plus", subscription_status: "trialing" });
  });

  it("trial: a late `created` (trialing) event after the trial converted writes active, and grants the month — not a second trial tranche", async () => {
    const { admin, updates, rpcs } = makeAdmin({ subscription_tier: "plus", subscription_status: "active" });
    const converted = sub("sub_1", "active", PLUS, { trial_end: PERIOD_END - 30 * 86400 });
    const result = await syncSubscriptionForUser(admin, stripeNow(converted).stripe, "user-1", {
      eventSub: { ...converted, status: "trialing" },
    });
    expect(updates[0]).toMatchObject({ subscription_status: "active" });
    await grantCreditsForSync(result, admin, { isCreationEvent: true });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].args).toMatchObject({ p_amount: MONTHLY_CREDITS.plus, p_reason: "subscription_refill" });
  });

  it("trial: a late `updated` event from before the trial was cancelled stores the cancellation (ends at the trial end)", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "plus", subscription_status: "trialing" });
    const trialEnd = PERIOD_END - 5 * 86400;
    const cancelledTrial = sub("sub_1", "trialing", PLUS, { cancel_at_period_end: true, trial_end: trialEnd });
    await syncSubscriptionForUser(admin, stripeNow(cancelledTrial).stripe, "user-1", {
      eventSub: { ...cancelledTrial, cancel_at_period_end: false },
    });
    expect(updates[0]).toMatchObject({
      subscription_status: "trialing",
      subscription_ends_at: new Date(trialEnd * 1000).toISOString(),
    });
  });

  it("2026-09 protection: a transient EMPTY list never demotes — the event's subscription is still synced, and with none nothing is written", async () => {
    const withEvent = makeAdmin(paid);
    const result = await syncSubscriptionForUser(withEvent.admin, makeLiveStripe({ list: [] }).stripe, "user-1", {
      eventSub: renewingSnap(),
    });
    expect(result).toMatchObject({ tier: "plus", status: "active" });
    expect(withEvent.updates[0]).toMatchObject({ subscription_tier: "plus", subscription_status: "active" });

    const bare = makeAdmin({ ...paid, stripe_customer_id: "cus_1" });
    const untouched = await syncSubscriptionForUser(bare.admin, makeLiveStripe({ list: [] }).stripe, "user-1");
    expect(untouched).toMatchObject({ source: "none", tier: "plus", status: "active" });
    expect(bare.updates).toHaveLength(0);
  });

  it("2026-09 protection: with the LIST unreadable, a read that says canceled is not a deletion — nothing is written as free", async () => {
    // Nobody knows whether another subscription is live: only the `deleted`
    // event itself may write free.
    const { admin, updates } = makeAdmin({ subscription_tier: "pro", subscription_status: "active" });
    const gone = sub("sub_1", "canceled", PLUS);
    const stripe = makeLiveStripe({ list: null, byId: { sub_1: gone } }).stripe;
    const result = await syncSubscriptionForUser(admin, stripe, "user-1", { eventSub: cancelledSnap() });
    expect(result.tier).not.toBe("free");
    expect(updates[0]).toMatchObject({ subscription_status: "canceled", stripe_subscription_id: "sub_1" });
    expect(updates[0].subscription_tier).not.toBe("free");
  });

  it("an unmapped price on the re-read subscription still never demotes", async () => {
    const { admin, updates } = makeAdmin({ subscription_tier: "pro", subscription_status: "active" });
    const mystery = sub("sub_1", "active", { id: "price_mystery", unit_amount: 999, recurring: { interval: "month" } });
    const result = await syncSubscriptionForUser(admin, stripeNow(mystery).stripe, "user-1", { eventSub: renewingSnap() });
    expect(result).toMatchObject({ tier: "pro", unresolvedPrice: true });
    expect(updates[0]).toMatchObject({ subscription_tier: "pro", subscription_status: "active" });
  });

  it("currentSub (the caller's own fresh read or write) is taken as it is and not read again", async () => {
    const { admin, updates } = makeAdmin(paid);
    // The list still shows the cancellation the caller has just cleared.
    const { stripe, retrieved } = makeLiveStripe({ list: [cancelledSnap()], byId: { sub_1: cancelledSnap() } });
    await syncSubscriptionForUser(admin, stripe, "user-1", { currentSub: renewingSnap(), customerId: "cus_1" });
    expect(retrieved).toEqual([]);
    expect(updates[0]).toMatchObject({ cancel_at_period_end: false, subscription_ends_at: null });
  });

  it("currentSub read as canceled with eventDeleted (the admin resync) writes free even when the list fails", async () => {
    const { admin, updates } = makeAdmin(paid);
    const gone = sub("sub_1", "canceled", PLUS);
    await syncSubscriptionForUser(admin, makeLiveStripe({ list: null }).stripe, "user-1", {
      currentSub: gone,
      eventDeleted: true,
    });
    expect(updates[0]).toMatchObject({ subscription_tier: "free", subscription_status: "canceled", stripe_subscription_id: null });
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
