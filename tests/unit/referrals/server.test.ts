import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";
import { qualifyReferral, recordReferralSignup } from "@/lib/referrals/server";
import { REFERRAL_LIFETIME_CAP, REFERRAL_MONTHLY_CAP, REFERRAL_MONTH_DAYS } from "@/lib/referrals/rules";

// ---------------------------------------------------------------------------
// The referral flow on the service role: a signup through a link records ONE
// row and tells the referrer; the FIRST saved card moves it once, runs the
// window, the fraud rules and the caps (claim_referral_reward, atomic in the
// database), then gives each side its month and one notification.
// ---------------------------------------------------------------------------

const REFERRER = "11111111-1111-4111-8111-111111111111";
const REFEREE = "22222222-2222-4222-8222-222222222222";
const REFERRAL = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-01T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

type World = {
  codeOwner: string | null;
  refereeCreatedAt: string;
  refereeStatus: string | null;
  refereeCards: number;
  insertError: { message: string; code?: string } | null;
  moved: Array<{ id: string; referrer_id: string; signed_up_at: string }>;
  profiles: Array<Record<string, unknown>>;
  emails: Record<string, string>;
  claim: string | null;
};
let world: World;

function db() {
  const stub = chainClient((table: string, calls: ChainCall[]): ChainAnswer => {
    if (table === "referral_codes") return { data: world.codeOwner ? { user_id: world.codeOwner } : null };
    if (table === "profiles" && called(calls, "select") && called(calls, "in")) return { data: world.profiles };
    if (table === "profiles" && called(calls, "select")) {
      return { data: { created_at: world.refereeCreatedAt, subscription_status: world.refereeStatus } };
    }
    if (table === "cards") return { count: world.refereeCards };
    if (table === "referrals" && called(calls, "insert")) {
      return world.insertError ? { data: null, error: world.insertError } : { data: { id: REFERRAL } };
    }
    if (table === "referrals" && called(calls, "update") && called(calls, "select")) return { data: world.moved };
    return {};
  });
  stub.rpc.mockImplementation(async () => ({ data: world.claim, error: null }));
  const client = Object.assign(stub.client, {
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: world.emails[id] ?? null } } }),
      },
    },
  });
  return { ...stub, client };
}

const notifications = (stub: ReturnType<typeof db>) =>
  stub.forTable("notifications").map((e) => payloadOf(e.calls, "insert") as Record<string, unknown>);
const referralUpdates = (stub: ReturnType<typeof db>) =>
  stub
    .forTable("referrals")
    .filter((e) => called(e.calls, "update") && !called(e.calls, "select"))
    .map((e) => payloadOf(e.calls, "update") as Record<string, unknown>);
const profileUpdates = (stub: ReturnType<typeof db>) =>
  stub
    .forTable("profiles")
    .filter((e) => called(e.calls, "update"))
    .map((e) => ({ id: e.calls.find((c) => c.method === "eq")?.args[1], ...(payloadOf(e.calls, "update") as object) }));

beforeEach(() => {
  world = {
    codeOwner: REFERRER,
    refereeCreatedAt: at(-0.01),
    refereeStatus: null,
    refereeCards: 0,
    insertError: null,
    moved: [{ id: REFERRAL, referrer_id: REFERRER, signed_up_at: at(-2) }],
    profiles: [
      { id: REFERRER, subscription_tier: "free" },
      { id: REFEREE, subscription_tier: "free" },
    ],
    emails: { [REFERRER]: "ref@gmail.com", [REFEREE]: "friend@outlook.com" },
    claim: "rewarded",
  };
});

describe("recordReferralSignup", () => {
  it("a new account through a valid link: one row, and the referrer is told", async () => {
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "D0000003", now: NOW })).toEqual({
      ok: true,
      referralId: REFERRAL,
    });
    const insert = stub.forTable("referrals").find((e) => called(e.calls, "insert"))!;
    expect(payloadOf(insert.calls, "insert")).toEqual({ referrer_id: REFERRER, referee_id: REFEREE, code: "d0000003" });
    expect(notifications(stub)).toEqual([
      { recipient_id: REFERRER, actor_id: REFEREE, type: "referral_signup", payload: { referralId: REFERRAL } },
    ]);
  });

  it("refuses a bad or unknown code, your own code, and an account that isn't new", async () => {
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "<script>", now: NOW })).toEqual({ ok: false, reason: "bad_code" });
    world.codeOwner = null;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "unknown_code" });
    world.codeOwner = REFEREE;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "self" });
    world.codeOwner = REFERRER;
    for (const change of [
      () => (world.refereeCreatedAt = at(-8)),
      () => (world.refereeStatus = "canceled"),
      () => (world.refereeCards = 1),
    ]) {
      beforeEachWorld();
      change();
      const stub = db();
      expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "not_new" });
      expect(stub.forTable("referrals")).toEqual([]);
    }
  });

  it("first claim wins: a second claim for the same account is 'exists' and tells nobody", async () => {
    world.insertError = { message: "duplicate", code: "23505" };
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "exists" });
    expect(notifications(stub)).toEqual([]);
  });
});

function beforeEachWorld() {
  world.refereeCreatedAt = at(-0.01);
  world.refereeStatus = null;
  world.refereeCards = 0;
}

describe("qualifyReferral (the first saved card)", () => {
  it("both free: each gets a comp month of Plus and one notification; the caps are the app's", async () => {
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, { now: NOW });
    const month = { kind: "comp_month", tier: "plus", expiresAt: at(REFERRAL_MONTH_DAYS) };
    expect(result).toEqual({ status: "rewarded", referrer: month, referee: month });
    expect(stub.rpc).toHaveBeenCalledWith("claim_referral_reward", {
      p_referral_id: REFERRAL,
      p_monthly_cap: REFERRAL_MONTHLY_CAP,
      p_lifetime_cap: REFERRAL_LIFETIME_CAP,
    });
    expect(profileUpdates(stub)).toEqual([
      { id: REFEREE, comp_tier: "plus", comp_expires_at: at(REFERRAL_MONTH_DAYS) },
      { id: REFERRER, comp_tier: "plus", comp_expires_at: at(REFERRAL_MONTH_DAYS) },
    ]);
    expect(notifications(stub).map((n) => [n.recipient_id, n.type, (n.payload as { side: string }).side])).toEqual([
      [REFEREE, "referral_reward", "referee"],
      [REFERRER, "referral_reward", "referrer"],
    ]);
    // The move to first_card is ONE conditional update (status = signed_up).
    const moved = stub.forTable("referrals").find((e) => called(e.calls, "select"))!;
    expect(moved.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["referee_id", REFEREE],
      ["status", "signed_up"],
    ]);
  });

  it("a second save (or a retry) finds nothing to move and grants nothing", async () => {
    world.moved = [];
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, { now: NOW })).toEqual({ status: "none" });
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(profileUpdates(stub)).toEqual([]);
  });

  it("past the 30-day window: expired, nobody rewarded", async () => {
    world.moved = [{ id: REFERRAL, referrer_id: REFERRER, signed_up_at: at(-31) }];
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, { now: NOW })).toEqual({ status: "expired" });
    expect(referralUpdates(stub)).toEqual([{ status: "expired" }]);
    expect(profileUpdates(stub)).toEqual([]);
  });

  it("at the referrer's cap: the friend still gets theirs, the referrer nothing", async () => {
    world.claim = "capped";
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, { now: NOW });
    expect(result).toMatchObject({ status: "capped", referrer: { kind: "none", reason: "cap" }, referee: { kind: "comp_month" } });
    expect(profileUpdates(stub).map((u) => u.id)).toEqual([REFEREE]);
    expect(notifications(stub).map((n) => n.recipient_id)).toEqual([REFEREE]);
  });

  it("the same inbox: blocked, nobody rewarded, no cap consumed", async () => {
    world.emails[REFEREE] = "r.e.f+alt@gmail.com";
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, { now: NOW })).toEqual({ status: "blocked", reason: "same_email" });
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(referralUpdates(stub)).toEqual([{ status: "blocked", block_reason: "same_email", referrer_reward: "none", referee_reward: "none" }]);
    expect(notifications(stub)).toEqual([]);
  });

  it("the same card fingerprint on both Stripe customers: blocked", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "free", stripe_customer_id: "cus_a" },
      { id: REFEREE, subscription_tier: "free", stripe_customer_id: "cus_b" },
    ];
    const stripe = {
      customers: {
        listPaymentMethods: vi.fn(async () => ({ data: [{ card: { fingerprint: "fp_same" } }] })),
      },
    };
    expect(await qualifyReferral(db().client as never, REFEREE, { now: NOW, stripe: stripe as never })).toEqual({ status: "blocked", reason: "same_card" });
  });

  it("the same custom domain: the friend's month only", async () => {
    world.emails = { [REFERRER]: "a@smallshop.com", [REFEREE]: "b@smallshop.com" };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, { now: NOW })).toEqual({ status: "blocked", reason: "same_domain" });
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(profileUpdates(stub).map((u) => u.id)).toEqual([REFEREE]);
  });

  it("a paying referrer: one month's price on the Stripe balance, idempotent per referral and side", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "pro", subscription_status: "active", stripe_customer_id: "cus_a", stripe_subscription_id: "sub_a" },
      { id: REFEREE, subscription_tier: "free" },
    ];
    const createBalanceTransaction = vi.fn(async () => ({ id: "cbtxn_1" }));
    const stripe = {
      subscriptions: {
        retrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 15000, currency: "usd", recurring: { interval: "year" } } }] } })),
      },
      customers: { createBalanceTransaction, listPaymentMethods: vi.fn(async () => ({ data: [] })) },
    };
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, { now: NOW, stripe: stripe as never });
    expect(result).toMatchObject({ status: "rewarded", referrer: { kind: "balance_credit", amountCents: 1250, currency: "usd" } });
    expect(createBalanceTransaction).toHaveBeenCalledWith(
      "cus_a",
      { amount: -1250, currency: "usd", description: "PipGlyph referral — one free month", metadata: { referral_id: REFERRAL, side: "referrer" } },
      { idempotencyKey: `referral:${REFERRAL}:referrer` },
    );
    // The paying referrer's profile is not comped.
    expect(profileUpdates(stub).map((u) => u.id)).toEqual([REFEREE]);
    const details = referralUpdates(stub).at(-1)!;
    expect(details).toMatchObject({ referrer_reward: "balance_credit", referee_reward: "comp_month" });
  });

  it("a Stripe failure on a credit is recorded as none (never a throw; the comp side still lands)", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "plus", subscription_status: "trialing", stripe_customer_id: "cus_a", stripe_subscription_id: "sub_a" },
      { id: REFEREE, subscription_tier: "free" },
    ];
    const stripe = {
      subscriptions: { retrieve: vi.fn(async () => { throw new Error("stripe down"); }) },
      customers: { listPaymentMethods: vi.fn(async () => ({ data: [] })) },
    };
    const result = await qualifyReferral(db().client as never, REFEREE, { now: NOW, stripe: stripe as never });
    expect(result).toMatchObject({ status: "rewarded", referrer: { kind: "none", reason: "grant_failed" }, referee: { kind: "comp_month" } });
  });
});
