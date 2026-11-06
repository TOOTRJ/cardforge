import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// Admin user tools — grant credits, comp a plan, raise the card cap. The
// contract: is_admin gate first, zod limits, target must exist, every write
// goes through the service-role client, the target is notified, and the
// grant is idempotent on the FORM's request id (not a timestamp).
// ---------------------------------------------------------------------------

const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const state = vi.hoisted(() => ({
  profile: null as null | { id: string; is_admin: boolean },
  configured: true,
  client: null as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentProfile: async () => state.profile }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
  isAdminConfigured: () => state.configured,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/stripe/client", () => ({ getStripe: vi.fn(), isStripeConfigured: () => false }));
const freeDays = vi.hoisted(() => ({ grantFreeDays: vi.fn(), revokeFreeDays: vi.fn() }));
vi.mock("@/lib/billing/free-days-apply", () => freeDays);
vi.mock("@/lib/stripe/subscription-sync", () => ({
  findLiveSubscription: vi.fn(),
  grantCreditsForSync: vi.fn(),
  isLiveStatus: vi.fn(),
  resolveSubscriptionTier: vi.fn(),
  syncSubscriptionForUser: vi.fn(),
}));

import {
  adminGrantCreditsAction,
  adminGrantFreeDaysAction,
  adminRevokeFreeDaysAction,
  adminSetCardLimitAction,
} from "@/lib/admin/user-actions";

function db(opts: { targetExists?: boolean; updateError?: string; subscriptionStatus?: string | null; grantUser?: string | null } = {}) {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "plan_grants" && called(calls, "select")) {
      return { data: opts.grantUser === undefined ? { user_id: TARGET } : opts.grantUser ? { user_id: opts.grantUser } : null };
    }
    if (table === "profiles" && called(calls, "select")) {
      const id = calls.find((c) => c.method === "eq")?.args[1];
      return {
        data:
          opts.targetExists !== false && id === TARGET
            ? { id, subscription_status: opts.subscriptionStatus ?? null }
            : null,
      };
    }
    if (table === "profiles" && called(calls, "update")) {
      return { error: opts.updateError ? { message: opts.updateError } : null };
    }
    return {};
  });
  state.client = stub.client;
  return stub;
}

const notification = (stub: ReturnType<typeof chainClient>) =>
  stub.forTable("notifications").map((e) => payloadOf(e.calls, "insert"))[0];

beforeEach(() => {
  state.profile = { id: ADMIN, is_admin: true };
  state.configured = true;
  freeDays.grantFreeDays.mockReset().mockResolvedValue({
    ok: true,
    grantId: "g1",
    plan: { kind: "overlay", why: "no_plan" },
    endsAt: "2026-12-05T12:00:00.000Z",
    holdEndsAt: null,
    note: "Pro until Dec 5, 2026, 12:00 PM UTC (no Stripe subscription: a perks overlay).",
  });
  freeDays.revokeFreeDays.mockReset().mockResolvedValue({
    ok: true,
    overlay: { comp_tier: null, comp_expires_at: null },
    chargesNow: false,
    note: "Their complimentary access is cleared.",
  });
});

describe("admin gate", () => {
  it("refuses non-admins before touching anything", async () => {
    state.profile = { id: ADMIN, is_admin: false };
    const stub = db();
    const result = await adminGrantCreditsAction({ userId: TARGET, amount: 5, requestId: REQUEST });
    expect(result).toEqual({ ok: false, error: "Not authorized." });
    expect(stub.log).toEqual([]);
    expect(stub.rpc).not.toHaveBeenCalled();
  });
  it("refuses when the service-role client isn't configured", async () => {
    state.configured = false;
    db();
    expect(await adminSetCardLimitAction({ userId: TARGET, limit: 10 })).toEqual({
      ok: false,
      error: "Admin client isn't configured.",
    });
  });
});

describe("adminGrantCreditsAction", () => {
  it("validates the amount and never calls the RPC on bad input", async () => {
    const stub = db();
    for (const amount of [0, 10_001, 2.5]) {
      const result = await adminGrantCreditsAction({ userId: TARGET, amount, requestId: REQUEST });
      expect(result.ok).toBe(false);
    }
    expect(stub.rpc).not.toHaveBeenCalled();
  });
  it("refuses an unknown target", async () => {
    const stub = db({ targetExists: false });
    expect(await adminGrantCreditsAction({ userId: TARGET, amount: 5, requestId: REQUEST })).toEqual({
      ok: false,
      error: "No user with that id.",
    });
    expect(stub.rpc).not.toHaveBeenCalled();
  });
  it("grants through grant_credits keyed on the form's request id and notifies the user", async () => {
    const stub = db();
    stub.rpc.mockResolvedValue({ data: 42, error: null });
    const result = await adminGrantCreditsAction({
      userId: TARGET,
      amount: 5,
      note: "  welcome back  ",
      requestId: REQUEST,
    });
    expect(result).toEqual({ ok: true, balance: 42 });
    expect(stub.rpc).toHaveBeenCalledWith("grant_credits", {
      p_user_id: TARGET,
      p_amount: 5,
      p_reason: "admin_grant: welcome back",
      p_idempotency_key: `admin-grant:${REQUEST}`,
    });
    expect(notification(stub)).toEqual({
      recipient_id: TARGET,
      actor_id: ADMIN,
      type: "credit_grant",
      payload: { amount: 5, balance: 42, note: "welcome back" },
    });
  });
  it("surfaces an RPC failure and sends no notification", async () => {
    const stub = db();
    stub.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await adminGrantCreditsAction({ userId: TARGET, amount: 5, requestId: REQUEST })).toEqual({
      ok: false,
      error: "Couldn't grant credits.",
    });
    expect(stub.forTable("notifications")).toEqual([]);
  });
});

describe("adminGrantFreeDaysAction", () => {
  it("grants through lib/billing/free-days-apply (source comp, the admin as granter) and tells the user the days and their end", async () => {
    const stub = db();
    expect(await adminGrantFreeDaysAction({ userId: TARGET, tier: "pro", units: 1, note: "  thanks for the bug report " })).toEqual({
      ok: true,
      endsAt: "2026-12-05T12:00:00.000Z",
      stripeNote: "Pro until Dec 5, 2026, 12:00 PM UTC (no Stripe subscription: a perks overlay).",
    });
    expect(freeDays.grantFreeDays).toHaveBeenCalledWith(stub.client, {
      userId: TARGET,
      tier: "pro",
      units: 1,
      source: "comp",
      grantedBy: ADMIN,
      note: "thanks for the bug report",
    });
    expect(notification(stub)).toEqual({
      recipient_id: TARGET,
      actor_id: ADMIN,
      type: "comp_plan",
      payload: { tier: "pro", days: 30, expiresAt: "2026-12-05T12:00:00.000Z" },
    });
  });
  it("a HOLD (the days added to a live plan) names the moved charge to the user — never a trial end for an active plan", async () => {
    const stub = db();
    freeDays.grantFreeDays.mockResolvedValue({
      ok: true,
      grantId: "g1",
      plan: { kind: "hold", was: "active" },
      endsAt: "2027-01-04T12:00:00.000Z",
      holdEndsAt: "2027-01-04T12:00:00.000Z",
      note: "Their Stripe plan's next charge moves …",
    });
    const result = await adminGrantFreeDaysAction({ userId: TARGET, tier: "plus", units: 1, note: null });
    expect(result).toMatchObject({ ok: true, stripeNote: "Their Stripe plan's next charge moves …" });
    expect(notification(stub)).toMatchObject({
      payload: { tier: "plus", days: 30, expiresAt: "2027-01-04T12:00:00.000Z", holdEndsAt: "2027-01-04T12:00:00.000Z", was: "active" },
    });
  });
  it("an open-ended (staff) grant sends no day count", async () => {
    const stub = db();
    freeDays.grantFreeDays.mockResolvedValue({ ok: true, grantId: "g1", plan: { kind: "overlay", why: "staff" }, endsAt: null, holdEndsAt: null, note: "Pro with no end date (staff)." });
    await adminGrantFreeDaysAction({ userId: TARGET, tier: "pro", units: null, note: null });
    expect(freeDays.grantFreeDays).toHaveBeenCalledWith(stub.client, expect.objectContaining({ units: null }));
    expect(notification(stub)).toMatchObject({ payload: { tier: "pro", days: null, expiresAt: null } });
  });
  it("the writer's refusal is the admin's error, and the user is not told", async () => {
    const stub = db();
    freeDays.grantFreeDays.mockResolvedValue({ ok: false, error: "Open-ended (staff) access is for an account with no Stripe subscription. Give dated free days instead." });
    expect(await adminGrantFreeDaysAction({ userId: TARGET, tier: "plus", units: null, note: null })).toEqual({
      ok: false,
      error: expect.stringMatching(/staff/),
    });
    expect(stub.forTable("notifications")).toHaveLength(0);
  });
  it("validates the units (1 … 12 whole units) and the note before touching anything", async () => {
    db();
    for (const units of [0, 13, 1.5]) {
      expect((await adminGrantFreeDaysAction({ userId: TARGET, tier: "plus", units, note: null })).ok).toBe(false);
    }
    expect((await adminGrantFreeDaysAction({ userId: TARGET, tier: "plus", units: 1, note: "x".repeat(501) })).ok).toBe(false);
    expect(freeDays.grantFreeDays).not.toHaveBeenCalled();
  });
  it("a warning from the writer rides on the result", async () => {
    db();
    freeDays.grantFreeDays.mockResolvedValue({ ok: true, grantId: "g1", plan: { kind: "hold", was: "trialing" }, endsAt: "2026-12-12T00:00:00.000Z", holdEndsAt: "2026-12-12T00:00:00.000Z", note: "n", warning: "The profile's dates catch up with the next webhook (or press Resync)." });
    expect(await adminGrantFreeDaysAction({ userId: TARGET, tier: "plus", units: 1, note: null })).toMatchObject({ ok: true, warning: expect.stringMatching(/Resync/) });
  });
});

describe("adminRevokeFreeDaysAction", () => {
  const GRANT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  it("revokes through the writer and tells the user their access ended", async () => {
    const stub = db();
    expect(await adminRevokeFreeDaysAction({ grantId: GRANT })).toEqual({ ok: true, note: "Their complimentary access is cleared." });
    expect(freeDays.revokeFreeDays).toHaveBeenCalledWith(stub.client, { grantId: GRANT, revokedBy: ADMIN });
    expect(notification(stub)).toEqual({ recipient_id: TARGET, actor_id: ADMIN, type: "comp_plan", payload: { tier: null } });
  });
  it("a revoke that leaves other free days says the access was shortened, with its new end", async () => {
    const stub = db();
    freeDays.revokeFreeDays.mockResolvedValue({
      ok: true,
      overlay: { comp_tier: "plus", comp_expires_at: "2026-12-20T00:00:00.000Z" },
      chargesNow: false,
      note: "Their complimentary Plus now ends on Dec 20, 2026, 12:00 AM UTC.",
    });
    await adminRevokeFreeDaysAction({ grantId: GRANT });
    expect(notification(stub)).toMatchObject({ payload: { tier: "plus", expiresAt: "2026-12-20T00:00:00.000Z", revoked: 1 } });
  });
  it("the writer's refusal is the admin's error; nobody is told", async () => {
    const stub = db();
    freeDays.revokeFreeDays.mockResolvedValue({ ok: false, error: "Only the newest grant can be revoked. Revoke the later ones first." });
    expect(await adminRevokeFreeDaysAction({ grantId: GRANT })).toEqual({ ok: false, error: expect.stringMatching(/newest/) });
    expect(stub.forTable("notifications")).toHaveLength(0);
  });
  it("rejects a non-uuid grant id before anything", async () => {
    db();
    expect((await adminRevokeFreeDaysAction({ grantId: "nope" })).ok).toBe(false);
    expect(freeDays.revokeFreeDays).not.toHaveBeenCalled();
  });
});

describe("adminSetCardLimitAction", () => {
  it("caps the override and reports a failed write", async () => {
    db();
    expect((await adminSetCardLimitAction({ userId: TARGET, limit: 100_001 })).ok).toBe(false);
    db({ updateError: "nope" });
    expect(await adminSetCardLimitAction({ userId: TARGET, limit: 50 })).toEqual({
      ok: false,
      error: "Couldn't update the card limit.",
    });
  });
  it("null clears the override and the user is told", async () => {
    const stub = db();
    expect(await adminSetCardLimitAction({ userId: TARGET, limit: null })).toEqual({ ok: true });
    const update = stub.forTable("profiles").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(update.calls, "update")).toEqual({ card_limit_override: null });
    expect(notification(stub)).toMatchObject({ type: "card_limit", payload: { limit: null } });
  });
});
