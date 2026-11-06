import { describe, expect, it } from "vitest";
import { chainClient, called, type ChainAnswer } from "@/tests/stubs/supabase-chain";
import { grantCreditsForGrant } from "@/lib/billing/free-days-credits";
import {
  GRANT_SWEEP_LOOKBACK_DAYS,
  GRANT_SWEEP_PAGE_SIZE,
  freeDaysAllotmentsDue,
  grantFreeDaysCredits,
  overlayAllotmentOver,
  planGrantCreditKey,
} from "@/lib/billing/free-days-credits";

// ---------------------------------------------------------------------------
// A grant's credits: one allotment per 30-day unit at the START of each,
// under `grant:<id>:<k>` — never a calendar month's. A 30-day grant starting
// Nov 20 is 30 credits once (never a second on Dec 1); a 3-unit grant three,
// 30 days apart; a converted comp counts from the first of next month.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const at = (iso: string, days = 0) => new Date(Date.parse(iso) + days * DAY_MS);
const base = { status: "applied", applied_as: "overlay" };

describe("freeDaysAllotmentsDue", () => {
  const grant = { ...base, units: 3, credits_from: "2026-11-20T10:00:00Z", ends_at: "2027-02-18T10:00:00Z" };

  it("k = 0 at the start, k = 1 thirty days later, k = 2 sixty — and no more", () => {
    expect(freeDaysAllotmentsDue(grant, at("2026-11-20T09:59:59Z"))).toEqual([]);
    expect(freeDaysAllotmentsDue(grant, at("2026-11-20T10:00:00Z"))).toEqual([0]);
    expect(freeDaysAllotmentsDue(grant, at("2026-12-01T00:00:00Z"))).toEqual([0]); // the calendar month changed: nothing
    expect(freeDaysAllotmentsDue(grant, at("2026-11-20T10:00:00Z", 30))).toEqual([0, 1]);
    expect(freeDaysAllotmentsDue(grant, at("2026-11-20T10:00:00Z", 60))).toEqual([0, 1, 2]);
    expect(freeDaysAllotmentsDue(grant, at("2027-06-01T00:00:00Z"))).toEqual([0, 1, 2]);
  });

  it("a converted comp (credits_from later than its start): only the instants before its end", () => {
    // 10 days left when converted; the first allotment would land after it.
    const short = { ...base, units: 1, credits_from: "2026-12-01T00:00:00Z", ends_at: "2026-11-15T00:00:00Z" };
    expect(freeDaysAllotmentsDue(short, at("2027-01-01T00:00:00Z"))).toEqual([]);
    // 50 days left: units 2, Dec 1 lands inside, Dec 31 past the end.
    const two = { ...base, units: 2, credits_from: "2026-12-01T00:00:00Z", ends_at: "2026-12-25T00:00:00Z" };
    expect(freeDaysAllotmentsDue(two, at("2027-01-01T00:00:00Z"))).toEqual([0]);
  });

  it("an open-ended (staff) grant gets no automatic allotment (owner 2026-11-06: an admin grants by hand)", () => {
    const staff = { ...base, units: null, credits_from: "2026-11-01T00:00:00Z", ends_at: null };
    expect(freeDaysAllotmentsDue(staff, at("2026-11-01T00:00:00Z", 95))).toEqual([]);
  });

  it("pending, failed, revoked and below-plan grants owe nothing", () => {
    for (const status of ["pending", "failed", "revoked"]) {
      expect(freeDaysAllotmentsDue({ ...base, status, units: 1, credits_from: "2026-01-01T00:00:00Z", ends_at: "2026-01-31T00:00:00Z" }, at("2026-02-01T00:00:00Z"))).toEqual([]);
    }
    expect(freeDaysAllotmentsDue({ ...base, applied_as: "below_plan", units: 1, credits_from: "2026-01-01T00:00:00Z", ends_at: "2026-01-31T00:00:00Z" }, at("2026-02-01T00:00:00Z"))).toEqual([]);
  });

  it("the key", () => {
    expect(planGrantCreditKey("g1", 2)).toBe("grant:g1:2");
  });
});

describe("grantCreditsForGrant — one grant, at apply time", () => {
  const grant = { id: "g1", user_id: "u1", tier: "plus", units: 1, credits_from: "2026-11-20T00:00:00Z", ends_at: "2026-12-20T00:00:00Z", applied_as: "overlay", status: "applied" } as const;
  it("a thrown client error is a plain { ok: false }, never a throw", async () => {
    const s = chainClient(() => ({ data: [] }));
    s.rpc.mockRejectedValueOnce(new Error("socket hang up"));
    expect(await grantCreditsForGrant(s.client as never, grant, at("2026-11-20T00:00:01Z"))).toEqual({ ok: false, error: "socket hang up" });
  });
  it("reads the overlay's allotment from the plan state the writer hands it — the profile row is NOT read", async () => {
    const s = chainClient((table) => (table === "profiles" ? { data: { subscription_status: "active", subscription_tier: "plus" } } : { data: [] }));
    s.rpc.mockResolvedValue({ data: 130, error: null });
    // Stripe says past_due (the profile's `active` copy lags the webhook): the full allotment.
    const r = await grantCreditsForGrant(s.client as never, grant, at("2026-11-20T00:00:01Z"), { subscription_status: "past_due", subscription_tier: "plus" });
    expect(r).toEqual({ ok: true, granted: 1 });
    expect(s.forTable("profiles")).toHaveLength(0);
    expect(s.rpc).toHaveBeenCalledWith("grant_credits", expect.objectContaining({ p_amount: 30, p_idempotency_key: "grant:g1:0" }));
    // Nothing due yet → nothing read, nothing granted.
    expect(await grantCreditsForGrant(s.client as never, grant, at("2026-11-19T00:00:00Z"))).toEqual({ ok: true, granted: 0 });
  });
});

describe("grantFreeDaysCredits — the sweep", () => {
  function stub(
    rows: Array<Record<string, unknown>>,
    ledger: Record<string, string[]> = {},
    opts: { rpcError?: string; pageError?: string; profiles?: Record<string, { subscription_status: string | null; subscription_tier: string | null }> } = {},
  ) {
    const s = chainClient((table, calls): ChainAnswer => {
      if (table === "profiles") {
        const id = String(calls.find((c) => c.method === "eq")?.args[1]);
        return { data: opts.profiles?.[id] ?? null };
      }
      if (table === "plan_grants") {
        if (opts.pageError) return { error: { message: opts.pageError } };
        const range = calls.find((c) => c.method === "range")!.args as unknown as [number, number];
        return { data: rows.slice(range[0], range[1] + 1) };
      }
      if (table === "credit_ledger") {
        const like = String(calls.find((c) => c.method === "like")!.args[1]);
        const id = like.slice("grant:".length, -2);
        return { data: (ledger[id] ?? []).map((k) => ({ idempotency_key: k })) };
      }
      return {};
    });
    s.rpc.mockImplementation(async () => (opts.rpcError ? { data: null, error: { message: opts.rpcError } } : { data: 130, error: null }));
    return s;
  }
  const now = at("2026-12-21T00:00:00Z");
  const plus = { id: "g1", user_id: "u1", tier: "plus", units: 2, credits_from: "2026-11-20T00:00:00Z", ends_at: "2027-01-19T00:00:00Z", applied_as: "overlay", status: "applied" };
  const pro = { id: "g2", user_id: "u2", tier: "pro", units: 1, credits_from: "2026-12-01T00:00:00Z", ends_at: "2026-12-31T00:00:00Z", applied_as: "subscription_hold", status: "applied" };

  it("grants the missing allotments only (the ledger keys already held are skipped), the legacy tier allotment each", async () => {
    const s = stub([plus, pro], { g1: ["grant:g1:0"] });
    const result = await grantFreeDaysCredits(s.client as never, { now });
    expect(result).toEqual({ ok: true, processed: 2, granted: 2, failed: 0 });
    expect((s.rpc.mock.calls as unknown as Array<[string, unknown]>).map((c) => c[1])).toEqual([
      { p_user_id: "u1", p_amount: 30, p_reason: "plan_grant", p_idempotency_key: "grant:g1:1" },
      { p_user_id: "u2", p_amount: 100, p_reason: "plan_grant", p_idempotency_key: "grant:g2:0" },
    ]);
    // The page read: applied grants, overlay or hold, live or ended inside the lookback.
    const page = s.forTable("plan_grants")[0].calls;
    expect(called(page, "eq", "status")).toBe(true);
    expect(page.find((c) => c.method === "in")?.args).toEqual(["applied_as", ["overlay", "subscription_hold"]]);
    const or = String(page.find((c) => c.method === "or")?.args[0]);
    expect(or).toMatch(/^ends_at\.is\.null,ends_at\.gte\./);
    expect(Date.parse(or.slice("ends_at.is.null,ends_at.gte.".length))).toBe(now.getTime() - GRANT_SWEEP_LOOKBACK_DAYS * DAY_MS);
  });

  it("an OVERLAY grant on an ACTIVE plan adds only the difference between the tiers — nothing when the plan's tier is the grant's or higher (a comp converted by 0176 on a payer never double-grants)", async () => {
    expect(overlayAllotmentOver("pro", { subscription_status: "active", subscription_tier: "plus" })).toBe(70);
    expect(overlayAllotmentOver("plus", { subscription_status: "active", subscription_tier: "pro" })).toBe(0);
    expect(overlayAllotmentOver("plus", { subscription_status: "active", subscription_tier: "plus" })).toBe(0);
    expect(overlayAllotmentOver("pro", { subscription_status: "canceled", subscription_tier: "pro" })).toBe(100);
    expect(overlayAllotmentOver("pro", { subscription_status: "trialing", subscription_tier: "pro" })).toBe(100);
    expect(overlayAllotmentOver("pro", null)).toBe(100);
    const s = stub([plus, { ...pro, applied_as: "overlay" }], {}, {
      profiles: { u1: { subscription_status: "active", subscription_tier: "plus" }, u2: { subscription_status: "active", subscription_tier: "plus" } },
    });
    const result = await grantFreeDaysCredits(s.client as never, { now });
    // u1: a Plus overlay on a Plus plan — nothing; u2: a Pro overlay on a Plus plan — 70.
    expect(result).toEqual({ ok: true, processed: 2, granted: 1, failed: 0 });
    expect((s.rpc.mock.calls as unknown as Array<[string, { p_amount: number; p_idempotency_key: string }]>).map((c) => [c[1].p_idempotency_key, c[1].p_amount])).toEqual([["grant:g2:0", 70]]);
    // A HOLD grant never reads the profile (its plan reads trialing).
    const held = stub([pro], {}, { profiles: { u2: { subscription_status: "active", subscription_tier: "pro" } } });
    await grantFreeDaysCredits(held.client as never, { now });
    expect(held.forTable("profiles")).toHaveLength(0);
  });

  it("a failed RPC is counted, logged and handed to onGrantFailed; the sweep goes on", async () => {
    const s = stub([plus, pro], {}, { rpcError: "boom" });
    const failed: string[] = [];
    const result = await grantFreeDaysCredits(s.client as never, { now, onGrantFailed: (userId) => failed.push(userId) });
    expect(result).toEqual({ ok: true, processed: 2, granted: 0, failed: 2 });
    expect(failed).toEqual(["u1", "u2"]);
  });

  it("a page read failure aborts with the error", async () => {
    const s = stub([], {}, { pageError: "db down" });
    expect(await grantFreeDaysCredits(s.client as never, { now })).toEqual({ ok: false, error: "db down" });
  });

  it("pages past GRANT_SWEEP_PAGE_SIZE", async () => {
    const rows = Array.from({ length: GRANT_SWEEP_PAGE_SIZE + 3 }, (_, i) => ({ ...pro, id: `g${i}`, user_id: `u${i}` }));
    const s = stub(rows);
    const result = await grantFreeDaysCredits(s.client as never, { now });
    expect(result).toEqual({ ok: true, processed: rows.length, granted: rows.length, failed: 0 });
    expect(s.forTable("plan_grants")).toHaveLength(2);
  });
});
