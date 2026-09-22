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
vi.mock("@/lib/stripe/subscription-sync", () => ({
  findLiveSubscription: vi.fn(),
  grantCreditsForSync: vi.fn(),
  isLiveStatus: vi.fn(),
  resolveSubscriptionTier: vi.fn(),
  syncSubscriptionForUser: vi.fn(),
}));

import {
  adminGrantCreditsAction,
  adminSetCardLimitAction,
  adminSetCompTierAction,
} from "@/lib/admin/user-actions";

function db(opts: { targetExists?: boolean; updateError?: string } = {}) {
  const stub = chainClient((table, calls): ChainAnswer => {
    if (table === "profiles" && called(calls, "select")) {
      const id = calls.find((c) => c.method === "eq")?.args[1];
      return { data: opts.targetExists !== false && id === TARGET ? { id } : null };
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

describe("adminSetCompTierAction", () => {
  it("writes the tier + expiry and tells the user", async () => {
    const stub = db();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    expect(await adminSetCompTierAction({ userId: TARGET, tier: "pro", expiresAt })).toEqual({ ok: true });
    const update = stub.forTable("profiles").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(update.calls, "update")).toEqual({ comp_tier: "pro", comp_expires_at: expiresAt });
    expect(called(update.calls, "eq", "id")).toBe(true);
    expect(notification(stub)).toMatchObject({ type: "comp_plan", payload: { tier: "pro", expiresAt } });
  });
  it("clearing the tier always clears the expiry with it", async () => {
    const stub = db();
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    await adminSetCompTierAction({ userId: TARGET, tier: null, expiresAt });
    const update = stub.forTable("profiles").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(update.calls, "update")).toEqual({ comp_tier: null, comp_expires_at: null });
  });
  it("rejects an expiry in the past", async () => {
    const stub = db();
    const result = await adminSetCompTierAction({ userId: TARGET, tier: "plus", expiresAt: "2020-01-01T00:00:00Z" });
    expect(result).toEqual({ ok: false, error: "Expiry must be in the future." });
    expect(stub.forTable("profiles").some((e) => called(e.calls, "update"))).toBe(false);
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
