import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// spendCredits / refundCredits — the contract every credited flow relies on.
// Until now these were mocked everywhere they mattered (credited-step,
// the idea routes), so the money rules below were never pinned:
//   * billing off / admin / non-positive amount → ok, UNCHARGED, no RPC;
//   * a real charge forwards the ledger ref and reports charged;
//   * an empty balance fails closed with `insufficient_credits`;
//   * an infra error fails OPEN unless the caller reserves (failClosed);
//   * a refund never runs uncharged paths, forwards the caller's key, and
//     minted a unique key when none is given (two refunds in one ms used to
//     collide).
// ---------------------------------------------------------------------------

const s = vi.hoisted(() => ({
  billing: true,
  admin: false,
  adminConfigured: true,
  rpcAnswer: { data: [{ ok: true, balance: 4 }], error: null } as {
    data: unknown;
    error: { message: string } | null;
  },
  rpcThrows: false,
  userRpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  adminRpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  adminRpcError: null as { message: string } | null,
}));

vi.mock("@/lib/billing/flags", () => ({ isBillingEnabled: () => s.billing }));
vi.mock("@/lib/supabase/server", () => ({
  getCurrentProfile: async () => ({ is_admin: s.admin }),
  createClient: async () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      s.userRpc.push({ fn, args });
      if (s.rpcThrows) throw new Error("socket closed");
      return s.rpcAnswer;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  isAdminConfigured: () => s.adminConfigured,
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      s.adminRpc.push({ fn, args });
      return { data: null, error: s.adminRpcError };
    },
  }),
}));

import { refundCredits, spendCredits } from "@/lib/ai/rate-limit";

const USER = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  s.billing = true;
  s.admin = false;
  s.adminConfigured = true;
  s.rpcAnswer = { data: [{ ok: true, balance: 4 }], error: null };
  s.rpcThrows = false;
  s.userRpc = [];
  s.adminRpc = [];
  s.adminRpcError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("spendCredits", () => {
  it("charges through consume_credits, forwarding the ledger ref", async () => {
    const result = await spendCredits(1, "generate_deck", { failClosed: true, ref: "spend:job:card:0:u" });
    expect(result).toEqual({ ok: true, balance: 4, charged: true });
    expect(s.userRpc).toEqual([
      { fn: "consume_credits", args: { p_amount: 1, p_reason: "generate_deck", p_ref: "spend:job:card:0:u" } },
    ]);
  });

  it("never touches the ledger when billing is off, for admins, or for a non-positive amount", async () => {
    s.billing = false;
    expect(await spendCredits(1, "generate_deck")).toMatchObject({ ok: true, charged: false });
    s.billing = true;
    s.admin = true;
    expect(await spendCredits(1, "generate_deck")).toMatchObject({ ok: true, charged: false });
    s.admin = false;
    expect(await spendCredits(0, "generate_deck")).toMatchObject({ ok: true, charged: false });
    expect(s.userRpc).toHaveLength(0);
  });

  it("fails closed on an empty balance, whatever the caller asked for", async () => {
    s.rpcAnswer = { data: [{ ok: false, balance: 0 }], error: null };
    const open = await spendCredits(1, "generate_deck");
    expect(open).toMatchObject({ ok: false, reason: "insufficient_credits", balance: 0 });
    const closed = await spendCredits(1, "generate_deck", { failClosed: true });
    expect(closed).toMatchObject({ ok: false, reason: "insufficient_credits" });
  });

  it("fails OPEN (uncharged) on an infra error, but CLOSED when reserving", async () => {
    s.rpcAnswer = { data: null, error: { message: "rpc down" } };
    expect(await spendCredits(1, "generate_deck")).toMatchObject({ ok: true, charged: false });
    expect(await spendCredits(1, "generate_deck", { failClosed: true })).toMatchObject({
      ok: false,
      reason: "error",
    });
    s.rpcThrows = true;
    expect(await spendCredits(1, "generate_deck", { failClosed: true })).toMatchObject({
      ok: false,
      reason: "error",
    });
  });
});

describe("refundCredits", () => {
  it("grants back through grant_credits under the caller's key", async () => {
    await refundCredits(USER, 1, "generate_deck", "refund:spend:job:card:0:u");
    expect(s.adminRpc).toEqual([
      {
        fn: "grant_credits",
        args: { p_user_id: USER, p_amount: 1, p_reason: "refund", p_idempotency_key: "refund:spend:job:card:0:u" },
      },
    ]);
  });

  it("mints a unique key when none is given (two refunds in one millisecond must not collide)", async () => {
    await refundCredits(USER, 1, "generate_deck");
    await refundCredits(USER, 1, "generate_deck");
    const keys = s.adminRpc.map((c) => String(c.args.p_idempotency_key));
    expect(keys[0]).toMatch(new RegExp(`^refund:generate_deck:${USER}:[0-9a-f-]{36}$`));
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("does nothing for a non-positive amount or with billing off, and never throws on a failed grant", async () => {
    await refundCredits(USER, 0, "generate_deck");
    s.billing = false;
    await refundCredits(USER, 1, "generate_deck");
    expect(s.adminRpc).toHaveLength(0);
    s.billing = true;
    s.adminRpcError = { message: "grant exploded" };
    await expect(refundCredits(USER, 1, "generate_deck")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    s.adminConfigured = false;
    await expect(refundCredits(USER, 1, "generate_deck")).resolves.toBeUndefined();
  });
});
