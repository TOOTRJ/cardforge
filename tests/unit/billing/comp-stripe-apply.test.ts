import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// applyCompToSubscription — the one writer of a comp's effect on Stripe
// (lib/billing/comp-stripe.ts decides; this reads the subscription the
// profile points at, writes `trial_end` + the metadata, and resyncs). Best
// effort: a Stripe failure is reported and changes nothing else.
// ---------------------------------------------------------------------------

const sync = vi.hoisted(() => ({ syncSubscriptionForUser: vi.fn() }));
vi.mock("@/lib/stripe/subscription-sync", () => sync);
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn(), isStripeConfigured: () => false }));

import { applyCompToSubscription } from "@/lib/billing/comp-stripe-apply";
import { TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";

const NOW = new Date("2026-11-01T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const TRIAL_END = nowSec + 6 * 86_400;
const COMP_END = new Date((nowSec + 30 * 86_400) * 1000).toISOString();

function db(profile: Record<string, unknown> | null) {
  return chainClient((table) => (table === "profiles" ? { data: profile } : {}));
}
function stripeWith(sub: Record<string, unknown>) {
  return {
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue(sub),
      update: vi.fn().mockImplementation(async (id: string, params: { trial_end: number | "now" }) => ({
        ...sub,
        id,
        trial_end: params.trial_end === "now" ? nowSec : params.trial_end,
      })),
    },
  };
}
const PROFILE = {
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  subscription_tier: "plus",
  subscription_status: "trialing",
};

beforeEach(() => sync.syncSubscriptionForUser.mockReset().mockResolvedValue({}));

describe("applyCompToSubscription", () => {
  it("holds a card-backed trial until the comp ends, remembers its own end, and resyncs the profile", async () => {
    const stub = db(PROFILE);
    const stripe = stripeWith({ id: "sub_1", status: "trialing", trial_end: TRIAL_END, metadata: {} });
    const out = await applyCompToSubscription(
      stub.client as never,
      "u1",
      { tier: "plus", expiresAt: COMP_END },
      { stripe: stripe as never, now: NOW },
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      trial_end: Math.floor(Date.parse(COMP_END) / 1000),
      proration_behavior: "none",
      metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(TRIAL_END) },
    });
    expect(sync.syncSubscriptionForUser).toHaveBeenCalledWith(stub.client, stripe, "u1", {
      currentSub: expect.objectContaining({ id: "sub_1" }),
      customerId: "cus_1",
    });
    expect(out).toMatchObject({ failed: false, trialEnd: COMP_END });
    expect(out.note).toMatch(/first charge lands then/);
  });

  it("an active plan is not written; the admin is told it keeps billing", async () => {
    const stripe = stripeWith({ id: "sub_1", status: "active", metadata: {} });
    const out = await applyCompToSubscription(
      db({ ...PROFILE, subscription_status: "active" }).client as never,
      "u1",
      { tier: "pro", expiresAt: COMP_END },
      { stripe: stripe as never, now: NOW },
    );
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(sync.syncSubscriptionForUser).not.toHaveBeenCalled();
    expect(out.note).toBe("Their Stripe subscription keeps billing as usual during the comp.");
  });

  it("no subscription on the profile: nothing to do, Stripe not read", async () => {
    const stripe = stripeWith({});
    const stub = db({ ...PROFILE, stripe_subscription_id: null });
    const out = await applyCompToSubscription(stub.client as never, "u1", { tier: "plus", expiresAt: COMP_END }, { stripe: stripe as never });
    expect(out).toEqual({ change: null, trialEnd: null, note: null, failed: false });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stub.log.some((e) => e.table === "profiles" && called(e.calls, "select"))).toBe(true);
  });

  it("Stripe not configured: never reads anything", async () => {
    const stub = db(PROFILE);
    expect(await applyCompToSubscription(stub.client as never, "u1", { tier: "plus", expiresAt: COMP_END })).toMatchObject({ change: null });
    expect(stub.log).toEqual([]);
  });

  it("a Stripe failure is reported and the comp stands (no throw)", async () => {
    const stripe = stripeWith({ id: "sub_1", status: "trialing", trial_end: TRIAL_END, metadata: {} });
    stripe.subscriptions.update.mockRejectedValue(new Error("boom"));
    const out = await applyCompToSubscription(db(PROFILE).client as never, "u1", { tier: "plus", expiresAt: COMP_END }, { stripe: stripe as never, now: NOW });
    expect(out.failed).toBe(true);
    expect(out.note).toMatch(/couldn't be updated/);
    expect(sync.syncSubscriptionForUser).not.toHaveBeenCalled();
  });
});
