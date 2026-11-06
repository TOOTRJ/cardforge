import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// lib/billing/free-days-apply.ts — the writer: the row first (pending), the
// Stripe hold under an idempotency key, the overlay, then `applied`; a
// Stripe failure leaves a `failed` row and nothing else. Revoke the same in
// reverse. The decision itself is lib/billing/free-days.ts (its own test).
// ---------------------------------------------------------------------------

const sync = vi.hoisted(() => ({
  resolveSubscriptionTier: vi.fn(async () => "pro"),
  syncSubscriptionForUser: vi.fn(async () => ({})),
}));
vi.mock("@/lib/stripe/subscription-sync", () => sync);
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn(), isStripeConfigured: () => true }));

import { grantFreeDays, revokeFreeDays } from "@/lib/billing/free-days-apply";
import { HOLD_FROM_KEY, TRIAL_END_BEFORE_COMP_KEY } from "@/lib/billing/comp-stripe";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GRANT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const DAY = 86_400;
const NOW = new Date("2026-11-10T15:14:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const DEC_5 = nowSec + 25 * DAY;
const JAN_4 = DEC_5 + 30 * DAY;
const iso = (sec: number) => new Date(sec * 1000).toISOString();

type Profile = Record<string, unknown>;

function db(opts: {
  profile?: Profile | null;
  insertError?: string;
  insertCode?: string;
  overlayError?: string;
  grants?: Array<Record<string, unknown>>;
} = {}) {
  const profile: Profile | null =
    opts.profile === undefined
      ? { id: USER, is_admin: false, subscription_status: null, subscription_tier: "free", stripe_customer_id: null, stripe_subscription_id: null, comp_tier: null, comp_expires_at: null }
      : opts.profile;
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "profiles" && called(calls, "select")) return { data: profile };
    if (table === "profiles" && called(calls, "update")) return { error: opts.overlayError ? { message: opts.overlayError } : null };
    if (table === "plan_grants" && called(calls, "insert")) {
      return opts.insertError ? { error: { message: opts.insertError, code: opts.insertCode } } : { data: { id: GRANT } };
    }
    // The stale-pending sweep (an update before the insert): nothing to do.
    if (table === "plan_grants" && called(calls, "update") && called(calls, "lt")) return { data: null };
    if (table === "plan_grants" && called(calls, "select")) {
      const byId = calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
      const rows = opts.grants ?? [];
      if (byId) return { data: rows.find((r) => r.id === byId) ?? null };
      return { data: rows.filter((r) => r.status === "applied") };
    }
    return {};
  });
  return stub;
}

function stripe(sub: Record<string, unknown> | null, opts: { updateError?: string } = {}) {
  const update = vi.fn(async (_id: string, params: Record<string, unknown>) => {
    if (opts.updateError) throw new Error(opts.updateError);
    return { ...sub, status: "trialing", trial_end: params.trial_end === "now" ? nowSec : params.trial_end, metadata: params.metadata };
  });
  return {
    subscriptions: { retrieve: vi.fn(async () => sub), update },
    update,
  };
}

const activeProfile = {
  id: USER,
  is_admin: false,
  subscription_status: "active",
  subscription_tier: "pro",
  stripe_customer_id: "cus_1",
  stripe_subscription_id: "sub_1",
  comp_tier: null,
  comp_expires_at: null,
};
const activeSub = { id: "sub_1", status: "active", customer: "cus_1", items: { data: [{ current_period_end: DEC_5 }] }, metadata: {} };

beforeEach(() => {
  sync.resolveSubscriptionTier.mockReset().mockResolvedValue("pro");
  sync.syncSubscriptionForUser.mockReset().mockResolvedValue({});
});

describe("grantFreeDays — a live plan (the hold)", () => {
  const input = { userId: USER, tier: "pro" as const, units: 1, source: "comp" as const, grantedBy: ADMIN, note: "thanks" };

  it("row first (pending, applied_as subscription_hold), then Stripe trial_end = period end + 30 d with proration none and the idempotency key, then the overlay, then applied", async () => {
    const stub = db({ profile: activeProfile });
    const s = stripe(activeSub);
    const result = await grantFreeDays(stub.client as never, input, { stripe: s as never, now: NOW });
    expect(result).toMatchObject({ ok: true, grantId: GRANT, endsAt: iso(JAN_4), holdEndsAt: iso(JAN_4), plan: { kind: "hold", was: "active" } });

    const insert = stub.forTable("plan_grants").find((e) => called(e.calls, "insert"))!;
    expect(payloadOf(insert.calls, "insert")).toEqual({
      user_id: USER,
      tier: "pro",
      units: 1,
      source: "comp",
      granted_by: ADMIN,
      note: "thanks",
      applied_as: "subscription_hold",
      stripe_subscription_id: "sub_1",
      held_from: "active",
      reference: null,
      starts_at: iso(DEC_5),
      ends_at: iso(JAN_4),
      credits_from: iso(DEC_5),
      status: "pending",
    });
    expect(s.update).toHaveBeenCalledWith(
      "sub_1",
      {
        trial_end: JAN_4,
        proration_behavior: "none",
        trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
        metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(DEC_5), [HOLD_FROM_KEY]: "active" },
      },
      { idempotencyKey: `plan-grant:${GRANT}` },
    );
    // A pending row older than STALE_PENDING_MS is marked failed before the insert.
    const stale = stub.forTable("plan_grants").find((e) => called(e.calls, "update") && called(e.calls, "lt"))!;
    expect(payloadOf(stale.calls, "update")).toEqual({ status: "failed", stripe_error: "stale: never finished" });
    expect(stub.log.indexOf(stale)).toBeLessThan(stub.log.indexOf(insert));
    // The order: insert → Stripe → overlay → applied.
    const order = stub.log.map((e) => `${e.table}:${e.calls[0]?.method}`);
    expect(order.indexOf("plan_grants:insert")).toBeLessThan(order.indexOf("profiles:update"));
    const overlay = stub.forTable("profiles").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(overlay.calls, "update")).toEqual({ comp_tier: "pro", comp_expires_at: iso(JAN_4) });
    const applied = stub.forTable("plan_grants").filter((e) => called(e.calls, "update") && !called(e.calls, "lt"));
    expect(payloadOf(applied.at(-1)!.calls, "update")).toEqual({ status: "applied" });
    // The profile's dates follow at once.
    expect(sync.syncSubscriptionForUser).toHaveBeenCalledWith(stub.client, s, USER, expect.objectContaining({ customerId: "cus_1" }));
  });

  it("the tier paid for comes from Stripe (resolveSubscriptionTier), not the profile's copy", async () => {
    const stub = db({ profile: { ...activeProfile, subscription_tier: "plus" } });
    sync.resolveSubscriptionTier.mockResolvedValue("pro");
    const result = await grantFreeDays(stub.client as never, { ...input, tier: "plus" }, { stripe: stripe(activeSub) as never, now: NOW });
    expect(result).toMatchObject({ ok: true, plan: { kind: "below_plan" } });
    // Recorded, nothing written to Stripe or the overlay.
    expect(stub.forTable("profiles").some((e) => called(e.calls, "update"))).toBe(false);
    const insert = stub.forTable("plan_grants").find((e) => called(e.calls, "insert"))!;
    expect(payloadOf(insert.calls, "insert")).toMatchObject({ applied_as: "below_plan", stripe_subscription_id: null });
  });

  it("Stripe refuses the update: the row is marked failed with the error, no overlay, the admin told nothing was granted", async () => {
    const stub = db({ profile: activeProfile });
    const s = stripe(activeSub, { updateError: "No such subscription: sub_1" });
    const result = await grantFreeDays(stub.client as never, input, { stripe: s as never, now: NOW });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/nothing was granted/) });
    // The reference is freed: nothing was granted, a retry may grant under the same key.
    const failed = stub.forTable("plan_grants").find((e) => called(e.calls, "update") && !called(e.calls, "lt"))!;
    expect(payloadOf(failed.calls, "update")).toEqual({ status: "failed", stripe_error: "No such subscription: sub_1", reference: null });
    expect(stub.forTable("profiles").some((e) => called(e.calls, "update"))).toBe(false);
    expect(sync.syncSubscriptionForUser).not.toHaveBeenCalled();
  });

  it("Stripe can't be READ: refused before any row (the shape can't be decided)", async () => {
    const stub = db({ profile: activeProfile });
    const s = { subscriptions: { retrieve: vi.fn(async () => { throw new Error("boom"); }), update: vi.fn() } };
    expect(await grantFreeDays(stub.client as never, input, { stripe: s as never, now: NOW })).toEqual({
      ok: false,
      error: expect.stringMatching(/Couldn't read their Stripe subscription/),
    });
    expect(stub.forTable("plan_grants")).toHaveLength(0);
  });

  it("a failed resync after a successful Stripe write is a WARNING, never a failed grant", async () => {
    const stub = db({ profile: activeProfile });
    sync.syncSubscriptionForUser.mockRejectedValue(new Error("db down"));
    const result = await grantFreeDays(stub.client as never, input, { stripe: stripe(activeSub) as never, now: NOW });
    expect(result).toMatchObject({ ok: true, warning: expect.stringMatching(/Resync/) });
  });

  it("the decision's refusal (an admin) is the writer's error; no row", async () => {
    const stub = db({ profile: { ...activeProfile, is_admin: true } });
    expect(await grantFreeDays(stub.client as never, input, { stripe: stripe(activeSub) as never, now: NOW })).toMatchObject({ ok: false, error: expect.stringMatching(/admin/) });
    expect(stub.forTable("plan_grants")).toHaveLength(0);
  });
});

describe("grantFreeDays — no live plan (the overlay)", () => {
  it("writes the overlay and the row (applied_as overlay); Stripe is not touched", async () => {
    const stub = db();
    const s = stripe(null);
    const result = await grantFreeDays(stub.client as never, { userId: USER, tier: "plus", units: 2, source: "referral_friend", grantedBy: null, note: null }, { stripe: s as never, now: NOW });
    expect(result).toMatchObject({ ok: true, endsAt: iso(nowSec + 60 * DAY), holdEndsAt: null, plan: { kind: "overlay", why: "no_plan" } });
    expect(s.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(s.update).not.toHaveBeenCalled();
    const overlay = stub.forTable("profiles").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(overlay.calls, "update")).toEqual({ comp_tier: "plus", comp_expires_at: iso(nowSec + 60 * DAY) });
    const insert = stub.forTable("plan_grants").find((e) => called(e.calls, "insert"))!;
    expect(payloadOf(insert.calls, "insert")).toMatchObject({ source: "referral_friend", granted_by: null, applied_as: "overlay", units: 2, starts_at: iso(nowSec), credits_from: iso(nowSec) });
  });

  it("the overlay write fails: the row is marked failed and nothing is granted", async () => {
    const stub = db({ overlayError: "permission denied" });
    const result = await grantFreeDays(stub.client as never, { userId: USER, tier: "plus", units: 1, source: "comp", grantedBy: ADMIN, note: null }, { stripe: stripe(null) as never, now: NOW });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Nothing was granted/) });
    const failed = stub.forTable("plan_grants").find((e) => called(e.calls, "update") && !called(e.calls, "lt"))!;
    expect(payloadOf(failed.calls, "update")).toEqual({ status: "failed", stripe_error: "overlay: permission denied", reference: null });
  });

  it("a second grant for the same user while one is in flight (0176's one-pending index, 23505): refused, try again", async () => {
    const stub = db({ insertError: "duplicate key value violates unique constraint \"plan_grants_one_pending_idx\"", insertCode: "23505" });
    expect(await grantFreeDays(stub.client as never, { userId: USER, tier: "plus", units: 1, source: "comp", grantedBy: ADMIN, note: null }, { stripe: stripe(null) as never })).toEqual({
      ok: false,
      error: expect.stringMatching(/being applied right now/),
      code: "in_flight",
    });
    // The reference index (a referral retried after a lost record write): duplicate_reference.
    const dup = db({ insertError: 'duplicate key value violates unique constraint "plan_grants_reference_idx"', insertCode: "23505" });
    expect(await grantFreeDays(dup.client as never, { userId: USER, tier: "plus", units: 1, source: "referral_friend", grantedBy: null, note: null, reference: "referral:r1:referee" }, { stripe: stripe(null) as never })).toMatchObject({
      ok: false,
      code: "duplicate_reference",
    });
    const insert = dup.forTable("plan_grants").find((e) => called(e.calls, "insert"))!;
    expect(payloadOf(insert.calls, "insert")).toMatchObject({ reference: "referral:r1:referee", source: "referral_friend" });
    expect(stub.forTable("profiles").some((e) => called(e.calls, "update"))).toBe(false);
  });

  it("no such user / the insert fails: an error, nothing else", async () => {
    expect(await grantFreeDays(db({ profile: null }).client as never, { userId: USER, tier: "plus", units: 1, source: "comp", grantedBy: ADMIN, note: null }, { stripe: stripe(null) as never })).toEqual({ ok: false, error: "No user with that id." });
    const stub = db({ insertError: "nope" });
    expect(await grantFreeDays(stub.client as never, { userId: USER, tier: "plus", units: 1, source: "comp", grantedBy: ADMIN, note: null }, { stripe: stripe(null) as never })).toEqual({ ok: false, error: expect.stringMatching(/record the grant/) });
    expect(stub.forTable("profiles").some((e) => called(e.calls, "update"))).toBe(false);
  });
});

describe("revokeFreeDays", () => {
  const heldProfile = { ...activeProfile, subscription_status: "trialing", comp_tier: "pro", comp_expires_at: iso(JAN_4) };
  const heldSub = { ...activeSub, status: "trialing", trial_end: JAN_4, metadata: { [TRIAL_END_BEFORE_COMP_KEY]: String(DEC_5) } };
  const grant = { id: GRANT, user_id: USER, tier: "pro", units: 1, ends_at: iso(JAN_4), status: "applied" };

  it("moves the held trial back (its own idempotency key), clears the overlay and marks the row revoked", async () => {
    const stub = db({ profile: heldProfile, grants: [grant] });
    const s = stripe(heldSub);
    const result = await revokeFreeDays(stub.client as never, { grantId: GRANT, revokedBy: ADMIN }, { stripe: s as never, now: NOW });
    expect(result).toMatchObject({ ok: true, overlay: { comp_tier: null, comp_expires_at: null }, chargesNow: false });
    // The hold_from key is NOT touched: the plan reads trialing until Dec 5
    // and every trial reader must still know it is a paying plan.
    expect(s.update).toHaveBeenCalledWith(
      "sub_1",
      { trial_end: DEC_5, proration_behavior: "none", metadata: { [TRIAL_END_BEFORE_COMP_KEY]: "" } },
      { idempotencyKey: `plan-grant-revoke:${GRANT}` },
    );
    const overlay = stub.forTable("profiles").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(overlay.calls, "update")).toEqual({ comp_tier: null, comp_expires_at: null });
    const row = stub.forTable("plan_grants").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(row.calls, "update")).toMatchObject({ status: "revoked", revoked_by: ADMIN, revoked_at: expect.any(String) });
  });

  it("only the NEWEST applied grant: an older one is refused and nothing changes", async () => {
    const newer = { ...grant, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
    const stub = db({ profile: heldProfile, grants: [newer, grant] });
    const s = stripe(heldSub);
    expect(await revokeFreeDays(stub.client as never, { grantId: GRANT, revokedBy: ADMIN }, { stripe: s as never, now: NOW })).toEqual({
      ok: false,
      error: expect.stringMatching(/newest/),
    });
    expect(s.update).not.toHaveBeenCalled();
    expect(stub.forTable("profiles").some((e) => called(e.calls, "update"))).toBe(false);
  });

  it("a Stripe failure: nothing revoked, the row stays applied", async () => {
    const stub = db({ profile: heldProfile, grants: [grant] });
    const s = stripe(heldSub, { updateError: "rate limited" });
    expect(await revokeFreeDays(stub.client as never, { grantId: GRANT, revokedBy: ADMIN }, { stripe: s as never, now: NOW })).toEqual({
      ok: false,
      error: expect.stringMatching(/nothing was revoked/),
    });
    expect(stub.forTable("plan_grants").some((e) => called(e.calls, "update"))).toBe(false);
  });

  it("an overlay-only grant touches no subscription; a missing or revoked grant is refused", async () => {
    const overlayGrant = { ...grant, ends_at: iso(nowSec + 30 * DAY) };
    const stub = db({ profile: { ...activeProfile, subscription_status: null, stripe_subscription_id: null, comp_tier: "pro", comp_expires_at: iso(nowSec + 30 * DAY) }, grants: [overlayGrant] });
    const s = stripe(null);
    expect(await revokeFreeDays(stub.client as never, { grantId: GRANT, revokedBy: ADMIN }, { stripe: s as never, now: NOW })).toMatchObject({ ok: true, chargesNow: false });
    expect(s.update).not.toHaveBeenCalled();
    expect(await revokeFreeDays(db({ grants: [] }).client as never, { grantId: GRANT, revokedBy: ADMIN }, { stripe: s as never })).toEqual({ ok: false, error: "No grant with that id." });
    expect(await revokeFreeDays(db({ grants: [{ ...grant, status: "revoked" }] }).client as never, { grantId: GRANT, revokedBy: ADMIN }, { stripe: s as never })).toMatchObject({ ok: false, error: expect.stringMatching(/applied/) });
  });
});
