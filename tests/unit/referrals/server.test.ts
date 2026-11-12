import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";
// The days bank (lib/billing/day-bank.ts) is where every "days" reward
// lands; here it is a fake that records what it was asked (its own
// behaviour is day-bank.test.ts). The settings come from a fake read.
const bank = vi.hoisted(() => ({ bankDays: vi.fn(), releaseStaleReservations: vi.fn(async () => 0) }));
vi.mock("@/lib/billing/day-bank", () => bank);
const settingsServer = vi.hoisted(() => ({ readReferralSettings: vi.fn() }));
vi.mock("@/lib/referrals/settings-server", () => settingsServer);

import * as referralServer from "@/lib/referrals/server";
import {
  advanceReferral,
  noteReferralPlan,
  qualifyReferral,
  recordReferralSignup,
  rewardReferral,
  sweepReferralRewards,
} from "@/lib/referrals/server";
import { REFERRAL_CONFIRM_WINDOW_DAYS, REFERRAL_GRANT_MAX_ATTEMPTS, REFERRAL_SWEEP_BATCH } from "@/lib/referrals/rules";
import { DEFAULT_REFERRAL_SETTINGS, type ReferralSettings } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral flow on the service role, v2 (owner 2026-11-06; migration
// 0180) with the rule of 2026-11-11 (migration 0208): a signup through a
// link records ONE row (at onboarding, the email confirmed) and keeps the
// email's keyed fingerprint (nobody is told) — never for two accounts
// referring each other; the row QUALIFIES ON THE FRIEND'S CARDS ALONE — the
// settings' cards WITH ARTWORK OF THEIR OWN, each picture once, saved within
// the window: ONE count, the database's `referral_qualifying_cards` (0208),
// asked on every save (advanceReferral) and FAILING CLOSED (a count that
// errors or is no number is 0: nothing qualifies on a guess) — and the
// reward step runs AT ONCE: the program on, both
// emails confirmed (a lookup that FAILED waits, it is never "unconfirmed"),
// the key present (fail closed), the fraud rules, one email = one reward
// ever, the claim (claim_referral_reward_v2: the friends cap, the referrer's
// LADDER STEP), then each side's reward — DAYS INTO THE BANK under the
// reference `referral:<id>:referee` / `referral-step:<referrer>:<step>`, or
// credits — and one notification each. A failed grant is left owed for the
// sweep. A plan with a card on file is a FACT the row records
// (`card_on_file_at`: advanceReferral, and the webhook's noteReferralPlan)
// and a condition of nothing; nothing is banked ahead of a checkout.
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
  /** EVERY card the friend owns — what "is this account new" counts (the
   *  `cards` table, read by recordReferralSignup alone). */
  refereeCards: number;
  /** What `referral_qualifying_cards` answers — the friend's different
   *  pictures of their own, the only cards the bar counts. A number, as
   *  PostgREST hands a bigint; a test may script any other answer. */
  refereeQualifyingCards: unknown;
  /** The count's RPC fails (the function missing, the database away). */
  qualifyingError: { message: string } | null;
  /** The friend's subscription as the profile stores it (a plan with a card
   *  on file — a fact the row records, never a condition). */
  refereeSub: { id: string | null; status: string | null };
  insertError: { message: string; code?: string } | null;
  /** The friend's own open row (signed_up / cards_saved); null = none. */
  open: Row | null;
  /** The reciprocal read: rows where the CODE'S OWNER is the referee and
   *  the account claiming now is the referrer. */
  reciprocal: Row[];
  reciprocalError: { message: string } | null;
  /** The code lookup itself fails (not "no such code"). */
  codeError: { message: string } | null;
  profiles: Row[];
  users: Record<string, { email: string | null; confirmed: boolean }>;
  /** A sign-in lookup that FAILS for an account: GoTrue's error answer (its
   *  HTTP status), or a throw. */
  authFailures: Record<string, { status?: number; message: string } | "throw">;
  claim: { outcome: string; step: number | null } | null;
  inUse: boolean;
  seen: { referral_id: string | null } | null;
  pending: Row[];
  owed: Row[];
  stranded: Row[];
  /** What bankDays answers: ok, or a throw. */
  bank: { kind: "ok" } | { kind: "throw"; error: string };
  /** An entry under the friend's reference as the bank would hold it — a
   *  TRAP: nothing here reads or revokes bank entries any more (0180's
   *  pre-bank and its reclaim are gone), so no test may see it. */
  bankEntry: { id: string; status: string } | null;
  /** What the retired referrals_awaiting_plan would answer — a TRAP too:
   *  the sweep no longer asks. */
  awaiting: Row[];
  /** What the plan note's update answers (noteReferralPlan). */
  noteError: { message: string } | null;
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

/** The bar's one count (migration 0208): asked of the database, never
 *  counted from the `cards` table by the app. */
const COUNT_RPC = "referral_qualifying_cards";

function db() {
  const stub = chainClient((table: string, calls: ChainCall[]): ChainAnswer => {
    if (table === "referral_codes") {
      if (world.codeError) return { data: null, error: world.codeError };
      return { data: world.codeOwner ? { user_id: world.codeOwner } : null };
    }
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
    // The `cards` table answers "every card" — the not-new check's question.
    // The bar's count is the RPC below, a separate answer.
    if (table === "cards") return { count: world.refereeCards };
    if (table === "referral_email_fingerprints" && called(calls, "select")) return { data: world.seen };
    if (table === "day_bank_entries") {
      if (called(calls, "update")) return { data: world.bankEntry?.status === "banked" ? [{ id: world.bankEntry.id }] : [] };
      return { data: world.bankEntry };
    }
    if (table === "referrals" && called(calls, "insert")) {
      return world.insertError ? { data: null, error: world.insertError } : { data: { id: REFERRAL } };
    }
    if (table === "referrals" && called(calls, "update") && !called(calls, "select")) {
      // The plan note (referee_id + card_on_file_at IS NULL), an expiry, a
      // side's record, the attempt count.
      if (world.noteError && called(calls, "eq", "referee_id") && called(calls, "is", "card_on_file_at")) {
        return { data: null, error: world.noteError };
      }
      return { data: null };
    }
    if (table === "referrals" && called(calls, "update") && called(calls, "select")) {
      // The cards move (status = signed_up), the plan's stamp
      // (card_on_file_at IS NULL) or a settle (status IN qualified).
      if (called(calls, "eq", "status")) return { data: world.open?.status === "signed_up" ? [{ id: REFERRAL }] : [] };
      if (called(calls, "is", "card_on_file_at")) return { data: world.open?.card_on_file_at ? [] : [{ id: REFERRAL }] };
      return { data: [{ id: REFERRAL }] };
    }
    if (table === "referrals" && called(calls, "select")) {
      // The reciprocal guard names BOTH sides; the open row only the friend.
      if (called(calls, "eq", "referrer_id")) {
        return world.reciprocalError ? { data: null, error: world.reciprocalError } : { data: world.reciprocal };
      }
      if (called(calls, "eq", "referee_id")) return { data: world.open };
      if (called(calls, "or")) return { data: world.owed };
      // The sweep's qualified rows. A read that still asked for a plan
      // (card_on_file_at IS NOT NULL — 0180's rule) gets only those rows.
      return {
        data: called(calls, "not", "card_on_file_at") ? world.pending.filter((row) => row.card_on_file_at != null) : world.pending,
      };
    }
    return {};
  });
  stub.rpc.mockImplementation((async (name: string) => {
    if (name === COUNT_RPC) {
      return world.qualifyingError ? { data: null, error: world.qualifyingError } : { data: world.refereeQualifyingCards, error: null };
    }
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
          const failure = world.authFailures[id];
          if (failure === "throw") throw new Error("auth is away");
          if (failure) return { data: { user: null }, error: failure };
          const user = world.users[id];
          return {
            data: { user: user ? { email: user.email, email_confirmed_at: user.confirmed ? at(-3) : null } : null },
            error: null,
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
const referralInserts = (stub: ReturnType<typeof db>) => stub.forTable("referrals").filter((e) => called(e.calls, "insert"));
/** A qualified row moved to a final state (settleQualified's own filter). */
const settles = (stub: ReturnType<typeof db>) =>
  stub
    .forTable("referrals")
    .filter((e) => called(e.calls, "update") && called(e.calls, "in", "status"))
    .map((e) => payloadOf(e.calls, "update") as Record<string, unknown>);
const rpcNames = (stub: ReturnType<typeof db>) => stub.rpc.mock.calls.map((c) => (c as unknown[])[0]);
/** The count's calls, with their arguments. */
const countCalls = (stub: ReturnType<typeof db>) =>
  stub.rpc.mock.calls.map((c) => c as unknown[]).filter((c) => c[0] === COUNT_RPC);

function freshWorld(): World {
  return {
    codeOwner: REFERRER,
    refereeCreatedAt: at(-0.01),
    refereeStatus: null,
    refereeCards: 5,
    refereeQualifyingCards: 5,
    qualifyingError: null,
    // NO plan, no card on file: the default friend. A referral rewards on
    // the cards alone, so every reward below is earned without one.
    refereeSub: { id: null, status: null },
    insertError: null,
    open: openRow(),
    reciprocal: [],
    reciprocalError: null,
    codeError: null,
    profiles: [
      { id: REFERRER, subscription_tier: "free" },
      { id: REFEREE, subscription_tier: "free" },
    ],
    users: {
      [REFERRER]: { email: "ref@gmail.com", confirmed: true },
      [REFEREE]: { email: "friend@outlook.com", confirmed: true },
    },
    authFailures: {},
    claim: { outcome: "rewarded", step: 1 },
    inUse: false,
    seen: null,
    pending: [],
    owed: [],
    stranded: [],
    bank: { kind: "ok" },
    bankEntry: null,
    awaiting: [],
    noteError: null,
    settings: DEFAULT_REFERRAL_SETTINGS,
  };
}

const deps = { now: NOW, billingEnabled: true } as const;
const FRIEND_REF = `referral:${REFERRAL}:referee`;
const stepRef = (n: number) => `referral-step:${REFERRER}:${n}`;
/** A plan with a card on file, as the profile stores it. */
const PLAN = { id: "sub_friend", status: "trialing" } as const;

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
    const insert = referralInserts(stub)[0];
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

  it("refuses a bad or unknown code and your own code before any referral is read, and an account that isn't new without writing one", async () => {
    world.refereeCards = 0;
    let stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "<script>", now: NOW })).toEqual({ ok: false, reason: "bad_code" });
    expect(stub.log).toEqual([]);
    world.codeOwner = null;
    stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "unknown_code" });
    expect(stub.forTable("referrals")).toEqual([]);
    world.codeOwner = REFEREE;
    stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "self" });
    // Your own code is refused BEFORE the reciprocal read (it would name you twice).
    expect(stub.forTable("referrals")).toEqual([]);
    for (const change of [
      () => (world.refereeCreatedAt = at(-8)),
      () => (world.refereeStatus = "canceled"),
      () => (world.refereeCards = 5),
    ]) {
      world = freshWorld();
      world.refereeCards = 0;
      change();
      const refused = db();
      expect(await recordReferralSignup(refused.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "not_new" });
      // Nothing written: no row, no fingerprint (the one referrals chain is the reciprocal READ).
      expect(referralInserts(refused)).toEqual([]);
      expect(referralUpdates(refused)).toEqual([]);
      expect(refused.forTable("referral_email_fingerprints")).toEqual([]);
    }
  });

  it("\"not new\" counts EVERY saved card through the `cards` table — the artwork rule is the bar's, not this check's: five title-only cards still refuse the claim, and the bar's count is never asked", async () => {
    world.refereeCards = 5;
    world.refereeQualifyingCards = 0;
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "not_new" });
    expect(stub.forTable("cards").map((e) => e.calls)).toEqual([
      [
        { method: "select", args: ["id", { count: "exact", head: true }] },
        { method: "eq", args: ["owner_id", REFEREE] },
      ],
    ]);
    expect(rpcNames(stub)).not.toContain(COUNT_RPC);
    // …and the other way round: under the bar by EVERY card, the account is
    // new whatever the bar's count would say — it is not this check's.
    world = freshWorld();
    world.refereeCards = 4;
    world.refereeQualifyingCards = 9;
    const under = db();
    expect(await recordReferralSignup(under.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: true, referralId: REFERRAL });
    expect(rpcNames(under)).not.toContain(COUNT_RPC);
  });

  it("a friend with a card or two already (a guest draft) is still new — only the bar's cards refuse", async () => {
    world.refereeCards = 4;
    world.refereeQualifyingCards = 4;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toMatchObject({ ok: true });
  });

  it("first claim wins: a second claim for the same account is 'exists'", async () => {
    world.refereeCards = 0;
    world.insertError = { message: "duplicate", code: "23505" };
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "exists" });
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
  });

  // Owner 2026-11-11: with the card gone as the fraud bar, two accounts that
  // refer EACH OTHER bring in nobody — both would collect both sides. The
  // first of the pair stands; the claim back is refused.
  it("a code lookup that FAILS is an error the caller retries — never 'unknown code' — and nothing is written", async () => {
    world.refereeCards = 0;
    world.codeError = { message: "connection reset" };
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "error" });
    expect(stub.forTable("referrals")).toEqual([]);
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
    // …while a code nobody has is still "unknown".
    world.codeError = null;
    world.codeOwner = null;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "unknown_code" });
  });

  it("RECIPROCAL: the code's owner was themselves referred by this account — refused, no row, no fingerprint", async () => {
    world.refereeCards = 0;
    world.reciprocal = [{ id: OTHER_REFERRAL }];
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "reciprocal" });
    // The read names the pair the other way round: the OWNER as the friend,
    // this account as the referrer — any status, one row is enough.
    expect(stub.forTable("referrals").map((e) => e.calls)).toEqual([
      [
        { method: "select", args: ["id"] },
        { method: "eq", args: ["referee_id", REFERRER] },
        { method: "eq", args: ["referrer_id", REFEREE] },
        { method: "limit", args: [1] },
      ],
    ]);
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
    expect(notifications(stub)).toEqual([]);
  });

  it("RECIPROCAL: no such row — the claim goes on; the read FAILING is an error (retried at onboarding), never a claim on a guess", async () => {
    world.refereeCards = 0;
    const clean = db();
    expect(await recordReferralSignup(clean.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: true, referralId: REFERRAL });
    // The guard ran before the row was written.
    const order = clean.forTable("referrals").map((e) => (called(e.calls, "insert") ? "insert" : "read"));
    expect(order).toEqual(["read", "insert"]);

    world = freshWorld();
    world.refereeCards = 0;
    world.reciprocalError = { message: "connection reset" };
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "error" });
    expect(referralInserts(stub)).toEqual([]);
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
  });

  it("a sign-in lookup that fails at signup: the row still lands, with no fingerprint (never a hash of nothing)", async () => {
    world.refereeCards = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const failure of [{ status: 500, message: "upstream" }, "throw"] as const) {
      world = freshWorld();
      world.refereeCards = 0;
      world.authFailures[REFEREE] = failure;
      const stub = db();
      expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: true, referralId: REFERRAL });
      expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
    }
    warn.mockRestore();
  });
});

describe("advanceReferral — the cards alone, then the reward at once", () => {
  it("the cards saved and NO plan, both confirmed: the row moves and is stamped, the claim takes step 1, each side's days go into the bank under its own reference, one notification each", async () => {
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
    // No plan: nothing is stamped for one — and nothing waited for it.
    expect(referralUpdates(stub).some((u) => "card_on_file_at" in u)).toBe(false);
    // The email check ran before the claim, on the normalized address.
    expect(stub.rpc).toHaveBeenCalledWith("referral_email_in_use", { p_user_id: REFEREE, p_normalized: "friend@outlook.com" });
    const names = rpcNames(stub);
    expect(names.indexOf("referral_email_in_use")).toBeLessThan(names.indexOf("claim_referral_reward_v2"));
    // Every day banked went through bankDays: the bank's table is never touched here.
    expect(stub.forTable("day_bank_entries")).toEqual([]);
  });

  it("a friend who ALSO holds a plan with a card on file: the fact is stamped once (card_on_file_at IS NULL) and the reward is the same", async () => {
    world.refereeSub = { ...PLAN };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({
      status: "rewarded",
      referrer: { kind: "banked_days", days: 7, step: 1 },
      referee: { kind: "banked_days", days: 7 },
      step: 1,
    });
    const stamped = stub.forTable("referrals").filter((e) => called(e.calls, "update") && called(e.calls, "is", "card_on_file_at"));
    expect(stamped).toHaveLength(1);
    expect(payloadOf(stamped[0].calls, "update")).toEqual({ card_on_file_at: NOW.toISOString() });
    expect(stamped[0].calls.find((c) => c.method === "eq")?.args).toEqual(["id", REFERRAL]);
    // Every status Stripe only gives a subscription with a payment method is the fact…
    for (const status of ["trialing", "active", "past_due", "unpaid"]) {
      world = freshWorld();
      world.refereeSub = { id: "sub_x", status };
      const plan = db();
      await qualifyReferral(plan.client as never, REFEREE, deps);
      expect(referralUpdates(plan), status).toContainEqual({ card_on_file_at: NOW.toISOString() });
    }
    // …an ended plan, an unfinished one, or a status with no subscription id is not —
    // and the friend is rewarded all the same.
    for (const sub of [
      { id: "sub_x", status: "canceled" },
      { id: "sub_x", status: "incomplete" },
      { id: null, status: "active" },
    ]) {
      world = freshWorld();
      world.refereeSub = sub;
      const none = db();
      expect(await qualifyReferral(none.client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
      expect(referralUpdates(none).some((u) => "card_on_file_at" in u)).toBe(false);
    }
    // A row already stamped is not stamped again.
    world = freshWorld();
    world.refereeSub = { ...PLAN };
    world.open = openRow({ card_on_file_at: at(-1) });
    const again = db();
    expect(await qualifyReferral(again.client as never, REFEREE, deps)).toMatchObject({ status: "rewarded" });
    expect(referralUpdates(again).some((u) => "card_on_file_at" in u)).toBe(false);
  });

  it("no open row (a second run, or no referral): nothing", async () => {
    world.open = null;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "none" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("fewer cards than the bar: waiting, nothing stamped, no claim", async () => {
    world.refereeCards = 4;
    world.refereeQualifyingCards = 4;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    expect(referralUpdates(stub).some((u) => "cards_saved_at" in u)).toBe(false);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(bankCalls()).toEqual([]);
  });

  // Owner 2026-11-11: a title-only card is a second's work, a built-in image
  // costs nothing and one upload on five cards is one picture — and the card
  // on file was the bar that kept such accounts out. Only cards WITH ARTWORK
  // OF THEIR OWN count now, each picture once: ONE count, in the database
  // (0208's referral_qualifying_cards — its SQL is the migration's tests').
  it("ONLY THE DATABASE'S COUNT DECIDES: nine saved cards of which four count is under the bar — a plan changes nothing", async () => {
    world.refereeCards = 9;
    world.refereeQualifyingCards = 4;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    expect(referralUpdates(stub).some((u) => "cards_saved_at" in u)).toBe(false);
    // The count is the one thing asked of the database's functions: no email
    // check, no claim.
    expect(rpcNames(stub)).toEqual([COUNT_RPC]);
    expect(bankCalls()).toEqual([]);
    expect(notifications(stub)).toEqual([]);
    world = freshWorld();
    world.refereeCards = 9;
    world.refereeQualifyingCards = 4;
    world.refereeSub = { ...PLAN };
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    // The fifth card that counts is the one that qualifies.
    world = freshWorld();
    world.refereeCards = 9;
    world.refereeQualifyingCards = 5;
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
    // …and the count of EVERY card is nothing to the bar: forty saved cards
    // that share one picture are one card made.
    world = freshWorld();
    world.refereeCards = 40;
    world.refereeQualifyingCards = 1;
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    // The bar is the settings' own number.
    world = freshWorld();
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, activation: { cardsRequired: 3, windowDays: 30 } };
    world.refereeQualifyingCards = 3;
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
    world = freshWorld();
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, activation: { cardsRequired: 6, windowDays: 30 } };
    world.refereeQualifyingCards = 5;
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
  });

  it("the count is ONE call of the database's function, with exactly { p_owner: <the friend> } — and the app never reads the `cards` table for the bar", async () => {
    expect("QUALIFYING_CARD" in referralServer).toBe(false);
    // A friend who qualifies…
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
    expect(countCalls(stub)).toEqual([[COUNT_RPC, { p_owner: REFEREE }]]);
    expect(stub.forTable("cards")).toEqual([]);
    // …the count comes first of the database's functions (nothing is checked
    // or claimed for a friend who has not the cards).
    expect(rpcNames(stub)[0]).toBe(COUNT_RPC);
    // …and one who does not.
    world = freshWorld();
    world.refereeCards = 9;
    world.refereeQualifyingCards = 2;
    const under = db();
    expect(await advanceReferral(under.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    expect(countCalls(under)).toEqual([[COUNT_RPC, { p_owner: REFEREE }]]);
    expect(under.forTable("cards")).toEqual([]);
    // The friend's id is the row's own — never the referrer's.
    expect(JSON.stringify(countCalls(under))).not.toContain(REFERRER);
    // The sweep's stranded friend is counted the same way.
    world = freshWorld();
    world.stranded = [{ id: REFERRAL, referee_id: REFEREE }];
    const swept = db();
    await sweepReferralRewards(swept.client as never, deps);
    expect(countCalls(swept)).toEqual([[COUNT_RPC, { p_owner: REFEREE }]]);
    expect(swept.forTable("cards")).toEqual([]);
  });

  it("FAILS CLOSED: a count that ERRORS counts 0 — the row waits (not_qualified), nothing is stamped, checked, claimed or banked, and the failure is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The friend has every card the bar asks for — by any other read.
      world.refereeCards = 9;
      world.refereeQualifyingCards = 9;
      world.qualifyingError = { message: "Could not find the function public.referral_qualifying_cards(p_owner) in the schema cache" };
      const stub = db();
      expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
      expect(referralUpdates(stub)).toEqual([]);
      expect(rpcNames(stub)).toEqual([COUNT_RPC]);
      expect(countCalls(stub)).toEqual([[COUNT_RPC, { p_owner: REFEREE }]]);
      expect(bankCalls()).toEqual([]);
      expect(notifications(stub)).toEqual([]);
      // No fallback count from the table either.
      expect(stub.forTable("cards")).toEqual([]);
      expect(error).toHaveBeenCalledTimes(1);
      const logged = error.mock.calls[0].map(String).join(" ");
      expect(logged).toContain(REFEREE);
      expect(logged).toContain("Could not find the function");
      // With a plan on file the fact is still noted — and still nothing qualifies.
      world = freshWorld();
      world.qualifyingError = { message: "statement timeout" };
      world.refereeSub = { ...PLAN };
      const withPlan = db();
      expect(await qualifyReferral(withPlan.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
      expect(referralUpdates(withPlan)).toEqual([{ card_on_file_at: NOW.toISOString() }]);
      expect(rpcNames(withPlan)).toEqual([COUNT_RPC]);
      expect(error).toHaveBeenCalledTimes(2);
      // The sweep: a stranded friend whose count fails waits for the next run.
      world = freshWorld();
      world.qualifyingError = { message: "statement timeout" };
      world.stranded = [{ id: REFERRAL, referee_id: REFEREE }];
      const swept = db();
      expect(await sweepReferralRewards(swept.client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 1, retried: 0, failed: 0, released: 0 });
      expect(rpcNames(swept)).not.toContain("claim_referral_reward_v2");
      expect(bankCalls()).toEqual([]);
      // A count that works again qualifies the same friend.
      world = freshWorld();
      expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
      expect(error).toHaveBeenCalledTimes(3);
    } finally {
      error.mockRestore();
    }
  });

  it("FAILS CLOSED: an answer that is no count — null, a negative, NaN, an infinity, text, an object, a boolean — is 0: nothing qualifies on it", async () => {
    for (const answer of [null, undefined, -5, -1, Number.NaN, Number.POSITIVE_INFINITY, "", "five", "Infinity", "-7", {}, [5], true, [{ count: 5 }]]) {
      world = freshWorld();
      world.refereeCards = 9;
      world.refereeQualifyingCards = answer;
      const stub = db();
      expect(await qualifyReferral(stub.client as never, REFEREE, deps), JSON.stringify(answer) ?? String(answer)).toEqual({
        status: "waiting",
        reason: "not_qualified",
      });
      expect(referralUpdates(stub)).toEqual([]);
      expect(rpcNames(stub)).toEqual([COUNT_RPC]);
    }
    expect(bankCalls()).toEqual([]);
  });

  it("a bigint handed back as TEXT is read as its number: \"5\" qualifies, \"4\" does not — and a fraction is read down, never up", async () => {
    world.refereeQualifyingCards = "5";
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
    expect(referralUpdates(stub)[0]).toEqual({ status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() });
    for (const [answer, qualifies] of [
      ["4", false],
      ["12", true],
      ["05", true],
      [4.9, false],
      ["4.9", false],
      [5.9, true],
      [7, true],
    ] as const) {
      world = freshWorld();
      world.refereeQualifyingCards = answer;
      const result = await qualifyReferral(db().client as never, REFEREE, deps);
      expect(result.status, String(answer)).toBe(qualifies ? "rewarded" : "waiting");
    }
  });

  it("the cards and NO plan — a card on file is no bar any more: the cards are stamped (once), nothing is stamped for a plan, and the row is CLAIMED, not left waiting", async () => {
    world.refereeSub = { id: null, status: null };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
    expect(referralUpdates(stub)[0]).toEqual({ status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() });
    expect(referralUpdates(stub).filter((u) => "cards_saved_at" in u)).toHaveLength(1);
    expect(rpcNames(stub)).toContain("claim_referral_reward_v2");
    // A plan that ended is the same friend: rewarded on the cards.
    world = freshWorld();
    world.refereeSub = { id: "sub_x", status: "canceled" };
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
    // …and so is a row whose cards were stamped on an earlier save (0180 left
    // such rows waiting for a plan): the next save claims it.
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-3) });
    const later = db();
    expect(await qualifyReferral(later.client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
    // The stamp it had is kept (no second cards move, no count needed — a
    // count that fails now cannot take a qualified row back).
    expect(referralUpdates(later).some((u) => "cards_saved_at" in u)).toBe(false);
    expect(rpcNames(later)).not.toContain(COUNT_RPC);
    expect(later.forTable("cards")).toEqual([]);
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-3) });
    world.qualifyingError = { message: "statement timeout" };
    world.refereeQualifyingCards = 0;
    expect(await qualifyReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
  });

  it("rewardReferral itself asks for the cards stamp only: a qualified row with NO card_on_file_at is claimed", async () => {
    for (const row of [
      openRow({ status: "cards_saved", cards_saved_at: at(-1), card_on_file_at: null }),
      // 0177's name for the same state.
      openRow({ status: "first_card", first_card_at: at(-1), card_on_file_at: null }),
    ]) {
      bank.bankDays.mockClear();
      const stub = db();
      expect(await rewardReferral(stub.client as never, row as never, deps)).toMatchObject({ status: "rewarded", step: 1 });
      expect(bankCalls().map((c) => c.source)).toEqual(["referral_friend", "referral_step"]);
    }
    // No cards stamp at all is still not qualified; a row not in a qualified state is nothing.
    expect(await rewardReferral(db().client as never, openRow({ status: "cards_saved", card_on_file_at: at(-1) }) as never, deps)).toEqual({
      status: "waiting",
      reason: "not_qualified",
    });
    expect(await rewardReferral(db().client as never, openRow({ status: "signed_up", card_on_file_at: at(-1) }) as never, deps)).toEqual({ status: "none" });
  });

  it("the cards saved past the window: expired, nobody rewarded", async () => {
    world.open = openRow({ signed_up_at: at(-31) });
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "expired" });
    expect(referralUpdates(stub).at(-1)).toEqual({ status: "expired", referrer_reward: "none", referee_reward: "none" });
    // The count, and nothing after it: no email check, no claim.
    expect(rpcNames(stub)).toEqual([COUNT_RPC]);
    // Past the window WITHOUT the cards nothing is expired by a save (the
    // sweep's own expiry does that): the row waits.
    world = freshWorld();
    world.open = openRow({ signed_up_at: at(-31) });
    world.refereeQualifyingCards = 4;
    const under = db();
    expect(await qualifyReferral(under.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "not_qualified" });
    expect(referralUpdates(under)).toEqual([]);
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
      // The count alone: no email-reuse check, no claim.
      expect(rpcNames(stub)).toEqual([COUNT_RPC]);
      expect(notifications(stub)).toEqual([]);
      expect(bankCalls()).toEqual([]);
    }
    world = freshWorld();
    world.users[REFEREE].confirmed = false;
    // An entry under the friend's reference that a checkout already used: the
    // settle below never looks (0180 named it `spent` on the row).
    world.bankEntry = { id: "e_pre", status: "applied" };
    const late = openRow({ status: "cards_saved", cards_saved_at: at(-(REFERRAL_CONFIRM_WINDOW_DAYS + 1)) });
    const stub = db();
    expect(await rewardReferral(stub.client as never, late as never, deps)).toEqual({ status: "expired" });
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(referralUpdates(stub)).toEqual([
      { status: "expired", referrer_reward: "none", referee_reward: "none", referee_reward_detail: { kind: "none", reason: "expired" } },
    ]);
    expect(stub.forTable("day_bank_entries")).toEqual([]);
    // Inside the window the same row waits.
    world = freshWorld();
    world.users[REFEREE].confirmed = false;
    const early = openRow({ status: "cards_saved", cards_saved_at: at(-(REFERRAL_CONFIRM_WINDOW_DAYS - 1)) });
    const waits = db();
    expect(await rewardReferral(waits.client as never, early as never, deps)).toEqual({ status: "waiting", reason: "email_unconfirmed" });
    expect(referralUpdates(waits)).toEqual([]);
  });

  // 2026-11-11: with the card gone a confirmed inbox is the one identity
  // check left, and a FAILED read of it used to read as "unconfirmed" — past
  // the confirm window that expired a legitimate referral for good on one
  // auth hiccup.
  it("a sign-in lookup that FAILED (either side; an error answer or a throw) is a wait — check_failed — and NOTHING is written: the row is not expired even long past the confirm window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const late = () => openRow({ status: "cards_saved", cards_saved_at: at(-(REFERRAL_CONFIRM_WINDOW_DAYS + 10)) });
    for (const who of [REFEREE, REFERRER]) {
      for (const failure of [{ status: 500, message: "upstream" }, { message: "no status at all" }, { status: 429, message: "slow down" }, "throw"] as const) {
        world = freshWorld();
        world.authFailures[who] = failure;
        const stub = db();
        expect(await rewardReferral(stub.client as never, late() as never, deps), `${who} ${JSON.stringify(failure)}`).toEqual({
          status: "waiting",
          reason: "check_failed",
        });
        expect(referralUpdates(stub)).toEqual([]);
        expect(stub.rpc).not.toHaveBeenCalled();
        expect(bankCalls()).toEqual([]);
        expect(notifications(stub)).toEqual([]);
        expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
      }
    }
    // The failed side decides even when the OTHER side is really unconfirmed:
    // nothing can be said about the pair yet.
    world = freshWorld();
    world.authFailures[REFERRER] = { status: 503, message: "unavailable" };
    world.users[REFEREE].confirmed = false;
    const mixed = db();
    expect(await rewardReferral(mixed.client as never, late() as never, deps)).toEqual({ status: "waiting", reason: "check_failed" });
    expect(referralUpdates(mixed)).toEqual([]);
    // Through the card-save hook too: the cards are stamped, then the row waits.
    world = freshWorld();
    world.authFailures[REFEREE] = "throw";
    const hook = db();
    expect(await qualifyReferral(hook.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "check_failed" });
    expect(referralUpdates(hook)).toEqual([{ status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("an account GoTrue does not know (404) is no failure: it is an unconfirmed address — the row waits inside the window and expires past it, as before", async () => {
    world.authFailures[REFEREE] = { status: 404, message: "User not found" };
    const inside = db();
    expect(await rewardReferral(inside.client as never, openRow({ status: "cards_saved", cards_saved_at: at(-1) }) as never, deps)).toEqual({
      status: "waiting",
      reason: "email_unconfirmed",
    });
    expect(referralUpdates(inside)).toEqual([]);
    const past = db();
    const late = openRow({ status: "cards_saved", cards_saved_at: at(-(REFERRAL_CONFIRM_WINDOW_DAYS + 1)) });
    expect(await rewardReferral(past.client as never, late as never, deps)).toEqual({ status: "expired" });
    expect(settles(past)).toEqual([
      { status: "expired", referrer_reward: "none", referee_reward: "none", referee_reward_detail: { kind: "none", reason: "expired" } },
    ]);
  });

  it("billing off: nothing happens (the row waits)", async () => {
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, { now: NOW, billingEnabled: false })).toEqual({ status: "waiting", reason: "billing_off" });
    expect(rpcNames(stub)).toEqual([COUNT_RPC]);
    expect(notifications(stub)).toEqual([]);
  });

  it("no hash key: FAIL CLOSED — no email check, no claim, nothing banked", async () => {
    vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", "too-short");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "hash_key_missing" });
    expect(rpcNames(stub)).toEqual([COUNT_RPC]);
    expect(bankCalls()).toEqual([]);
    error.mockRestore();
  });

  it("one email, one reward (a): another LIVE account has the friend's normalized address — nobody rewarded, the friend not told", async () => {
    world.users[REFEREE].email = "Jo.Smith+2@googlemail.com";
    world.inUse = true;
    world.bankEntry = { id: "e_pre", status: "applied" };
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
    expect(stub.forTable("day_bank_entries")).toEqual([]);
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
    stub.rpc.mockImplementation((async (name: string) => {
      if (name === COUNT_RPC) return { data: 5, error: null };
      return name === "referral_email_in_use" ? { data: null, error: { message: "down" } } : { data: null, error: null };
    }) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "check_failed" });
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    warn.mockRestore();
  });

  it("a friend whose account was deleted before the reward step — plan or no plan: blocked, nobody rewarded, the detail the reason alone", async () => {
    for (const cardOnFile of [null, at(-1)]) {
      world = freshWorld();
      world.bankEntry = { id: "e_pre", status: "reserved" };
      const stub = db();
      const row = openRow({ status: "cards_saved", cards_saved_at: at(-1), card_on_file_at: cardOnFile, referee_id: null });
      expect(await rewardReferral(stub.client as never, row as never, deps)).toEqual({ status: "blocked", reason: "account_deleted", referee: null });
      expect(referralUpdates(stub)).toEqual([
        { status: "blocked", block_reason: "account_deleted", referrer_reward: "none", referee_reward: "none", referee_reward_detail: { kind: "none", reason: "account_deleted" } },
      ]);
      // Only a still-qualified row is settled (two runs can't both).
      const settle = stub.forTable("referrals").find((e) => called(e.calls, "update"))!;
      expect(settle.calls.find((c) => c.method === "in")?.args).toEqual(["status", ["cards_saved", "first_card"]]);
      expect(stub.rpc).not.toHaveBeenCalled();
      expect(stub.forTable("day_bank_entries")).toEqual([]);
    }
  });

  it("the same inbox: blocked, nobody rewarded, no cap consumed", async () => {
    world.users[REFEREE].email = "r.e.f+alt@gmail.com";
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "blocked", reason: "same_email", referee: null });
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(referralUpdates(stub).at(-1)).toEqual({
      status: "blocked",
      block_reason: "same_email",
      referrer_reward: "none",
      referee_reward: "none",
      referee_reward_detail: { kind: "none", reason: "same_email" },
    });
  });

  it("the same card fingerprint on both Stripe customers: blocked — the row's detail is the reason alone, and the bank is not touched", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "free", stripe_customer_id: "cus_a" },
      { id: REFEREE, subscription_tier: "free", stripe_customer_id: "cus_b" },
    ];
    const stripe = { paymentMethods: { list: vi.fn(async () => ({ data: [{ card: { fingerprint: "fp_same" } }] })) } };
    // What 0180's pre-bank left behind in each state. None is read, revoked
    // or named on the row (`spent` / `preBankedEntryId`) any more.
    for (const status of ["banked", "reserved", "applied"]) {
      world.bankEntry = { id: "e_pre", status };
      const stub = db();
      expect(await qualifyReferral(stub.client as never, REFEREE, { ...deps, stripe: stripe as never })).toEqual({ status: "blocked", reason: "same_card", referee: null });
      expect(referralUpdates(stub).at(-1)).toEqual({
        status: "blocked",
        block_reason: "same_card",
        referrer_reward: "none",
        referee_reward: "none",
        referee_reward_detail: { kind: "none", reason: "same_card" },
      });
      expect(stub.forTable("day_bank_entries")).toEqual([]);
      expect(bankCalls()).toEqual([]);
    }
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

  it("the friends cap (the settings' friendsPerMonth): NEITHER side is rewarded — N confirmable inboxes mint nothing; the cap is the CLAIM's alone and the capped row is the database's write", async () => {
    world.claim = { outcome: "capped_friends", step: null };
    for (const entry of [null, { id: "e_pre", status: "banked" }, { id: "e_pre", status: "reserved" }]) {
      world.bankEntry = entry;
      const stub = db();
      expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "capped", referrer: null, referee: null });
      expect(bankCalls()).toEqual([]);
      expect(notifications(stub)).toEqual([
        { recipient_id: REFERRER, actor_id: REFEREE, type: "referral_signup", payload: { referralId: REFERRAL, outcome: "capped_friends" } },
      ]);
      // The app writes the cards move and nothing after the claim: no detail
      // of its own on the capped row, no bank entry revoked or read.
      expect(referralUpdates(stub)).toEqual([{ status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() }]);
      expect(stub.forTable("day_bank_entries")).toEqual([]);
      // No month count of the app's own either (0180's pre-bank made one).
      expect(stub.forTable("referrals").some((e) => called(e.calls, "gte"))).toBe(false);
    }
  });

  it("a claim another run won (no row back): nothing", async () => {
    world.claim = null;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "none" });
    expect(bankCalls()).toEqual([]);
  });

  it("the program OFF (the admin switch) is a PAUSE: the stamps are written, then the row waits — nothing banked, nobody told, nothing settled", async () => {
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false };
    world.refereeSub = { ...PLAN };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "program_off" });
    expect(referralUpdates(stub)).toEqual([
      { status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() },
      { card_on_file_at: NOW.toISOString() },
    ]);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(bankCalls()).toEqual([]);
    expect(notifications(stub)).toEqual([]);
    // A friend with no plan: the cards stamp alone, and the same wait.
    world = freshWorld();
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false };
    const noPlan = db();
    expect(await qualifyReferral(noPlan.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "program_off" });
    expect(referralUpdates(noPlan)).toEqual([{ status: "cards_saved", cards_saved_at: NOW.toISOString(), first_card_at: NOW.toISOString() }]);
    expect(bankCalls()).toEqual([]);
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

// 0180 banked a friend's days from INSIDE their checkout (preBankFriendDays:
// the checkout that put the card on file was the one that qualified them) and
// took them back when the row ended with nothing (reclaimFriendDays). With no
// plan to wait for, the days are granted by the reward step and nowhere else.
describe("nothing is banked ahead of a checkout any more", () => {
  it("the pre-bank is not exported, and the module has no read or write of the bank's table, no month count of its own and no `spent` detail", () => {
    expect("preBankFriendDays" in referralServer).toBe(false);
    for (const name of ["reclaimFriendDays", "friendsCapReached", "noneDetail"]) expect(name in referralServer, name).toBe(false);
    const code = readFileSync(join(process.cwd(), "lib/referrals/server.ts"), "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join("\n");
    for (const gone of ["preBankFriendDays", "reclaimFriendDays", "friendsCapReached", "noneDetail", "day_bank_entries", "preBankedEntryId", "spent", "referrals_awaiting_plan"]) {
      expect(code, gone).not.toContain(gone);
    }
    // Days reach the bank through bankDays alone.
    expect(code).toMatch(/import \{ bankDays, releaseStaleReservations \} from "@\/lib\/billing\/day-bank";/);
  });

  it("a friend with the cards whose reward cannot be given yet (an unconfirmed email, the program off, no hash key) has NOTHING banked — the days come with the reward, never before it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const change of [
      () => (world.users[REFEREE].confirmed = false),
      () => (world.users[REFERRER].confirmed = false),
      () => (world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false }),
      () => vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", ""),
    ]) {
      world = freshWorld();
      world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
      change();
      const stub = db();
      expect(await advanceReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "waiting" });
      expect(stub.forTable("day_bank_entries")).toEqual([]);
      vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", TEST_KEY);
    }
    expect(bankCalls()).toEqual([]);
    error.mockRestore();
  });
});

describe("isCardOnFileStatus — what the webhook notes as a plan", () => {
  it("is the states Stripe only gives a subscription with a payment method — the list the admin's SQL reads too", () => {
    for (const status of ["trialing", "active", "past_due", "unpaid"]) expect(referralServer.isCardOnFileStatus(status)).toBe(true);
    for (const status of ["incomplete", "incomplete_expired", "canceled", "paused", "", null, undefined]) {
      expect(referralServer.isCardOnFileStatus(status)).toBe(false);
    }
    // admin_referred_friends' `referee_has_plan` (0208) names the same four.
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0208_referrals_cards_only.sql"), "utf8");
    expect(sql).toContain("in ('trialing', 'active', 'past_due', 'unpaid')");
  });
});

describe("noteReferralPlan — the webhook's note of a plan (a fact, never a condition)", () => {
  it("stamps card_on_file_at on the friend's referral, whatever its status, only where it is not stamped yet — one update, nothing else", async () => {
    const stub = db();
    await expect(noteReferralPlan(stub.client as never, REFEREE, NOW)).resolves.toBeUndefined();
    // No status filter (a rewarded, blocked or expired row is noted too), no
    // read first, no row id: the friend's row, where the stamp is NULL.
    expect(stub.log).toEqual([
      {
        table: "referrals",
        calls: [
          { method: "update", args: [{ card_on_file_at: NOW.toISOString() }] },
          { method: "eq", args: ["referee_id", REFEREE] },
          { method: "is", args: ["card_on_file_at", null] },
        ],
      },
    ]);
    // It rewards nothing: no claim, no days, nobody told — even for a friend
    // whose cards are saved (the default world's friend would qualify).
    expect(stub.rpc).not.toHaveBeenCalled();
    expect(bankCalls()).toEqual([]);
    expect(settingsServer.readReferralSettings).not.toHaveBeenCalled();
  });

  it("the stamp is the present moment when none is passed", async () => {
    const stub = db();
    const before = Date.now();
    await noteReferralPlan(stub.client as never, REFEREE);
    const stamp = Date.parse(String((payloadOf(stub.log[0].calls, "update") as { card_on_file_at: string }).card_on_file_at));
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(Date.now());
  });

  it("is best effort: an error answer or a client that throws is warned about and never thrown (the webhook awaits it bare)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    world.noteError = { message: "statement timeout" };
    await expect(noteReferralPlan(db().client as never, REFEREE, NOW)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const broken = {
      from: () => {
        throw new Error("no connection");
      },
    };
    await expect(noteReferralPlan(broken as never, REFEREE, NOW)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("sweepReferralRewards (the cron's retry)", () => {
  it("does nothing while billing is off", async () => {
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, { now: NOW, billingEnabled: false })).toEqual({ ok: true, skipped: "billing_off" });
    expect(stub.log).toEqual([]);
  });

  it("claims EVERY cards_saved row — a friend with no plan as one with a plan; the read asks for no plan, and the retired referrals_awaiting_plan is never called; the bank's stale reservations are released", async () => {
    // No plan, no card_on_file_at: 0180 left this row for ever.
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    world.pending = [{ ...world.open }];
    // What the retired RPC would hand back, were it asked.
    world.awaiting = [{ ...world.open }];
    bank.releaseStaleReservations.mockResolvedValueOnce(2);
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0, released: 2 });
    expect(rpcNames(stub)).toContain("claim_referral_reward_v2");
    expect(rpcNames(stub)).not.toContain("referrals_awaiting_plan");
    expect(bank.releaseStaleReservations).toHaveBeenCalledWith(stub.client, NOW);
    // The qualified rows: both names of the state, oldest cards first, one
    // batch — and NO filter on card_on_file_at.
    const read = stub.forTable("referrals")[0];
    expect(read.calls.map((c) => c.method)).toEqual(["select", "in", "order", "limit"]);
    expect(String(read.calls[0].args[0])).toContain("card_on_file_at");
    expect(read.calls.slice(1)).toEqual([
      { method: "in", args: ["status", ["cards_saved", "first_card"]] },
      { method: "order", args: ["cards_saved_at", { ascending: true, nullsFirst: true }] },
      { method: "limit", args: [REFERRAL_SWEEP_BATCH] },
    ]);

    // A friend who does hold a plan is claimed the same way.
    world = freshWorld();
    world.refereeSub = { ...PLAN };
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1), card_on_file_at: at(-1) });
    world.pending = [{ ...world.open }];
    const withPlan = db();
    expect(await sweepReferralRewards(withPlan.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0, released: 0 });
    expect(rpcNames(withPlan)).not.toContain("referrals_awaiting_plan");
  });

  it("a qualified row that cannot be claimed YET is counted as waiting and left as it is: an unconfirmed email, and a lookup that failed — never expired on a failure, however old", async () => {
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-2) });
    world.pending = [{ ...world.open }];
    world.users[REFEREE].confirmed = false;
    const unconfirmed = db();
    expect(await sweepReferralRewards(unconfirmed.client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 1, retried: 0, failed: 0, released: 0 });
    expect(settles(unconfirmed)).toEqual([]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-(REFERRAL_CONFIRM_WINDOW_DAYS + 30)) });
    world.pending = [{ ...world.open }];
    world.authFailures[REFERRER] = { status: 500, message: "upstream" };
    const failed = db();
    expect(await sweepReferralRewards(failed.client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 1, retried: 0, failed: 0, released: 0 });
    expect(settles(failed)).toEqual([]);
    expect(rpcNames(failed)).not.toContain("claim_referral_reward_v2");
    expect(bankCalls()).toEqual([]);
    warn.mockRestore();

    // The same old row with the lookup working and the email really
    // unconfirmed IS expired — the window still stands.
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-(REFERRAL_CONFIRM_WINDOW_DAYS + 30)) });
    world.pending = [{ ...world.open }];
    world.users[REFEREE].confirmed = false;
    const expired = db();
    expect(await sweepReferralRewards(expired.client as never, deps)).toMatchObject({ claimed: 1, waiting: 0 });
    expect(settles(expired)).toEqual([
      { status: "expired", referrer_reward: "none", referee_reward: "none", referee_reward_detail: { kind: "none", reason: "expired" } },
    ]);
  });

  it("a qualified row whose friend is GONE (no referee_id, never a plan) still goes through the reward step: settled as blocked account_deleted, so it does not wait for ever", async () => {
    world.pending = [openRow({ status: "cards_saved", cards_saved_at: at(-4), card_on_file_at: null, referee_id: null })];
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0, released: 0 });
    expect(settles(stub)).toEqual([
      { status: "blocked", block_reason: "account_deleted", referrer_reward: "none", referee_reward: "none", referee_reward_detail: { kind: "none", reason: "account_deleted" } },
    ]);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward_v2");
    expect(bankCalls()).toEqual([]);
    expect(notifications(stub)).toEqual([]);
    // The friend's own row was never looked up (there is no friend to ask for).
    expect(stub.forTable("referrals").some((e) => called(e.calls, "eq", "referee_id"))).toBe(false);
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

  it("a STRANDED signup (a lost after()): a signed_up row older than ten minutes whose friend has the cards is advanced — and claimed with no plan; signups past the window expire", async () => {
    world.stranded = [{ id: REFERRAL, referee_id: REFEREE }];
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0, released: 0 });
    expect(rpcNames(stub)).toContain("claim_referral_reward_v2");
    const expiry = stub.forTable("referrals").find((e) => called(e.calls, "update") && called(e.calls, "eq", "status") && called(e.calls, "lt"))!;
    expect(payloadOf(expiry.calls, "update")).toEqual({ status: "expired", referrer_reward: "none", referee_reward: "none" });
    expect(expiry.calls.find((c) => c.method === "eq")?.args).toEqual(["status", "signed_up"]);
    expect(expiry.calls.find((c) => c.method === "lt")?.args).toEqual(["signed_up_at", new Date(NOW.getTime() - 30 * DAY).toISOString()]);
    // The read is the database's (the card count judged there — 0208: the
    // same referral_qualifying_cards): before now − 10 min, inside the
    // window, the bar's cards.
    expect(stub.rpc).toHaveBeenCalledWith("referrals_stranded_signups", {
      p_cards: 5,
      p_since: new Date(NOW.getTime() - 30 * DAY).toISOString(),
      p_until: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
      p_limit: REFERRAL_SWEEP_BATCH,
    });
    // The sweep's own RPCs are the stranded read alone (the reward step's
    // are the email check and the claim).
    expect(rpcNames(stub).filter((name) => String(name).startsWith("referrals_"))).toEqual(["referrals_stranded_signups"]);
    // The app judges the stranded friend's cards again, by the same count.
    world = freshWorld();
    world.stranded = [{ id: REFERRAL, referee_id: REFEREE }];
    world.refereeQualifyingCards = 4;
    expect(await sweepReferralRewards(db().client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 1, retried: 0, failed: 0, released: 0 });
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

describe("advanceReferral is the card save's step", () => {
  it("qualifyReferral (the card-save hook's name) and advanceReferral are the same step: a friend with the cards and no plan is rewarded by either", async () => {
    const hook = db();
    const viaHook = await qualifyReferral(hook.client as never, REFEREE, deps);
    world = freshWorld();
    const direct = db();
    const viaAdvance = await advanceReferral(direct.client as never, REFEREE, deps);
    expect(viaAdvance).toEqual(viaHook);
    expect(viaAdvance).toMatchObject({ status: "rewarded", step: 1 });
    expect(direct.log).toEqual(hook.log);
    expect(direct.rpc.mock.calls).toEqual(hook.rpc.mock.calls);
    // …and a row stamped on an earlier save, still with no plan.
    world = freshWorld();
    world.open = openRow({ status: "cards_saved", cards_saved_at: at(-1) });
    expect(await advanceReferral(db().client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", step: 1 });
  });
});
