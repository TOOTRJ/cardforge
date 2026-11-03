import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// applyCompToSubscription — the one writer of a comp's effect on Stripe
// (lib/billing/comp-stripe.ts decides; this reads the subscription the
// profile points at, writes `trial_end` + the metadata, and resyncs). Best
// effort: a Stripe failure is reported and changes nothing else.
// ---------------------------------------------------------------------------

const sync = vi.hoisted(() => ({ syncSubscriptionForUser: vi.fn(), resolveSubscriptionTier: vi.fn() }));
vi.mock("@/lib/stripe/subscription-sync", () => sync);
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn(), isStripeConfigured: () => false }));

import { applyCompToSubscription } from "@/lib/billing/comp-stripe-apply";
import {
  COMP_CREDIT_GRANT_KEY,
  COMP_CREDIT_LEDGER_KEY,
  TRIAL_END_BEFORE_COMP_KEY,
} from "@/lib/billing/comp-stripe";

const NOW = new Date("2026-11-01T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const TRIAL_END = nowSec + 6 * 86_400;
const COMP_END = new Date((nowSec + 30 * 86_400) * 1000).toISOString();

function db(profile: Record<string, unknown> | null) {
  return chainClient((table) => (table === "profiles" ? { data: profile } : {}));
}
type Txn = { id: string; amount: number; metadata: Record<string, string> };
function stripeWith(sub: Record<string, unknown>, opts: { ledger?: Txn[]; balance?: number } = {}) {
  const ledger: Txn[] = [...(opts.ledger ?? [])];
  return {
    ledger,
    customers: {
      retrieve: vi.fn().mockImplementation(async () => ({
        id: "cus_1",
        balance: opts.balance ?? ledger.reduce((sum, t) => sum + t.amount, 0),
      })),
      listBalanceTransactions: vi.fn().mockImplementation(async () => ({ data: [...ledger].reverse(), has_more: false })),
      createBalanceTransaction: vi
        .fn()
        .mockImplementation(async (_c: string, params: { amount: number; metadata: Record<string, string> }) => {
          const txn = { id: `cbtxn_${ledger.length + 1}`, amount: params.amount, metadata: params.metadata };
          ledger.push(txn);
          return txn;
        }),
    },
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

beforeEach(() => {
  sync.syncSubscriptionForUser.mockReset().mockResolvedValue({});
  // The tier the SUBSCRIPTION pays for (read from Stripe, not the profile).
  sync.resolveSubscriptionTier.mockReset().mockResolvedValue("plus");
});

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

  it("reads the plan's tier from the subscription itself, not the profile (finding 4)", async () => {
    // The profile still says Plus; Stripe already says Pro: a Plus comp is BELOW it.
    sync.resolveSubscriptionTier.mockResolvedValue("pro");
    const stripe = stripeWith({ id: "sub_1", status: "trialing", trial_end: TRIAL_END, metadata: {} });
    const out = await applyCompToSubscription(db(PROFILE).client as never, "u1", { tier: "plus", expiresAt: COMP_END }, { stripe: stripe as never, now: NOW });
    expect(sync.resolveSubscriptionTier).toHaveBeenCalledWith(expect.objectContaining({ id: "sub_1" }), stripe);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(out.change).toEqual({ kind: "none", reason: "comp_lower_tier" });
  });

  it("Stripe updated but the resync threw: the admin is NOT told Stripe failed (finding 5)", async () => {
    sync.syncSubscriptionForUser.mockRejectedValue(new Error("db down"));
    const stripe = stripeWith({ id: "sub_1", status: "trialing", trial_end: TRIAL_END, metadata: {} });
    const out = await applyCompToSubscription(db(PROFILE).client as never, "u1", { tier: "plus", expiresAt: COMP_END }, { stripe: stripe as never, now: NOW });
    expect(stripe.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(out.failed).toBe(false);
    expect(out.trialEnd).toBe(COMP_END);
    expect(out.note).toMatch(/first charge lands then/);
    expect(out.note).not.toMatch(/couldn't be updated/);
    expect(out.note).toMatch(/Resync/);
  });

  it("a past-due plan is left alone; the admin is told it bills on its own dates", async () => {
    const stripe = stripeWith({ id: "sub_1", status: "past_due", metadata: {} });
    const out = await applyCompToSubscription(
      db({ ...PROFILE, subscription_status: "past_due" }).client as never,
      "u1",
      { tier: "pro", expiresAt: COMP_END },
      { stripe: stripe as never, now: NOW },
    );
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(out.change).toEqual({ kind: "none", reason: "not_trialing" });
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

// ---------------------------------------------------------------------------
// An ACTIVE (paying) plan: the comp period goes on the customer balance
// (owner answer 1, 2026-10-30). Stripe is the ledger; one key per grant.
// ---------------------------------------------------------------------------
describe("applyCompToSubscription — a paying (active) plan gets a balance credit", () => {
  const MONTHLY = { unit_amount: 600, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
  const ANNUAL = { unit_amount: 6000, currency: "usd", recurring: { interval: "year", interval_count: 1 } };
  const activeSub = (metadata: Record<string, string> = {}, price: Record<string, unknown> = MONTHLY) => ({
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    metadata,
    items: { data: [{ price }] },
  });
  const ACTIVE = { ...PROFILE, subscription_status: "active" };
  // One CALENDAR month from NOW (2026-11-01T12:00Z → 2026-12-01T12:00Z).
  const MONTH_END = "2026-12-01T12:00:00.000Z";
  const monthEndSec = Math.floor(Date.parse(MONTH_END) / 1000);
  const THREE_MONTHS = "2027-02-01T12:00:00.000Z";
  const threeMonthsSec = Math.floor(Date.parse(THREE_MONTHS) / 1000);
  const grantKey = `comp:sub_1:${nowSec}`;
  const credited = (amount: number): Txn => ({ id: "cbtxn_1", amount, metadata: { [COMP_CREDIT_LEDGER_KEY]: grantKey } });
  const run = (stripe: ReturnType<typeof stripeWith>, comp: { tier: "plus" | "pro" | null; expiresAt: string | null }, now = NOW) =>
    applyCompToSubscription(db(ACTIVE).client as never, "u1", comp, { stripe: stripe as never, now });

  it("a new grant: names it on the subscription FIRST, then credits one month's price — idempotent key", async () => {
    const stripe = stripeWith(activeSub());
    const out = await run(stripe, { tier: "plus", expiresAt: MONTH_END });
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${monthEndSec}` },
    });
    expect(stripe.subscriptions.update.mock.invocationCallOrder[0]).toBeLessThan(
      stripe.customers.createBalanceTransaction.mock.invocationCallOrder[0],
    );
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({
        amount: -600,
        currency: "usd",
        metadata: { [COMP_CREDIT_LEDGER_KEY]: grantKey, supabase_user_id: "u1", kind: "comp_credit" },
      }),
      { idempotencyKey: `${grantKey}:0->600:credit` },
    );
    // Never a trial or a price change on a paying plan.
    expect(stripe.subscriptions.update.mock.calls.every(([, p]) => !("trial_end" in (p as object)))).toBe(true);
    expect(out).toMatchObject({ failed: false, credit: { postedCents: 600, keptCents: 0, currency: "usd" } });
    expect(out.note).toMatch(/Credited \$6 to their Stripe balance/);
  });

  it("a RE-SAVE of the same comp posts nothing: the ledger already holds it", async () => {
    const stripe = stripeWith(activeSub({ [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${monthEndSec}` }), { ledger: [credited(-600)] });
    const out = await run(stripe, { tier: "plus", expiresAt: MONTH_END }, new Date(NOW.getTime() + 3_600_000));
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(out.credit?.postedCents).toBe(0);
    expect(out.note).toBe("Their comp credit is already on their Stripe balance.");
  });

  it("another grant's (or a referral's) transactions are not counted in this grant's ledger", async () => {
    const stripe = stripeWith(activeSub(), {
      ledger: [
        { id: "cbtxn_r", amount: -1500, metadata: { referral_id: "r1" } },
        { id: "cbtxn_o", amount: -600, metadata: { [COMP_CREDIT_LEDGER_KEY]: "comp:sub_1:1" } },
      ],
    });
    await run(stripe, { tier: "plus", expiresAt: MONTH_END });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith("cus_1", expect.objectContaining({ amount: -600 }), expect.anything());
  });

  it("EXTENDED to three months: credits the difference only ($12), the grant's start kept", async () => {
    const stripe = stripeWith(activeSub({ [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${monthEndSec}` }), { ledger: [credited(-600)] });
    const out = await run(stripe, { tier: "pro", expiresAt: THREE_MONTHS });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({ amount: -1200 }),
      { idempotencyKey: `${grantKey}:600->1800:credit` },
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${threeMonthsSec}` },
    });
    expect(out.credit?.postedCents).toBe(1200);
  });

  it("SHORTENED from three months to one: two months come back", async () => {
    const stripe = stripeWith(activeSub({ [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${threeMonthsSec}` }), { ledger: [credited(-1800)] });
    const out = await run(stripe, { tier: "plus", expiresAt: MONTH_END });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({ amount: 1200, metadata: expect.objectContaining({ kind: "comp_clawback" }) }),
      { idempotencyKey: `${grantKey}:1800->600:clawback` },
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${monthEndSec}` },
    });
    expect(out.credit?.postedCents).toBe(-1200);
  });

  it("CLEARED ten days in: the unlived days come back — capped at the credit still unspent", async () => {
    const meta = { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${monthEndSec}` };
    const later = new Date(NOW.getTime() + 10 * 86_400_000);
    // All still unspent: 10 days lived = 7200 × 10/365 = 197; 600 − 197 = 403 back.
    let stripe = stripeWith(activeSub(meta), { ledger: [credited(-600)] });
    let out = await run(stripe, { tier: null, expiresAt: null }, later);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      "cus_1",
      expect.objectContaining({ amount: 403, metadata: expect.objectContaining({ kind: "comp_clawback" }) }),
      { idempotencyKey: `${grantKey}:600->197:clawback` },
    );
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { metadata: { [COMP_CREDIT_GRANT_KEY]: "" } });
    expect(out.credit).toMatchObject({ postedCents: -403, keptCents: 0 });
    expect(out.note).toBe("Took back $4.03 of unused comp credit from their Stripe balance.");

    // An invoice already spent most of it: only the $1 left comes back — never a debt.
    stripe = stripeWith(activeSub(meta), { ledger: [credited(-600)], balance: -100 });
    out = await run(stripe, { tier: null, expiresAt: null }, later);
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith("cus_1", expect.objectContaining({ amount: 100 }), expect.anything());
    expect(out.credit).toMatchObject({ postedCents: -100, keptCents: 303 });
    expect(out.note).toMatch(/\$3\.03 had already paid an invoice and stays with them/);

    // Nothing unspent at all: nothing posted, the grant still closed.
    stripe = stripeWith(activeSub(meta), { ledger: [credited(-600)], balance: 0 });
    out = await run(stripe, { tier: null, expiresAt: null }, later);
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { metadata: { [COMP_CREDIT_GRANT_KEY]: "" } });
  });

  it("a release never posts a FRESH credit (a retry after a failed metadata clear)", async () => {
    // Day 10 already took the ledger back to 197; on day 11 the grant is
    // still named (the clear failed): nothing moves, the clear is retried.
    const stripe = stripeWith(activeSub({ [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${monthEndSec}` }), {
      ledger: [credited(-600), { id: "cbtxn_2", amount: 403, metadata: { [COMP_CREDIT_LEDGER_KEY]: grantKey } }],
    });
    await run(stripe, { tier: null, expiresAt: null }, new Date(NOW.getTime() + 11 * 86_400_000));
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { metadata: { [COMP_CREDIT_GRANT_KEY]: "" } });
  });

  it("an ANNUAL plan: a month's comp is a twelfth of the year ($60 → $5)", async () => {
    const stripe = stripeWith(activeSub({}, ANNUAL));
    await run(stripe, { tier: "plus", expiresAt: MONTH_END });
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith("cus_1", expect.objectContaining({ amount: -500 }), expect.anything());
  });

  it("a plan set to END: no credit (no invoice would take it); the admin is told why", async () => {
    const stripe = stripeWith({ ...activeSub(), cancel_at_period_end: true });
    const out = await run(stripe, { tier: "plus", expiresAt: MONTH_END });
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(out.note).toMatch(/cancelled and stops on its own date/);
  });

  it("a comp BELOW the plan paid for: nothing moves", async () => {
    sync.resolveSubscriptionTier.mockResolvedValue("pro");
    const stripe = stripeWith(activeSub());
    const out = await run(stripe, { tier: "plus", expiresAt: MONTH_END });
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled();
    expect(out.note).toBe("The comp is below their plan, so it changes nothing.");
  });

  it("a failed credit is reported; the grant stays named so a re-save finds it", async () => {
    const stripe = stripeWith(activeSub());
    stripe.customers.createBalanceTransaction.mockRejectedValue(new Error("boom"));
    const out = await run(stripe, { tier: "plus", expiresAt: MONTH_END });
    expect(out.failed).toBe(true);
    expect(out.note).toMatch(/couldn't be updated/);
    expect(stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      metadata: { [COMP_CREDIT_GRANT_KEY]: `${nowSec}:${monthEndSec}` },
    });
  });
});
