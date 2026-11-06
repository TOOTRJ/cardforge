import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";
// The days bank (lib/billing/day-bank.ts) is where every "days" reward
// lands; here it is a fake that records what it was asked (its own
// behaviour is day-bank.test.ts). The settings come from a fake read.
const bank = vi.hoisted(() => ({ bankDays: vi.fn(), releaseStaleReservations: vi.fn(async () => 0) }));
vi.mock("@/lib/billing/day-bank", () => bank);
const settingsServer = vi.hoisted(() => ({ readReferralSettings: vi.fn() }));
vi.mock("@/lib/referrals/settings-server", () => settingsServer);

import {
  advanceReferral,
  preBankFriendDays,
  qualifyReferral,
  recordReferralSignup,
  rewardReferral,
  sweepReferralRewards,
} from "@/lib/referrals/server";
import { REFERRAL_GRANT_MAX_ATTEMPTS } from "@/lib/referrals/rules";
import { DEFAULT_REFERRAL_SETTINGS, type ReferralSettings } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral flow on the service role, v2 (owner 2026-11-06; migration
// 0180): a signup through a link records ONE row (at onboarding, the email
// confirmed) and keeps the email's keyed fingerprint (nobody is told); the
// row QUALIFIES when the friend has saved the settings' cards within the
// window AND started a plan with a card on file — judged on every save and
// on the subscription's creation (advanceReferral) — and the reward step
// runs AT ONCE: the program on, both emails confirmed, the key present
// (fail closed), the fraud rules, one email = one reward ever, the claim
// (claim_referral_reward_v2: the friends cap, the referrer's LADDER STEP),
// then each side's reward — DAYS INTO THE BANK under the reference
// `referral:<id>:referee` / `referral-step:<referrer>:<step>`, or credits —
// and one notification each. A failed grant is left owed for the sweep.
// ---------------------------------------------------------------------------

const REFERRER = "11111111-1111-4111-8111-111111111111";
const REFEREE = "22222222-2222-4222-8222-222222222222";
const REFERRAL = "33333333-3333-4333-8333-333333333333";
const OTHER_REFERRAL = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-01T12:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();
/** A TEST-ONLY fixture key (the real one is a server secret, never in git). */
const TEST_KEY = "test-only-fixture-key-not-a-secret-0123456789";
const hmac = (normalized: string) => createHmac("sha256", TEST_KEY).update(normalized).digest("hex");

type Row = Record<string, unknown>;
type World = {
  codeOwner: string | null;
  refereeCreatedAt: string;
  refereeStatus: string | null;
  refereeCards: number;
  /** The friend's subscription as the profile stores it (a card on file). */
  refereeSub: { id: string | null; status: string | null };
  insertError: { message: string; code?: string } | null;
  /** The friend's own open row (signed_up / cards_saved); null = none. */
  open: Row | null;
  profiles: Row[];
  users: Record<string, { email: string | null; confirmed: boolean }>;
  claim: { outcome: string; step: number | null } | null;
  inUse: boolean;
  seen: { referral_id: string | null } | null;
  pending: Row[];
  owed: Row[];
  stranded: Row[];
  /** What bankDays answers: ok, or a throw. */
  bank: { kind: "ok" } | { kind: "throw"; error: string };
  /** The friend's pre-banked entry as the bank holds it (null = none). */
  bankEntry: { id: string; status: string } | null;
  /** Rows referrals_awaiting_plan answers (cards saved, a plan now). */
  awaiting: Row[];
  /** The referrer's rewarded friends this month (the cap's count). */
  friendsThisMonth: number;
  settings: ReferralSettings;
};
let world: World;

const openRow = (over: Row = {}): Row => ({
  id: REFERRAL,
  referrer_id: REFERRER,
  referee_id: REFEREE,
  status: "signed_up",
  block_reason: null,
  first_card_at: null,
  cards_saved_at: null,
  card_on_file_at: null,
  ladder_step: null,
  referrer_reward: null,
  referee_reward: null,
  grant_attempts: 0,
  signed_up_at: at(-2),
  ...over,
});

const bankCalls = () => bank.bankDays.mock.calls.map((c) => (c as unknown[])[1] as Record<string, unknown>);

function db() {
  const stub = chainClient((table: string, calls: ChainCall[]): ChainAnswer => {
    if (table === "referral_codes") return { data: world.codeOwner ? { user_id: world.codeOwner } : null };
    if (table === "profiles" && called(calls, "in")) return { data: world.profiles };
    if (table === "profiles" && called(calls, "select")) {
      const id = calls.find((c) => c.method === "eq")?.args[1];
      const columns = String(calls.find((c) => c.method === "select")?.args[0] ?? "");
      if (columns.startsWith("created_at")) {
        return { data: { created_at: world.refereeCreatedAt, subscription_status: world.refereeStatus } };
      }
      if (columns.startsWith("stripe_subscription_id")) {
        return { data: { stripe_subscription_id: world.refereeSub.id, subscription_status: world.refereeSub.status } };
      }
      return { data: world.profiles.find((p) => p.id === id) ?? null };
    }
    if (table === "cards") return { count: world.refereeCards };
    if (table === "referral_email_fingerprints" && called(calls, "select")) return { data: world.seen };
    if (table === "day_bank_entries") {
      if (called(calls, "update")) return { data: world.bankEntry?.status === "banked" ? [{ id: world.bankEntry.id }] : [] };
      return { data: world.bankEntry };
    }
    if (table === "referrals" && called(calls, "select") && called(calls, "gte")) return { count: world.friendsThisMonth };
    if (table === "referrals" && called(calls, "insert")) {
      return world.insertError ? { data: null, error: world.insertError } : { data: { id: REFERRAL } };
    }
    if (table === "referrals" && called(calls, "update") && !called(calls, "select")) return { data: null };
    if (table === "referrals" && called(calls, "update") && called(calls, "select")) {
      // The cards move (status = signed_up), the card-on-file stamp
      // (card_on_file_at IS NULL) or a settle (status IN qualified).
      if (called(calls, "eq", "status")) return { data: world.open?.status === "signed_up" ? [{ id: REFERRAL }] : [] };
      if (called(calls, "is", "card_on_file_at")) return { data: world.open?.card_on_file_at ? [] : [{ id: REFERRAL }] };
      return { data: [{ id: REFERRAL }] };
    }
    if (table === "referrals" && called(calls, "select")) {
      if (called(calls, "eq", "referee_id")) return { data: world.open };
      if (called(calls, "eq", "status")) return { data: world.stranded };
      return { data: called(calls, "or") ? world.owed : world.pending };
    }
    return {};
  });
  stub.rpc.mockImplementation((async (name: string) => {
    if (name === "claim_referral_reward_v2") return { data: world.claim ? [world.claim] : [], error: null };
    if (name === "referrals_awaiting_plan") return { data: world.awaiting, error: null };
    if (name === "referrals_stranded_signups") return { data: world.stranded, error: null };
    if (name === "referral_email_in_use") return { data: world.inUse, error: null };
    return { data: null, error: null };
  }) as never);
  const client = Object.assign(stub.client, {
    auth: {
      admin: {
        getUserById: async (id: string) => {
          const user = world.users[id];
          return {
            data: { user: user ? { email: user.email, email_confirmed_at: user.confirmed ? at(-3) : null } : null },
          };
        },
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
    .filter((e) => called(e.calls, "update"))
    .map((e) => payloadOf(e.calls, "update") as Record<string, unknown>);
const rpcNames = (stub: ReturnType<typeof db>) => stub.rpc.mock.calls.map((c) => (c as unknown[])[0]);

function freshWorld(): World {
  return {
    codeOwner: REFERRER,
    refereeCreatedAt: at(-0.01),
    refereeStatus: null,
    refereeCards: 5,
    refereeSub: { id: "sub_friend", status: "trialing" },
    insertError: null,
    open: openRow(),
    profiles: [
      { id: REFERRER, subscription_tier: "free" },
      { id: REFEREE, subscription_tier: "free" },
    ],
    users: {
      [REFERRER]: { email: "ref@gmail.com", confirmed: true },
      [REFEREE]: { email: "friend@outlook.com", confirmed: true },
    },
    claim: { outcome: "rewarded", step: 1 },
    inUse: false,
    seen: null,
    pending: [],
    owed: [],
    stranded: [],
    bank: { kind: "ok" },
    bankEntry: null,
    awaiting: [],
    friendsThisMonth: 0,
    settings: DEFAULT_REFERRAL_SETTINGS,
  };
}

const deps = { now: NOW, billingEnabled: true } as const;
const FRIEND_REF = `referral:${REFERRAL}:referee`;
const stepRef = (n: number) => `referral-step:${REFERRER}:${n}`;

beforeEach(() => {
  world = freshWorld();
  vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", TEST_KEY);
  settingsServer.readReferralSettings.mockReset().mockImplementation(async () => world.settings);
  bank.releaseStaleReservations.mockClear();
  bank.bankDays.mockReset().mockImplementation(async (_admin: unknown, input: { days: number; reference: string }) => {
    if (world.bank.kind === "throw") throw new Error(world.bank.error);
    return { ok: true, entryId: `e-${input.reference}`, created: true, days: input.days };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recordReferralSignup", () => {
  it("a new account through a valid link: one row, its email's keyed fingerprint kept, and nobody is told", async () => {
    world.users[REFEREE] = { email: "Friend.Name+promo@GoogleMail.com", confirmed: false };
    world.refereeCards = 0;
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "D0000003", now: NOW })).toEqual({
      ok: true,
      referralId: REFERRAL,
    });
    const insert = stub.forTable("referrals").find((e) => called(e.calls, "insert"))!;
    expect(payloadOf(insert.calls, "insert")).toEqual({ referrer_id: REFERRER, referee_id: REFEREE, code: "d0000003" });
    const kept = stub.forTable("referral_email_fingerprints").find((e) => called(e.calls, "upsert"))!;
    // A keyed hash of the NORMALIZED address — never the address itself.
    expect(payloadOf(kept.calls, "upsert")).toEqual({ fingerprint: hmac("friendname@gmail.com"), referral_id: REFERRAL });
    expect(kept.calls.find((c) => c.method === "upsert")?.args[1]).toEqual({ onConflict: "fingerprint", ignoreDuplicates: true });
    expect(JSON.stringify(stub.log)).not.toMatch(/friend/i);
    expect(notifications(stub)).toEqual([]);
  });

  it("without the hash key the signup still lands; no fingerprint, never an unkeyed hash", async () => {
    vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", "");
    world.refereeCards = 0;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toMatchObject({ ok: true });
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("refuses a bad or unknown code, your own code, and an account that isn't new", async () => {
    world.refereeCards = 0;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "<script>", now: NOW })).toEqual({ ok: false, reason: "bad_code" });
    world.codeOwner = null;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "unknown_code" });
    world.codeOwner = REFEREE;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "self" });
    for (const change of [
      () => (world.refereeCreatedAt = at(-8)),
      () => (world.refereeStatus = "canceled"),
      () => (world.refereeCards = 5),
    ]) {
      world = freshWorld();
      world.refereeCards = 0;
      change();
      const stub = db();
      expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "not_new" });
      expect(stub.forTable("referrals")).toEqual([]);
    }
  });

  it("a friend with a card or two already (a guest draft) is still new — only the bar's cards refuse", async () => {
    world.refereeCards = 4;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toMatchObject({ ok: true });
  });

  it("first claim wins: a second claim for the same account is 'exists'", async () => {
    world.refereeCards = 0;
    world.insertError = { message: "duplicate", code: "23505" };
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "exists" });
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
  });
});

describe("advanceReferral — the two bars, then the reward at once", () => {
  it("the cards saved AND a card on file, both confirmed: the row moves and is stamped, the claim takes step 1, each side's days go into the bank under its own reference, one notification each", async () => {
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, deps);
    expect(result).toEqual({
      status: "rewarded",
      referrer: { kind: "banked_days", days: 7, entryId: `e-${stepRef(1)}`, step: 1 },
      referee: { kind: "banked_days", days: 7, entryId: `e-${FRIEND_REF}` },
      step: 1,
    });
    expect(stub.rpc).toHaveBeenCalledWith("claim_referral_reward_v2", {
      p_referral_id: REFERRAL,
      p_friends_cap: DEFAULT_REFERRAL_SETTINGS.caps.friendsPerMonth,
    });
    expect(bankCalls()).toEqual([
      { userId: REFEREE, days: 7, source: "referral_friend", reference: FRIEND_REF },
      { userId: REFERRER, days: 7, source: "referral_step", reference: stepRef(1) },
    ]);
    // Never the comp's columns from here, never credits by hand for a days step.
    expect(stub.forTable("profiles").filter((e) => called(e.calls, "update"))).toEqual([]);
    expect(rpcNames(stub)).not.toContain("grant_credits");
    expect(notifications(stub).map((n) => [n.recipient_id, n.type, n.payload])).toEqual([
      [REFEREE, "referral_reward", { referralId: REFERRAL, side: "referee", reward: "banked_days", days: 7 }],
      [REFERRER, "referral_reward", { referralId: REFERRAL, side: "referrer", reward: "banked_days", days: 7, step: 1 }],
    ]);
    // Each side's outcome is recorded only while still owed.
    const record = stub.forTable("referrals").find((e) => (payloadOf(e.calls, "update") as Record<string, unknown> | undefined)?.referee_reward === "banked_days")!;
    expect(record.calls.find((c) => c.method === "is")?.args).toEqual(["referee_reward", null]);
    // The cards move is ONE conditional update (status = signed_up) with both stamps.
    const moved = stub.forTable("referrals").find((e) => called(e.calls, "update") && called(e.calls, "eq", "status"))!;
    expect(payloadOf(moved.calls, "update")).toEqual({ status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() });
    // The card-on-file stamp is written once (card_on_file_at IS NULL).
    const stamped = stub.forTable("referrals").find((e) => called(e.calls, "update") && called(e.calls, "is", "card_on_file_at"))!;
    expect(payloadOf(stamped.calls, "update")).toEqual({ card_on_file_at: NOW.toISOString() });
    // The email check ran before the claim, on the normalized address.
    expect(stub.rpc).toHaveBeenCalledWith("referral_email_in_use", { p_user_id: REFEREE, p_normalized: "friend@outlook.com" });
    const names = rpcNames(stub);
    expect(names.indexOf("referral_email_in_use")).toBeLessThan(names.indexOf("claim_referral_reward_v2"));
  });

  it("no open row (a second run, or no referral): nothing", async () => {
    world.open = null;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "none" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("fewer cards than the bar: waiting, nothing stamped, no claim", async () => {
    world.refereeCards = 4;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    expect(referralUpdates(stub).some((u) => "cards_saved_at" in u)).toBe(false);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(bankCalls()).toEqual([]);
  });

  it("the cards but NO card on file: the cards are stamped (once) and the row waits for the plan", async () => {
    world.refereeSub = { id: null, status: null };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    expect(referralUpdates(stub)).toEqual([{ status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() }]);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    // A plan without a card (a legacy no-card trial reads trialing too — the
    // status is Stripe's; a profile with no subscription id never counts).
    world = freshWorld();
    world.refereeSub = { id: "sub_x", status: "canceled" };
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
  });

  it("the cards saved past the window: expired, nobody rewarded", async () => {
    world.open = openRow({ signed_up_at: at(-31) });
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "expired" });
    expect(referralUpdates(stub).at(-1)).toEqual({ status: "expired", referrer_reward: "none", referee_reward: "none" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("the ladder: step 2 is AI credits (grant_credits under the step's key), step 11 is the tail", async () => {
    world.claim = { outcome: "rewarded", step: 2 };
    let stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({
      status: "rewarded",
      referrer: { kind: "credits", credits: 5, step: 2 },
      referee: { kind: "banked_days", days: 7 },
      step: 2,
    });
    expect(stub.rpc).toHaveBeenCalledWith("grant_credits", {
      p_user_id: REFERRER,
      p_amount: 5,
      p_reason: "referral_credits",
      p_idempotency_key: stepRef(2),
    });
    expect(bankCalls().map((c) => c.source)).toEqual(["referral_friend"]);
    expect(notifications(stub).map((n) => n.payload)).toContainEqual({ referralId: REFERRAL, side: "referrer", reward: "credits", credits: 5, step: 2 });

    world = freshWorld();
    world.claim = { outcome: "rewarded", step: 11 };
    stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ referrer: { kind: "banked_days", days: 7, step: 11 } });
    expect(bankCalls().at(-1)).toEqual({ userId: REFERRER, days: 7, source: "referral_step", reference: stepRef(11) });
    // Step 10 is the ladder's last: 30 days.
    world = freshWorld();
    world.claim = { outcome: "rewarded", step: 10 };
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ referrer: { kind: "banked_days", days: 30, step: 10 } });
  });

  it("an UNCONFIRMED email (either side) waits — no claim, no bank, no notification — and expires 30 days after the cards", async () => {
    for (const who of [REFEREE, REFERRER]) {
      world = freshWorld();
      world.users[who].confirmed = false;
      const stub = db();
      expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "email_unconfirmed" });
      expect(stub.rpc).not.toHaveBeenCalled();
      expect(notifications(stub)).toEqual([]);
      expect(bankCalls()).toEqual([]);
    }
    world = freshWorld();
    world.users[REFEREE].confirmed = false;
    const late = openRow({ status: "cards_saved", cards_saved_at: at(-31), card_on_file_at: at(-1) });
    const stub = db();
    expect(await rewardReferral(stub.client as never, late as never, deps)).toEqual({ status: "expired" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("billing off: nothing happens (the row waits)", async () => {
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, { now: NOW, billingEnabled: false })).toEqual({ status: "waiting", reason: "billing_off" });
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(notifications(stub)).toEqual([]);
  });

  it("no hash key: FAIL CLOSED — no email check, no claim, nothing banked", async () => {
    vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", "too-short");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "hash_key_missing" });
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(bankCalls()).toEqual([]);
    error.mockRestore();
  });

  it("one email, one reward (a): another LIVE account has the friend's normalized address — nobody rewarded, the friend not told", async () => {
    world.users[REFEREE].email = "Jo.Smith+2@googlemail.com";
    world.inUse = true;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "blocked", reason: "email_reused", referee: null });
    expect(stub.rpc).toHaveBeenCalledWith("referral_email_in_use", { p_user_id: REFEREE, p_normalized: "josmith@gmail.com" });
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(bankCalls()).toEqual([]);
    expect(referralUpdates(stub).at(-1)).toEqual({
      status: "blocked",
      block_reason: "email_reused",
      referrer_reward: "none",
      referee_reward: "none",
      referee_reward_detail: { kind: "none", reason: "email_reused" },
    });
    expect(notifications(stub)).toEqual([
      { recipient_id: REFERRER, actor_id: REFEREE, type: "referral_signup", payload: { referralId: REFERRAL, outcome: "not_eligible" } },
    ]);
  });

  it("one email, one reward (b): an EARLIER referral signup left the fingerprint (its account deleted since) — not eligible", async () => {
    world.seen = { referral_id: OTHER_REFERRAL };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "blocked", reason: "email_reused" });
    const read = stub.forTable("referral_email_fingerprints").find((e) => called(e.calls, "select"))!;
    expect(read.calls.find((c) => c.method === "eq")?.args).toEqual(["fingerprint", hmac("friend@outlook.com")]);
    world = freshWorld();
    world.seen = { referral_id: null };
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "blocked", reason: "email_reused" });
  });

  it("the friend's OWN fingerprint (this referral's signup) is no match; a new one (email changed) is kept", async () => {
    world.seen = { referral_id: REFERRAL };
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded" });
    world = freshWorld();
    const stub = db();
    await qualifyReferral(stub.client as never, REFEREE, deps);
    const kept = stub.forTable("referral_email_fingerprints").find((e) => called(e.calls, "upsert"))!;
    expect(payloadOf(kept.calls, "upsert")).toEqual({ fingerprint: hmac("friend@outlook.com"), referral_id: REFERRAL });
  });

  it("the email check failing leaves the row waiting (never a reward on a guess)", async () => {
    const stub = db();
    stub.rpc.mockImplementation((async (name: string) =>
      name === "referral_email_in_use" ? { data: null, error: { message: "down" } } : { data: null, error: null }) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "check_failed" });
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    warn.mockRestore();
  });

  it("a friend whose account was deleted before the reward step: blocked, nobody rewarded", async () => {
    const stub = db();
    const row = openRow({ status: "cards_saved", cards_saved_at: at(-1), card_on_file_at: at(-1), referee_id: null });
    expect(await rewardReferral(stub.client as never, row as never, deps)).toEqual({ status: "blocked", reason: "account_deleted", referee: null });
    expect(referralUpdates(stub)).toEqual([
      { status: "blocked", block_reason: "account_deleted", referrer_reward: "none", referee_reward: "none", referee_reward_detail: { kind: "none", reason: "account_deleted" } },
    ]);
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("the same inbox: blocked, nobody rewarded, no cap consumed", async () => {
    world.users[REFEREE].email = "r.e.f+alt@gmail.com";
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "blocked", reason: "same_email", referee: null });
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(referralUpdates(stub).at(-1)).toMatchObject({ status: "blocked", block_reason: "same_email", referrer_reward: "none", referee_reward: "none" });
  });

  it("the same card fingerprint on both Stripe customers: blocked", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "free", stripe_customer_id: "cus_a" },
      { id: REFEREE, subscription_tier: "free", stripe_customer_id: "cus_b" },
    ];
    const stripe = { paymentMethods: { list: vi.fn(async () => ({ data: [{ card: { fingerprint: "fp_same" } }] })) } };
    expect(await qualifyReferral(db().client as never, REFEREE, { ...deps, stripe: stripe as never })).toMatchObject({ status: "blocked", reason: "same_card" });
  });

  it("the same custom domain: the friend's days only — through the claim, so it counts toward the friends cap", async () => {
    world.users = { [REFERRER]: { email: "a@smallshop.com", confirmed: true }, [REFEREE]: { email: "b@smallshop.com", confirmed: true } };
    world.claim = { outcome: "blocked", step: null };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "blocked", reason: "same_domain", referee: { kind: "banked_days", days: 7 } });
    expect(stub.rpc).toHaveBeenCalledWith("claim_referral_reward_v2", expect.objectContaining({ p_block_reason: "same_domain" }));
    expect(bankCalls().map((c) => c.source)).toEqual(["referral_friend"]);
    // Twenty catch-all inboxes: the friends cap answers capped_friends and nobody is rewarded.
    bank.bankDays.mockClear();
    world = freshWorld();
    world.users = { [REFERRER]: { email: "a@smallshop.com", confirmed: true }, [REFEREE]: { email: "b@smallshop.com", confirmed: true } };
    world.claim = { outcome: "capped_friends", step: null };
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toEqual({ status: "capped", referrer: null, referee: null });
    expect(bankCalls()).toEqual([]);
  });

  it("the friends cap (the settings' friendsPerMonth): NEITHER side is rewarded — N confirmable inboxes mint nothing", async () => {
    world.claim = { outcome: "capped_friends", step: null };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "capped", referrer: null, referee: null });
    expect(bankCalls()).toEqual([]);
    expect(notifications(stub)).toEqual([
      { recipient_id: REFERRER, actor_id: REFEREE, type: "referral_signup", payload: { referralId: REFERRAL, outcome: "capped_friends" } },
    ]);
  });

  it("a claim another run won (no row back): nothing", async () => {
    world.claim = null;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "none" });
    expect(bankCalls()).toEqual([]);
  });

  it("the program OFF (the admin switch) is a PAUSE: the stamps are written, then the row waits — nothing banked, nobody told, nothing settled", async () => {
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "program_off" });
    expect(referralUpdates(stub)).toEqual([
      { status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() },
      { card_on_file_at: NOW.toISOString() },
    ]);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(bankCalls()).toEqual([]);
    expect(notifications(stub)).toEqual([]);
    // …and a signup through a link records nothing either.
    world = freshWorld();
    world.refereeCards = 0;
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false };
    const signup = db();
    expect(await recordReferralSignup(signup.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "program_off" });
    expect(signup.forTable("referrals")).toEqual([]);
  });

  it("the friend's days set to 0: their side is 'none' (settings), the referrer still climbs", async () => {
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, friend: { days: 0 } };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({
      status: "rewarded",
      referrer: { kind: "banked_days", days: 7, step: 1 },
      referee: { kind: "none", reason: "settings" },
    });
    expect(bankCalls().map((c) => c.source)).toEqual(["referral_step"]);
    expect(notifications(stub).map((n) => n.recipient_id)).toEqual([REFERRER]);
  });

  it("an admin referrer gets nothing; the friend still does", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "free", is_admin: true },
      { id: REFEREE, subscription_tier: "free" },
    ];
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({
      referrer: { kind: "none", reason: "admin" },
      referee: { kind: "banked_days", days: 7 },
    });
  });

  it("a bank write that throws is never a throw here: the side stays OWED and an attempt is counted (the sweep retries)", async () => {
    world.bank = { kind: "throw", error: "deadlock" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, deps);
    expect(result).toEqual({ status: "rewarded", referrer: null, referee: null, step: 1 });
    expect(referralUpdates(stub)).toContainEqual({ grant_attempts: 1 });
    // Nothing recorded for either side: both stay owed.
    expect(referralUpdates(stub).filter((u) => !("status" in u) && ("referee_reward" in u || "referrer_reward" in u))).toEqual([]);
    expect(notifications(stub)).toEqual([]);
    error.mockRestore();
  });
});

describe("preBankFriendDays — the friend's checkout", () => {
  it("a friend with the cards and no plan yet gets their days banked under the referral's reference, so this checkout applies them", async () => {
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    expect(await preBankFriendDays(db().client as never, REFEREE, deps)).toBe(true);
    expect(bankCalls()).toEqual([{ userId: REFEREE, days: 7, source: "referral_friend", reference: FRIEND_REF }]);
  });
  it("the reward step's gate is judged BEFORE banking (check P1): an unconfirmed email, the same inbox, a reused email, the friends cap, an admin friend, no hash key — nothing banked", async () => {
    const ready = () => openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    for (const change of [
      () => (world.users[REFEREE].confirmed = false),
      () => (world.users[REFERRER].confirmed = false),
      () => (world.users[REFEREE].email = "r.e.f+alt@gmail.com"),
      () => (world.users[REFEREE].email = "z@yopmail.com"),
      () => (world.inUse = true),
      () => (world.seen = { referral_id: OTHER_REFERRAL }),
      () => (world.friendsThisMonth = DEFAULT_REFERRAL_SETTINGS.caps.friendsPerMonth),
      () => (world.profiles = [{ id: REFERRER, subscription_tier: "free" }, { id: REFEREE, subscription_tier: "free", is_admin: true }]),
      () => vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", ""),
    ]) {
      world = freshWorld();
      world.open = ready();
      change();
      expect(await preBankFriendDays(db().client as never, REFEREE, deps)).toBe(false);
      vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", TEST_KEY);
    }
    expect(bankCalls()).toEqual([]);
    // A referrer-only block (the same custom domain) still banks the friend's days: the step rewards them.
    world = freshWorld();
    world.open = ready();
    world.users = { [REFERRER]: { email: "a@smallshop.com", confirmed: true }, [REFEREE]: { email: "b@smallshop.com", confirmed: true } };
    const stub = db();
    expect(await preBankFriendDays(stub.client as never, REFEREE, deps)).toBe(true);
    // The cap's count is the claim's: this month's rewarded/capped/blocked rows whose friend was rewarded.
    const capRead = stub.forTable("referrals").find((e) => called(e.calls, "gte"))!;
    expect(capRead.calls.find((c) => c.method === "neq")?.args).toEqual(["referee_reward", "none"]);
    expect(capRead.calls.find((c) => c.method === "gte")?.args).toEqual(["rewarded_at", "2026-11-01T00:00:00.000Z"]);
  });

  it("pre-banked days are taken back when the row ends with nothing for the friend — revoked while banked, named as spent once a checkout used them (check P1)", async () => {
    // Banked still: the same card is judged at the webhook → revoked by reference.
    world.bankEntry = { id: "e_pre", status: "banked" };
    world.profiles = [
      { id: REFERRER, subscription_tier: "free", stripe_customer_id: "cus_a" },
      { id: REFEREE, subscription_tier: "free", stripe_customer_id: "cus_b" },
    ];
    const stripe = { paymentMethods: { list: vi.fn(async () => ({ data: [{ card: { fingerprint: "fp_same" } }] })) } };
    let stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, { ...deps, stripe: stripe as never })).toMatchObject({ status: "blocked", reason: "same_card" });
    const revoke = stub.forTable("day_bank_entries").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(revoke.calls, "update")).toEqual({ status: "revoked", revoked_at: NOW.toISOString(), revoke_reason: "referral same_card" });
    expect(revoke.calls.find((c) => c.method === "eq" && c.args[0] === "reference")?.args[1]).toBe(FRIEND_REF);
    expect(revoke.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1]).toBe("banked");
    expect(referralUpdates(stub).at(-1)).toMatchObject({ status: "blocked", referee_reward_detail: { kind: "none", reason: "same_card" } });

    // Already APPLIED by the checkout: nothing to revoke — the detail says so for the admin.
    world = freshWorld();
    world.bankEntry = { id: "e_pre", status: "applied" };
    world.profiles = [
      { id: REFERRER, subscription_tier: "free", stripe_customer_id: "cus_a" },
      { id: REFEREE, subscription_tier: "free", stripe_customer_id: "cus_b" },
    ];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub = db();
    await qualifyReferral(stub.client as never, REFEREE, { ...deps, stripe: stripe as never });
    expect(referralUpdates(stub).at(-1)).toMatchObject({
      status: "blocked",
      referee_reward_detail: { kind: "none", reason: "same_card", preBankedEntryId: "e_pre", spent: true },
    });
    warn.mockRestore();

    // The friends cap at the claim: the same, on the row's detail.
    world = freshWorld();
    world.bankEntry = { id: "e_pre", status: "reserved" };
    world.claim = { outcome: "capped_friends", step: null };
    const warn2 = vi.spyOn(console, "warn").mockImplementation(() => {});
    stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "capped", referrer: null, referee: null });
    expect(referralUpdates(stub)).toContainEqual({ referee_reward_detail: { kind: "none", reason: "capped_friends", preBankedEntryId: "e_pre", spent: true } });
    warn2.mockRestore();
    // …and banked still → revoked.
    world = freshWorld();
    world.bankEntry = { id: "e_pre", status: "banked" };
    world.claim = { outcome: "capped_friends", step: null };
    stub = db();
    await qualifyReferral(stub.client as never, REFEREE, deps);
    expect(stub.forTable("day_bank_entries").some((e) => called(e.calls, "update"))).toBe(true);
  });

  it("nothing without the cards, with a card already on file, with the side already recorded, with the program off, or with billing off", async () => {
    for (const change of [
      () => (world.open = openRow()),
      () => (world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1), card_on_file_at: at(-1) })),
      () => (world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1), referee_reward: "none" })),
      () => {
        world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
        world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false };
      },
      () => (world.open = null),
    ]) {
      world = freshWorld();
      change();
      expect(await preBankFriendDays(db().client as never, REFEREE, deps)).toBe(false);
    }
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    expect(await preBankFriendDays(db().client as never, REFEREE, { now: NOW, billingEnabled: false })).toBe(false);
    expect(bankCalls()).toEqual([]);
  });
});

describe("sweepReferralRewards (the cron's retry)", () => {
  it("does nothing while billing is off", async () => {
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, { now: NOW, billingEnabled: false })).toEqual({ ok: true, skipped: "billing_off" });
    expect(stub.log).toEqual([]);
  });

  it("advances cards_saved rows: one with a plan now is claimed, one without waits; the bank's stale reservations are released", async () => {
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    world.pending = [{ ...world.open }];
    bank.releaseStaleReservations.mockResolvedValueOnce(2);
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0, released: 2 });
    expect(rpcNames(stub)).toContain("claim_referral_reward_v2");
    expect(bank.releaseStaleReservations).toHaveBeenCalledWith(stub.client, NOW);

    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    world.pending = [{ ...world.open }];
    world.refereeSub = { id: null, status: null };
    expect(await sweepReferralRewards(db().client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 1, retried: 0, failed: 0, released: 0 });
  });

  it("grants the sides still owed on claimed rows — and only those", async () => {
    world.owed = [openRow({ status: "rewarded", ladder_step: 3, referrer_reward: "banked_days", referee_reward: null, grant_attempts: 1 })];
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 0, retried: 1, failed: 0, released: 0 });
    expect(bankCalls().map((c) => c.source)).toEqual(["referral_friend"]);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    // The referrer's owed side uses the row's ladder step, never step 1 again.
    bank.bankDays.mockClear();
    world = freshWorld();
    world.owed = [openRow({ status: "rewarded", ladder_step: 3, referrer_reward: null, referee_reward: "banked_days" })];
    await sweepReferralRewards(db().client as never, deps);
    expect(bankCalls()).toEqual([{ userId: REFERRER, days: 7, source: "referral_step", reference: stepRef(3) }]);
  });

  it("a STRANDED signup (a lost after()): a signed_up row older than ten minutes whose friend has the cards is advanced; signups past the window expire", async () => {
    world.stranded = [{ id: REFERRAL, referee_id: REFEREE }];
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0, released: 0 });
    expect(rpcNames(stub)).toContain("claim_referral_reward_v2");
    const expiry = stub.forTable("referrals").find((e) => called(e.calls, "update") && called(e.calls, "eq", "status") && called(e.calls, "lt"))!;
    expect(payloadOf(expiry.calls, "update")).toEqual({ status: "expired", referrer_reward: "none", referee_reward: "none" });
    expect(expiry.calls.find((c) => c.method === "lt")?.args).toEqual(["signed_up_at", new Date(NOW.getTime() - 30 * DAY).toISOString()]);
    // The read is the database's (the card count judged there): before now
    // − 10 min, inside the window, the bar's cards.
    expect(stub.rpc).toHaveBeenCalledWith("referrals_stranded_signups", {
      p_cards: 5,
      p_since: new Date(NOW.getTime() - 30 * DAY).toISOString(),
      p_until: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      p_limit: 100,
    });
    // The pending reads: the rows with both stamps, and the database's
    // "cards saved, a plan now" rows (referrals_awaiting_plan), deduplicated.
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    world.awaiting = [{ ...world.open }];
    world.pending = [{ ...world.open }];
    const both = db();
    expect(await sweepReferralRewards(both.client as never, deps)).toMatchObject({ claimed: 1 });
    const stampedRead = both.forTable("referrals").find((e) => called(e.calls, "select") && called(e.calls, "not"))!;
    expect(stampedRead.calls.find((c) => c.method === "not")?.args).toEqual(["card_on_file_at", "is", null]);
    expect(both.rpc).toHaveBeenCalledWith("referrals_awaiting_plan", { p_limit: 100 });
  });

  it(`gives up after ${REFERRAL_GRANT_MAX_ATTEMPTS} attempts: the side is recorded as none (grant_failed) for an admin`, async () => {
    world.bank = { kind: "throw", error: "still failing" };
    world.owed = [openRow({ status: "capped", referrer_reward: "none", referee_reward: null, grant_attempts: REFERRAL_GRANT_MAX_ATTEMPTS - 1 })];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    await sweepReferralRewards(stub.client as never, deps);
    expect(referralUpdates(stub)).toContainEqual({ grant_attempts: REFERRAL_GRANT_MAX_ATTEMPTS });
    expect(referralUpdates(stub)).toContainEqual({ referee_reward: "none", referee_reward_detail: { kind: "none", reason: "grant_failed" } });
    error.mockRestore();
  });

  it("a deleted friend's owed side is closed as none", async () => {
    world.owed = [openRow({ status: "rewarded", referee_id: null, ladder_step: 1, referrer_reward: "banked_days", referee_reward: null })];
    const stub = db();
    await sweepReferralRewards(stub.client as never, deps);
    expect(referralUpdates(stub)).toContainEqual({ referee_reward: "none", referee_reward_detail: { kind: "none", reason: "account_deleted" } });
    expect(bankCalls()).toEqual([]);
  });
});

describe("advanceReferral is the one entry for both hooks", () => {
  it("qualifyReferral (the card save) and advanceReferral (the subscription) are the same step", async () => {
    world.refereeSub = { id: null, status: null };
    const stub = db();
    expect(await advanceReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    expect(await advanceReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
  });
});
