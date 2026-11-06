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
const bank = vi.hoisted(() => ({ bankDays: vi.fn(), revokeBankedEntry: vi.fn() }));
vi.mock("@/lib/billing/day-bank", () => ({
  MAX_BANK_DAYS_APPLIED: 730,
  MIN_ADMIN_BANK_DAYS: 2,
  adminBankReference: (id: string) => `admin:${id}`,
  bankDays: (...args: unknown[]) => bank.bankDays(...args),
  revokeBankedEntry: (...args: unknown[]) => bank.revokeBankedEntry(...args),
}));
vi.mock("@/lib/stripe/subscription-sync", () => ({
  findLiveSubscription: vi.fn(),
  grantCreditsForSync: vi.fn(),
  isLiveStatus: vi.fn(),
  resolveSubscriptionTier: vi.fn(),
  syncSubscriptionForUser: vi.fn(),
}));

import {
  adminBankDaysAction,
  adminGrantCreditsAction,
  adminGrantFreeDaysAction,
  adminRevokeBankedDaysAction,
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
  bank.bankDays.mockReset().mockResolvedValue({ ok: true, entryId: "e1", created: true });
  bank.revokeBankedEntry.mockReset().mockResolvedValue({ ok: true, days: 7, userId: TARGET });
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

describe("adminBankDaysAction — the comp since owner 2026-11-06", () => {
  it("banks the days under the form's request id (source admin, the admin named in the note) and tells the user", async () => {
    const stub = db();
    expect(await adminBankDaysAction({ userId: TARGET, days: 14, note: "  thanks for the bug report ", requestId: REQUEST })).toEqual({ ok: true, days: 14, created: true });
    expect(bank.bankDays).toHaveBeenCalledWith(stub.client, {
      userId: TARGET,
      days: 14,
      source: "admin",
      reference: `admin:${REQUEST}`,
      note: `thanks for the bug report (by ${ADMIN})`,
    });
    expect(notification(stub)).toEqual({
      recipient_id: TARGET,
      actor_id: ADMIN,
      type: "banked_days",
      payload: { days: 14, note: "thanks for the bug report" },
    });
  });
  it("a double submit finds the entry it made and tells the user nothing twice", async () => {
    const stub = db();
    bank.bankDays.mockResolvedValue({ ok: true, entryId: "e1", created: false });
    expect(await adminBankDaysAction({ userId: TARGET, days: 7, note: null, requestId: REQUEST })).toEqual({ ok: true, days: 7, created: false });
    expect(stub.forTable("notifications")).toHaveLength(0);
  });
  it("validates the days (2 … 730 whole days — Stripe's 48 h minimum), the note and the request id before touching anything", async () => {
    db();
    for (const days of [0, 1, 731, 2.5]) {
      expect((await adminBankDaysAction({ userId: TARGET, days, note: null, requestId: REQUEST })).ok).toBe(false);
    }
    expect((await adminBankDaysAction({ userId: TARGET, days: 7, note: "x".repeat(501), requestId: REQUEST })).ok).toBe(false);
    expect((await adminBankDaysAction({ userId: TARGET, days: 7, note: null, requestId: "nope" })).ok).toBe(false);
    expect(bank.bankDays).not.toHaveBeenCalled();
  });
  it("refuses a user that doesn't exist, and passes the bank's refusal through", async () => {
    db({ targetExists: false });
    expect(await adminBankDaysAction({ userId: TARGET, days: 7, note: null, requestId: REQUEST })).toEqual({ ok: false, error: "No user with that id." });
    db();
    bank.bankDays.mockResolvedValue({ ok: false, error: "Couldn't bank the days." });
    expect(await adminBankDaysAction({ userId: TARGET, days: 7, note: null, requestId: REQUEST })).toEqual({ ok: false, error: "Couldn't bank the days." });
  });
});

describe("adminRevokeBankedDaysAction", () => {
  it("takes a banked entry back and tells the user, with the reason", async () => {
    const stub = db();
    expect(await adminRevokeBankedDaysAction({ entryId: REQUEST, reason: " given by mistake " })).toEqual({ ok: true, days: 7 });
    expect(bank.revokeBankedEntry).toHaveBeenCalledWith(stub.client, REQUEST, "given by mistake");
    expect(notification(stub)).toEqual({
      recipient_id: TARGET,
      actor_id: ADMIN,
      type: "banked_days",
      payload: { days: 7, revoked: 1, note: "given by mistake" },
    });
  });
  it("an entry no longer banked is refused and the user is not told", async () => {
    const stub = db();
    bank.revokeBankedEntry.mockResolvedValue({ ok: false, error: "Those days aren't banked any more (applied, being applied, or already revoked)." });
    expect(await adminRevokeBankedDaysAction({ entryId: REQUEST, reason: null })).toMatchObject({ ok: false, error: expect.stringMatching(/aren't banked/) });
    expect(stub.forTable("notifications")).toHaveLength(0);
  });
});

describe("adminGrantFreeDaysAction — staff access only since 2026-11-06", () => {
  it("REFUSES a dated comp (30-day units): those are banked days now, never silently converted", async () => {
    const stub = db();
    expect(await adminGrantFreeDaysAction({ userId: TARGET, tier: "pro", units: 1, note: null })).toEqual({
      ok: false,
      error: "Dated comps are banked days now — use Bank free days.",
    });
    expect(freeDays.grantFreeDays).not.toHaveBeenCalled();
    expect(stub.forTable("notifications")).toHaveLength(0);
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
  it("validates the note before touching anything", async () => {
    db();
    expect((await adminGrantFreeDaysAction({ userId: TARGET, tier: "plus", units: null, note: "x".repeat(501) })).ok).toBe(false);
    expect(freeDays.grantFreeDays).not.toHaveBeenCalled();
  });
  it("a warning from the writer rides on the result", async () => {
    db();
    freeDays.grantFreeDays.mockResolvedValue({ ok: true, grantId: "g1", plan: { kind: "overlay", why: "staff" }, endsAt: null, holdEndsAt: null, note: "n", warning: "The profile's dates catch up with the next webhook (or press Resync)." });
    expect(await adminGrantFreeDaysAction({ userId: TARGET, tier: "plus", units: null, note: null })).toMatchObject({ ok: true, warning: expect.stringMatching(/Resync/) });
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
