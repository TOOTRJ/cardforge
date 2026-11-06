import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer, type ChainCall } from "@/tests/stubs/supabase-chain";
// The free-days writer (lib/billing/free-days-apply.ts) is the one
// mechanism; here it is a fake that records what it was asked and answers
// what the world says (its own behaviour is free-days-apply.test.ts).
const freeDays = vi.hoisted(() => ({ grantFreeDays: vi.fn() }));
vi.mock("@/lib/billing/free-days-apply", () => freeDays);
const settingsServer = vi.hoisted(() => ({ readReferralSettings: vi.fn() }));
vi.mock("@/lib/referrals/settings-server", () => settingsServer);

import { qualifyReferral, recordReferralSignup, rewardReferral, sweepReferralRewards } from "@/lib/referrals/server";
import { REFERRAL_GRANT_MAX_ATTEMPTS } from "@/lib/referrals/rules";
import { DEFAULT_REFERRAL_SETTINGS, type ReferralSettings } from "@/lib/referrals/settings";

// ---------------------------------------------------------------------------
// The referral flow on the service role (owner decisions 2026-11-02 and
// 2026-11-05): a signup through a link records ONE row (at onboarding, the
// email confirmed) and keeps the email's keyed fingerprint (nobody is
// told); the FIRST saved card moves it once and runs the reward step AT
// ONCE — the program on, both emails confirmed, the key present (fail
// closed), the fraud rules, one email = one reward ever, the caps
// (claim_referral_reward; the settings' numbers), then each side's reward
// through the free-days writer (30 free days of Plus for the friend, the
// referrer's own tier for them) under the reference `referral:<id>:<side>`
// — or credits, per the settings — and one notification. A failed grant is
// left owed for the sweep.
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

type World = {
  codeOwner: string | null;
  refereeCreatedAt: string;
  refereeStatus: string | null;
  refereeCards: number;
  insertError: { message: string; code?: string } | null;
  moved: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  users: Record<string, { email: string | null; confirmed: boolean }>;
  claim: string | null;
  inUse: boolean;
  seen: { referral_id: string | null } | null;
  pending: Array<Record<string, unknown>>;
  owed: Array<Record<string, unknown>>;
  stranded: Array<Record<string, unknown>>;
  /** What grantFreeDays answers: ok, a refusal (error), or an in-flight / duplicate code. */
  grant: { kind: "ok" } | { kind: "error"; error: string; code?: "in_flight" | "duplicate_reference" };
  existingGrant: Record<string, unknown> | null;
  settings: ReferralSettings;
};
let world: World;

const ENDS = new Date(NOW.getTime() + 30 * DAY).toISOString();
/** The reward the fake writer gives: 30 days of `tier` as an overlay from NOW. */
const freeDaysDetail = (tier: "plus" | "pro" = "plus") => ({
  kind: "free_days",
  tier,
  days: 30,
  endsAt: ENDS,
  holdEndsAt: null,
  appliedAs: "overlay",
  grantId: `g-${tier}`,
});
const grantCalls = (stub?: unknown) =>
  (void stub, freeDays.grantFreeDays.mock.calls.map((c) => (c as unknown[])[1] as Record<string, unknown>));

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
      return { data: world.profiles.find((p) => p.id === id) ?? null };
    }
    if (table === "cards") return { count: world.refereeCards };
    if (table === "referral_email_fingerprints" && called(calls, "select")) return { data: world.seen };
    if (table === "referrals" && called(calls, "insert")) {
      return world.insertError ? { data: null, error: world.insertError } : { data: { id: REFERRAL } };
    }
    if (table === "referrals" && called(calls, "update") && !called(calls, "select")) return { data: null };
    if (table === "referrals" && called(calls, "update") && called(calls, "select")) {
      // The first-card move (status = signed_up) or a settle (status = first_card).
      const status = calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
      if (status === "signed_up") return { data: world.moved };
      return { data: [{ id: REFERRAL }] };
    }
    if (table === "referrals" && called(calls, "select")) {
      const status = calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
      if (status === "signed_up") return { data: world.stranded };
      return { data: called(calls, "or") ? world.owed : world.pending };
    }
    if (table === "plan_grants") return { data: world.existingGrant };
    return {};
  });
  stub.rpc.mockImplementation((async (name: string) => {
    if (name === "claim_referral_reward") return { data: world.claim, error: null };
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
    refereeCards: 0,
    insertError: null,
    moved: [
      {
        id: REFERRAL,
        referrer_id: REFERRER,
        referee_id: REFEREE,
        status: "first_card",
        first_card_at: NOW.toISOString(),
        referrer_reward: null,
        referee_reward: null,
        grant_attempts: 0,
        signed_up_at: at(-2),
      },
    ],
    profiles: [
      { id: REFERRER, subscription_tier: "free" },
      { id: REFEREE, subscription_tier: "free" },
    ],
    users: {
      [REFERRER]: { email: "ref@gmail.com", confirmed: true },
      [REFEREE]: { email: "friend@outlook.com", confirmed: true },
    },
    claim: "rewarded",
    inUse: false,
    seen: null,
    stranded: [],
    grant: { kind: "ok" },
    existingGrant: null,
    settings: DEFAULT_REFERRAL_SETTINGS,
    pending: [],
    owed: [],
  };
}

const deps = { now: NOW, billingEnabled: true } as const;

beforeEach(() => {
  world = freshWorld();
  vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", TEST_KEY);
  settingsServer.readReferralSettings.mockReset().mockImplementation(async () => world.settings);
  // The fake writer: what the world says, for the tier asked.
  freeDays.grantFreeDays.mockReset().mockImplementation(async (_admin: unknown, input: { tier: "plus" | "pro" }) => {
    if (world.grant.kind === "error") return { ok: false, error: world.grant.error, ...(world.grant.code ? { code: world.grant.code } : {}) };
    const d = freeDaysDetail(input.tier);
    return { ok: true, grantId: d.grantId, plan: { kind: "overlay", why: "no_plan" }, endsAt: d.endsAt, holdEndsAt: null, note: "" };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("recordReferralSignup", () => {
  it("a new account through a valid link: one row, its email's keyed fingerprint kept, and nobody is told", async () => {
    world.users[REFEREE] = { email: "Friend.Name+promo@GoogleMail.com", confirmed: false };
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toMatchObject({ ok: true });
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("refuses a bad or unknown code, your own code, and an account that isn't new", async () => {
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "<script>", now: NOW })).toEqual({ ok: false, reason: "bad_code" });
    world.codeOwner = null;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "unknown_code" });
    world.codeOwner = REFEREE;
    expect(await recordReferralSignup(db().client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "self" });
    for (const change of [
      () => (world.refereeCreatedAt = at(-8)),
      () => (world.refereeStatus = "canceled"),
      () => (world.refereeCards = 1),
    ]) {
      world = freshWorld();
      change();
      const stub = db();
      expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "not_new" });
      expect(stub.forTable("referrals")).toEqual([]);
    }
  });

  it("first claim wins: a second claim for the same account is 'exists'", async () => {
    world.insertError = { message: "duplicate", code: "23505" };
    const stub = db();
    expect(await recordReferralSignup(stub.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "exists" });
    expect(stub.forTable("referral_email_fingerprints")).toEqual([]);
  });
});

describe("qualifyReferral (the first saved card) — rewarded at once", () => {
  it("both free and confirmed: each side gets 30 free days of Plus through the free-days writer under its own reference; one notification each", async () => {
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, deps);
    expect(result).toEqual({ status: "rewarded", referrer: freeDaysDetail(), referee: freeDaysDetail() });
    expect(stub.rpc).toHaveBeenCalledWith("claim_referral_reward", {
      p_referral_id: REFERRAL,
      p_monthly_cap: DEFAULT_REFERRAL_SETTINGS.caps.perMonth,
      p_lifetime_cap: DEFAULT_REFERRAL_SETTINGS.caps.lifetime,
      p_friends_cap: DEFAULT_REFERRAL_SETTINGS.caps.friendsPerMonth,
    });
    expect(grantCalls()).toEqual([
      { userId: REFEREE, tier: "plus", units: 1, source: "referral_friend", grantedBy: null, note: null, reference: `referral:${REFERRAL}:referee` },
      { userId: REFERRER, tier: "plus", units: 1, source: "referral_referrer", grantedBy: null, note: null, reference: `referral:${REFERRAL}:referrer` },
    ]);
    // Never the comp's columns from here (the writer owns them), never credits by hand.
    expect(stub.forTable("profiles").filter((e) => called(e.calls, "update"))).toEqual([]);
    expect(rpcNames(stub)).not.toContain("grant_credits");
    expect(notifications(stub).map((n) => [n.recipient_id, n.type, (n.payload as Record<string, unknown>).side, (n.payload as Record<string, unknown>).days])).toEqual([
      [REFEREE, "referral_reward", "referee", 30],
      [REFERRER, "referral_reward", "referrer", 30],
    ]);
    // Each side's outcome is recorded only while still owed.
    const record = stub.forTable("referrals").find((e) => (payloadOf(e.calls, "update") as Record<string, unknown> | undefined)?.referee_reward === "free_days")!;
    expect(record.calls.find((c) => c.method === "is")?.args).toEqual(["referee_reward", null]);
    // The move to first_card is ONE conditional update (status = signed_up).
    const moved = stub.forTable("referrals")[0];
    expect(moved.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["referee_id", REFEREE],
      ["status", "signed_up"],
    ]);
    // The email check ran before the claim, on the normalized address.
    expect(stub.rpc).toHaveBeenCalledWith("referral_email_in_use", { p_user_id: REFEREE, p_normalized: "friend@outlook.com" });
    const names = rpcNames(stub);
    expect(names.indexOf("referral_email_in_use")).toBeLessThan(names.indexOf("claim_referral_reward"));
  });

  it("a second save (or a retry) finds nothing to move and grants nothing", async () => {
    world.moved = [];
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "none" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("past the 30-day window: expired, nobody rewarded", async () => {
    world.moved[0].signed_up_at = at(-31);
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "expired" });
    expect(referralUpdates(stub).at(-1)).toEqual({ status: "expired", referrer_reward: "none", referee_reward: "none" });
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("an UNCONFIRMED email (either side) waits — no claim, no month, no notification — and expires 30 days after the card", async () => {
    for (const who of [REFEREE, REFERRER]) {
      world = freshWorld();
      world.users[who].confirmed = false;
      const stub = db();
      expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "email_unconfirmed" });
      expect(stub.rpc).not.toHaveBeenCalled();
      expect(notifications(stub)).toEqual([]);
    }
    world = freshWorld();
    world.users[REFEREE].confirmed = false;
    const late = { ...world.moved[0], first_card_at: at(-31) };
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

  it("no hash key: FAIL CLOSED — no email check, no claim, no month", async () => {
    vi.stubEnv("REFERRAL_EMAIL_HASH_KEY", "too-short");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "hash_key_missing" });
    expect(stub.rpc).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("one email, one month (a): another LIVE account has the friend's normalized address — nobody rewarded, the friend not told", async () => {
    world.users[REFEREE].email = "Jo.Smith+2@googlemail.com";
    world.inUse = true;
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "blocked", reason: "email_reused", referee: null });
    expect(stub.rpc).toHaveBeenCalledWith("referral_email_in_use", { p_user_id: REFEREE, p_normalized: "josmith@gmail.com" });
    expect(rpcNames(stub)).not.toContain("claim_referral_reward");
    expect(grantCalls()).toEqual([]);
    expect(referralUpdates(stub).at(-1)).toEqual({
      status: "blocked",
      block_reason: "email_reused",
      referrer_reward: "none",
      referee_reward: "none",
    });
    // The referrer reads "not eligible" (no reason); the friend gets nothing.
    expect(notifications(stub)).toEqual([
      { recipient_id: REFERRER, actor_id: REFEREE, type: "referral_signup", payload: { referralId: REFERRAL, outcome: "not_eligible" } },
    ]);
  });

  it("one email, one month (b): an EARLIER referral signup left the fingerprint (its account deleted since) — not eligible", async () => {
    world.seen = { referral_id: OTHER_REFERRAL };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "blocked", reason: "email_reused" });
    const read = stub.forTable("referral_email_fingerprints").find((e) => called(e.calls, "select"))!;
    expect(read.calls.find((c) => c.method === "eq")?.args).toEqual(["fingerprint", hmac("friend@outlook.com")]);
    // An earlier referral whose row is gone (referral_id null) counts too.
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
    expect(rpcNames(stub)).not.toContain("claim_referral_reward");
    warn.mockRestore();
  });

  it("a friend whose account was deleted before the reward step: blocked, nobody rewarded", async () => {
    const stub = db();
    const row = { ...world.moved[0], referee_id: null };
    expect(await rewardReferral(stub.client as never, row as never, deps)).toEqual({ status: "blocked", reason: "account_deleted", referee: null });
    expect(referralUpdates(stub)).toEqual([
      { status: "blocked", block_reason: "account_deleted", referrer_reward: "none", referee_reward: "none" },
    ]);
    expect(stub.rpc).not.toHaveBeenCalled();
  });

  it("at the referrer's monthly cap: the friend still gets theirs; the referrer is told why there's no reward", async () => {
    world.claim = "capped_month";
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, deps);
    expect(result).toMatchObject({ status: "capped", referrer: null, referee: { kind: "free_days" } });
    expect(grantCalls().map((c) => c.source)).toEqual(["referral_friend"]);
    expect(notifications(stub).map((n) => [n.recipient_id, n.type, (n.payload as Record<string, unknown>).outcome ?? (n.payload as Record<string, unknown>).side])).toEqual([
      [REFERRER, "referral_signup", "capped_month"],
      [REFEREE, "referral_reward", "referee"],
    ]);
  });

  it("the same inbox: blocked, nobody rewarded, no cap consumed", async () => {
    world.users[REFEREE].email = "r.e.f+alt@gmail.com";
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "blocked", reason: "same_email", referee: null });
    expect(rpcNames(stub)).not.toContain("claim_referral_reward");
    expect(referralUpdates(stub).at(-1)).toEqual({ status: "blocked", block_reason: "same_email", referrer_reward: "none", referee_reward: "none" });
  });

  it("the same card fingerprint on both Stripe customers: blocked", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "free", stripe_customer_id: "cus_a" },
      { id: REFEREE, subscription_tier: "free", stripe_customer_id: "cus_b" },
    ];
    const stripe = { customers: { listPaymentMethods: vi.fn(async () => ({ data: [{ card: { fingerprint: "fp_same" } }] })) } };
    expect(await qualifyReferral(db().client as never, REFEREE, { ...deps, stripe: stripe as never })).toMatchObject({ status: "blocked", reason: "same_card" });
  });

  it("the same custom domain: the friend's reward only — through the claim, so it counts toward the friends cap", async () => {
    world.users = { [REFERRER]: { email: "a@smallshop.com", confirmed: true }, [REFEREE]: { email: "b@smallshop.com", confirmed: true } };
    world.claim = "blocked";
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "blocked", reason: "same_domain", referee: { kind: "free_days" } });
    expect(stub.rpc).toHaveBeenCalledWith("claim_referral_reward", expect.objectContaining({ p_block_reason: "same_domain" }));
    expect(grantCalls().map((c) => c.source)).toEqual(["referral_friend"]);
    // Twenty catch-all inboxes: the friends cap answers capped_friends and nobody is rewarded.
    freeDays.grantFreeDays.mockClear();
    world = freshWorld();
    world.users = { [REFERRER]: { email: "a@smallshop.com", confirmed: true }, [REFEREE]: { email: "b@smallshop.com", confirmed: true } };
    world.claim = "capped_friends";
    const capped = db();
    expect(await qualifyReferral(capped.client as never, REFEREE, deps)).toEqual({ status: "capped", referrer: null, referee: null });
    expect(grantCalls()).toEqual([]);
  });

  it("the friends cap (the settings' friendsPerMonth): NEITHER side is rewarded — N confirmable inboxes mint nothing", async () => {
    world.claim = "capped_friends";
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "capped", referrer: null, referee: null });
    expect(grantCalls()).toEqual([]);
    expect(notifications(stub)).toEqual([
      { recipient_id: REFERRER, actor_id: REFEREE, type: "referral_signup", payload: { referralId: REFERRAL, outcome: "capped_friends" } },
    ]);
  });

  it("the program OFF (the admin switch) is a PAUSE: the row waits — nothing granted, nobody told, nothing settled", async () => {
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "waiting", reason: "program_off" });
    // Only the move to first_card was written; no settle.
    expect(referralUpdates(stub)).toEqual([{ status: "first_card", first_card_at: NOW.toISOString() }]);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward");
    expect(grantCalls()).toEqual([]);
    expect(notifications(stub)).toEqual([]);
    // …and a signup through a link records nothing either.
    world = freshWorld();
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, enabled: false };
    const signup = db();
    expect(await recordReferralSignup(signup.client as never, { refereeId: REFEREE, code: "d0000003", now: NOW })).toEqual({ ok: false, reason: "program_off" });
    expect(signup.forTable("referrals")).toEqual([]);
  });

  it("a 'credits' reward (the settings changed): one grant_credits call under the referral's key, the writer untouched", async () => {
    world.settings = { ...DEFAULT_REFERRAL_SETTINGS, friend: { kind: "credits", amount: 20 }, referrer: { kind: "none" } };
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({
      status: "rewarded",
      referrer: { kind: "none", reason: "settings" },
      referee: { kind: "credits", credits: 20 },
    });
    expect(stub.rpc).toHaveBeenCalledWith("grant_credits", {
      p_user_id: REFEREE,
      p_amount: 20,
      p_reason: "referral_credits",
      p_idempotency_key: `referral:${REFERRAL}:referee`,
    });
    expect(grantCalls()).toEqual([]);
    expect(notifications(stub).map((n) => [n.recipient_id, (n.payload as Record<string, unknown>).credits])).toEqual([[REFEREE, 20]]);
  });

  it("a paying referrer gets their OWN tier's free days (the writer adds them to the paid time); the free friend gets Plus", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "pro", subscription_status: "active", stripe_customer_id: "cus_a" },
      { id: REFEREE, subscription_tier: "free" },
    ];
    const stripe = { customers: { listPaymentMethods: vi.fn(async () => ({ data: [] })) } };
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, { ...deps, stripe: stripe as never });
    expect(result).toMatchObject({ status: "rewarded", referrer: { kind: "free_days", tier: "pro" }, referee: { kind: "free_days", tier: "plus" } });
    expect(grantCalls().map((c) => [c.source, c.tier])).toEqual([
      ["referral_friend", "plus"],
      ["referral_referrer", "pro"],
    ]);
    // The writer is handed the Stripe client it needs for a hold.
    expect((freeDays.grantFreeDays.mock.calls[1] as unknown[])[2]).toMatchObject({ stripe });
  });

  it("a cancelled plan still running, or a lapsed one: Plus (the writer starts the days when the plan ends)", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "pro", subscription_status: "canceled" },
      { id: REFEREE, subscription_tier: "free" },
    ];
    await qualifyReferral(db().client as never, REFEREE, deps);
    expect(grantCalls().map((c) => [c.source, c.tier])).toEqual([
      ["referral_friend", "plus"],
      ["referral_referrer", "plus"],
    ]);
  });

  it("a grant the writer already made (duplicate_reference — a retry after a lost record write) is read back, never granted twice; a pending or failed one is retried", async () => {
    world.grant = { kind: "error", error: "This grant was already given.", code: "duplicate_reference" };
    world.existingGrant = { id: "g-old", tier: "plus", units: 1, ends_at: ENDS, applied_as: "subscription_hold", status: "applied" };
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, deps);
    // A hold's end is the moved charge: the notification says so.
    expect(result).toMatchObject({ status: "rewarded", referee: { kind: "free_days", grantId: "g-old", endsAt: ENDS, holdEndsAt: ENDS, appliedAs: "subscription_hold" } });
    expect(stub.forTable("plan_grants")[0].calls.find((c) => c.method === "eq")?.args).toEqual(["reference", `referral:${REFERRAL}:referee`]);
    for (const status of ["pending", "failed"]) {
      world = freshWorld();
      world.grant = { kind: "error", error: "This grant was already given.", code: "duplicate_reference" };
      world.existingGrant = { id: "g-old", tier: "plus", units: 1, ends_at: ENDS, applied_as: "overlay", status };
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const s2 = db();
      expect(await qualifyReferral(s2.client as never, REFEREE, deps)).toEqual({ status: "rewarded", referrer: null, referee: null });
      expect(referralUpdates(s2)).toContainEqual({ grant_attempts: 1 });
      error.mockRestore();
    }
  });

  it("a plan under a scheduled change (a pending downgrade) is DEFERRED: owed, no attempt counted, the sweep tries again", async () => {
    world.profiles = [
      { id: REFERRER, subscription_tier: "pro", subscription_status: "active" },
      { id: REFEREE, subscription_tier: "free" },
    ];
    freeDays.grantFreeDays.mockImplementation(async (_admin: unknown, input: { tier: string; source: string }) =>
      input.source === "referral_referrer"
        ? { ok: false, error: "Their plan has a scheduled change (a pending downgrade). Release it first — \"Keep plan\" on their billing page — then give the free days." }
        : { ok: true, grantId: "g-f", plan: { kind: "overlay", why: "no_plan" }, endsAt: ENDS, holdEndsAt: null, note: "" },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ status: "rewarded", referrer: null, referee: { kind: "free_days" } });
    expect(referralUpdates(stub)).not.toContainEqual({ grant_attempts: 1 });
    // The referrer's side stays owed (never recorded as none).
    expect(referralUpdates(stub).some((u) => "referrer_reward" in u && !("status" in u))).toBe(false);
    warn.mockRestore();
  });

  it("a refusal the writer makes for good (an admin) is recorded as none; one that can clear (in flight, renewing) is retried", async () => {
    world.grant = { kind: "error", error: "An admin account already has every perk and unlimited credits." };
    let stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toMatchObject({ referee: { kind: "none", reason: "admin" } });
    world = freshWorld();
    world.grant = { kind: "error", error: "Another grant for this user is being applied right now. Try again in a moment.", code: "in_flight" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stub = db();
    expect(await qualifyReferral(stub.client as never, REFEREE, deps)).toEqual({ status: "rewarded", referrer: null, referee: null });
    expect(referralUpdates(stub)).toContainEqual({ grant_attempts: 1 });
    error.mockRestore();
  });

  it("a failed grant is never a throw: the side stays OWED and an attempt is counted (the sweep retries)", async () => {
    freeDays.grantFreeDays.mockImplementation(async () => {
      throw new Error("deadlock");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    const result = await qualifyReferral(stub.client as never, REFEREE, deps);
    expect(result).toEqual({ status: "rewarded", referrer: null, referee: null });
    expect(referralUpdates(stub)).toContainEqual({ grant_attempts: 1 });
    // Nothing recorded for either side: both stay owed.
    expect(referralUpdates(stub).filter((u) => !("status" in u) && ("referee_reward" in u || "referrer_reward" in u))).toEqual([]);
    expect(notifications(stub)).toEqual([]);
    error.mockRestore();
  });
});

describe("sweepReferralRewards (the cron's retry)", () => {
  it("does nothing while billing is off", async () => {
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, { now: NOW, billingEnabled: false })).toEqual({ ok: true, skipped: "billing_off" });
    expect(stub.log).toEqual([]);
  });

  it("claims first_card rows that can now be rewarded and leaves the unconfirmed waiting", async () => {
    world.pending = [{ ...world.moved[0] }];
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0 });
    expect(rpcNames(stub)).toContain("claim_referral_reward");

    world = freshWorld();
    world.pending = [{ ...world.moved[0] }];
    world.users[REFEREE].confirmed = false;
    expect(await sweepReferralRewards(db().client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 1, retried: 0, failed: 0 });
  });

  it("grants the sides still owed on claimed rows — and only those", async () => {
    world.owed = [
      { id: REFERRAL, referrer_id: REFERRER, referee_id: REFEREE, status: "rewarded", referrer_reward: "free_days", referee_reward: null, grant_attempts: 1 },
    ];
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 0, retried: 1, failed: 0 });
    expect(grantCalls().map((c) => c.source)).toEqual(["referral_friend"]);
    expect(rpcNames(stub)).not.toContain("claim_referral_reward");
  });

  it("a STRANDED signup (the first card's after() was lost): a signed_up row older than ten minutes whose friend has a card is qualified; signups past the activation window expire", async () => {
    world.stranded = [{ id: REFERRAL, referee_id: REFEREE }];
    world.refereeCards = 1;
    const stub = db();
    expect(await sweepReferralRewards(stub.client as never, deps)).toEqual({ ok: true, claimed: 1, waiting: 0, retried: 0, failed: 0 });
    expect(rpcNames(stub)).toContain("claim_referral_reward");
    // The expiry: signed_up rows older than the activation window, both sides none.
    const expiry = stub.forTable("referrals").find((e) => called(e.calls, "update") && called(e.calls, "eq", "status") && called(e.calls, "lt"))!;
    expect(payloadOf(expiry.calls, "update")).toEqual({ status: "expired", referrer_reward: "none", referee_reward: "none" });
    expect(expiry.calls.find((c) => c.method === "lt")?.args).toEqual(["signed_up_at", new Date(NOW.getTime() - 30 * DAY).toISOString()]);
    // The read: signed_up rows before now − 10 min and inside the window.
    const read = stub.forTable("referrals").find((e) => called(e.calls, "select") && called(e.calls, "eq", "status") && called(e.calls, "lt"))!;
    expect(read.calls.find((c) => c.method === "lt")?.args).toEqual(["signed_up_at", new Date(NOW.getTime() - 10 * 60_000).toISOString()]);
    expect(read.calls.find((c) => c.method === "gte")?.args).toEqual(["signed_up_at", new Date(NOW.getTime() - 30 * DAY).toISOString()]);
    // No card yet: left alone.
    world = freshWorld();
    world.stranded = [{ id: REFERRAL, referee_id: REFEREE }];
    expect(await sweepReferralRewards(db().client as never, deps)).toEqual({ ok: true, claimed: 0, waiting: 0, retried: 0, failed: 0 });
  });

  it(`gives up after ${REFERRAL_GRANT_MAX_ATTEMPTS} attempts: the side is recorded as none (grant_failed) for an admin`, async () => {
    freeDays.grantFreeDays.mockImplementation(async () => {
      throw new Error("still failing");
    });
    world.owed = [
      { id: REFERRAL, referrer_id: REFERRER, referee_id: REFEREE, status: "capped", referrer_reward: "none", referee_reward: null, grant_attempts: REFERRAL_GRANT_MAX_ATTEMPTS - 1 },
    ];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = db();
    await sweepReferralRewards(stub.client as never, deps);
    expect(referralUpdates(stub)).toContainEqual({ grant_attempts: REFERRAL_GRANT_MAX_ATTEMPTS });
    expect(referralUpdates(stub)).toContainEqual({ referee_reward: "none", referee_reward_detail: { kind: "none", reason: "grant_failed" } });
    error.mockRestore();
  });

  it("a deleted friend's owed side is closed as none", async () => {
    world.owed = [
      { id: REFERRAL, referrer_id: REFERRER, referee_id: null, status: "rewarded", referrer_reward: "free_days", referee_reward: null, grant_attempts: 0 },
    ];
    const stub = db();
    await sweepReferralRewards(stub.client as never, deps);
    expect(referralUpdates(stub)).toContainEqual({ referee_reward: "none", referee_reward_detail: { kind: "none", reason: "account_deleted" } });
    expect(grantCalls()).toEqual([]);
  });
});
