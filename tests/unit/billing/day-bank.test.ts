import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainClient, called, payloadOf, type ChainAnswer } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// lib/billing/day-bank.ts — the days bank: the signup entry once per account,
// a checkout's reservation (and its settlement), the stale-reservation sweep,
// and the user's own application of banked days to a live plan through the
// free-days mechanism (mocked here: its own test holds it).
// ---------------------------------------------------------------------------

const freeDays = vi.hoisted(() => ({ grantFreeDays: vi.fn() }));
vi.mock("@/lib/billing/free-days-apply", () => freeDays);

import {
  MIN_BANK_DAYS_AT_CHECKOUT,
  SIGNUP_BANK_DAYS,
  applyBankToPlan,
  bankDays,
  ensureSignupBankEntry,
  prepareCheckoutBank,
  readBank,
  releaseStaleReservations,
  settleBankBatch,
  settleCheckoutBank,
  signupBankReference,
} from "@/lib/billing/day-bank";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-10T15:14:00Z");

type Row = { id: string; days: number; source: string; status: string; created_at: string; applied_at: string | null; reference?: string };

function db(rows: Row[], opts: { insertCode?: string; updateError?: string } = {}) {
  return chainClient((table, calls): ChainAnswer => {
    if (table !== "day_bank_entries") return {};
    if (called(calls, "insert")) {
      if (opts.insertCode) return { error: { code: opts.insertCode, message: "dup" } };
      return { data: { id: "e_new" } };
    }
    if (called(calls, "update")) {
      if (opts.updateError) return { error: { message: opts.updateError } };
      const status = calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
      const batch = calls.find((c) => c.method === "eq" && c.args[0] === "batch_id")?.args[1];
      const hit = rows.filter((r) => (status ? r.status === status : true) && (batch ? (r as { batch_id?: string }).batch_id === batch : true));
      return { data: hit.map((r) => ({ days: r.days, id: r.id })) };
    }
    if (called(calls, "select")) {
      const byRef = calls.find((c) => c.method === "eq" && c.args[0] === "reference")?.args[1];
      if (byRef) return { data: rows.find((r) => r.reference === byRef) ?? null };
      return { data: rows };
    }
    return {};
  });
}

const banked = (days: number, extra: Partial<Row> = {}): Row => ({
  id: `e_${days}_${Math.random().toString(36).slice(2, 6)}`,
  days,
  source: "signup",
  status: "banked",
  created_at: "2026-11-01T00:00:00Z",
  applied_at: null,
  ...extra,
});

beforeEach(() => {
  freeDays.grantFreeDays.mockReset();
});

describe("the bank's reads and writes", () => {
  it("readBank sums banked and reserved days apart; an unreadable bank reads as empty", async () => {
    const stub = db([banked(7), banked(5, { status: "reserved" }), banked(3, { status: "applied" }), banked(2, { status: "revoked" })]);
    expect(await readBank(stub.client as never, USER)).toMatchObject({ banked: 7, reserved: 5 });
    const broken = chainClient(() => ({ error: { message: "down" } }));
    expect(await readBank(broken.client as never, USER)).toEqual({ banked: 0, reserved: 0, entries: [] });
  });

  it("bankDays writes once per reference (a duplicate finds the entry it made) and refuses a bad length", async () => {
    const stub = db([]);
    expect(await bankDays(stub.client as never, { userId: USER, days: 7, source: "signup", reference: signupBankReference(USER) })).toEqual({ ok: true, entryId: "e_new", created: true });
    expect(payloadOf(stub.forTable("day_bank_entries")[0].calls, "insert")).toMatchObject({ user_id: USER, days: 7, source: "signup", reference: `signup:${USER}` });
    const dup = db([banked(7, { id: "e_old", reference: signupBankReference(USER) })], { insertCode: "23505" });
    expect(await ensureSignupBankEntry(dup.client as never, USER)).toEqual({ ok: true, entryId: "e_old", created: false });
    expect(await bankDays(stub.client as never, { userId: USER, days: 0, source: "signup", reference: "x" })).toMatchObject({ ok: false });
    expect(SIGNUP_BANK_DAYS).toBe(7);
  });
});

describe("prepareCheckoutBank — a fresh checkout's free period", () => {
  it("owed signup days: the entry is made, every banked day reserved under one batch", async () => {
    const stub = db([banked(7), banked(5)]);
    const out = await prepareCheckoutBank(stub.client as never, USER, { signupEligible: true, now: NOW });
    expect(out).toMatchObject({ days: 12 });
    expect(out?.batchId).toMatch(/^[0-9a-f-]{36}$/);
    const reserve = stub.forTable("day_bank_entries").find((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "reserved")!;
    expect(payloadOf(reserve.calls, "update")).toMatchObject({ status: "reserved", batch_id: out?.batchId, reserved_at: NOW.toISOString() });
    expect(stub.forTable("day_bank_entries").some((e) => called(e.calls, "insert"))).toBe(true);
  });

  it("NOT owed (the email already had a free period): the signup entry is revoked, earned days still apply", async () => {
    const stub = db([banked(5, { source: "referral_step" })]);
    const out = await prepareCheckoutBank(stub.client as never, USER, { signupEligible: false, now: NOW });
    expect(out).toMatchObject({ days: 5 });
    const revoke = stub.forTable("day_bank_entries").find((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "revoked")!;
    expect(payloadOf(revoke.calls, "update")).toMatchObject({ status: "revoked", revoke_reason: expect.stringMatching(/not owed/) });
    expect(revoke.calls.find((c) => c.method === "eq" && c.args[0] === "reference")?.args[1]).toBe(signupBankReference(USER));
  });

  it(`under ${MIN_BANK_DAYS_AT_CHECKOUT} banked days (Stripe's 48 h minimum) nothing is reserved — the day waits`, async () => {
    const stub = db([banked(1)]);
    expect(await prepareCheckoutBank(stub.client as never, USER, { signupEligible: false, now: NOW })).toBeNull();
    expect(stub.forTable("day_bank_entries").some((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "reserved")).toBe(false);
  });

  it("nothing banked: null, nothing written but the signup decision", async () => {
    expect(await prepareCheckoutBank(db([]).client as never, USER, { signupEligible: false, now: NOW })).toBeNull();
  });
});

describe("settling", () => {
  it("a completed Checkout spends its batch (applied via checkout, the session as the reference); an expired one returns it", async () => {
    const rows = [banked(7, { status: "reserved", batch_id: "bb_1" } as Partial<Row>)];
    const done = db(rows);
    await settleCheckoutBank(done.client as never, { id: "cs_1", mode: "subscription", metadata: { bank_batch: "bb_1" } }, "completed");
    const applied = done.forTable("day_bank_entries").find((e) => called(e.calls, "update"))!;
    expect(payloadOf(applied.calls, "update")).toMatchObject({ status: "applied", applied_via: "checkout", applied_ref: "cs_1" });
    expect(applied.calls.find((c) => c.method === "eq" && c.args[0] === "batch_id")?.args[1]).toBe("bb_1");
    expect(applied.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1]).toBe("reserved");

    const back = db(rows);
    await settleCheckoutBank(back.client as never, { id: "cs_1", mode: "subscription", metadata: { bank_batch: "bb_1" } }, "expired");
    expect(payloadOf(back.forTable("day_bank_entries")[0].calls, "update")).toEqual({ status: "banked", batch_id: null, reserved_at: null });

    // A pack session, or one with no batch: nothing.
    const none = db(rows);
    await settleCheckoutBank(none.client as never, { id: "cs_2", mode: "payment", metadata: { bank_batch: "bb_1" } }, "completed");
    await settleCheckoutBank(none.client as never, { id: "cs_3", mode: "subscription", metadata: {} }, "completed");
    expect(none.forTable("day_bank_entries")).toHaveLength(0);
  });

  it("a stale reservation (older than a Checkout's life) goes back to the bank", async () => {
    const stub = db([banked(7, { status: "reserved", batch_id: "bb_old" } as Partial<Row>)]);
    expect(await releaseStaleReservations(stub.client as never, NOW)).toBe(1);
    const sweep = stub.forTable("day_bank_entries")[0];
    expect(payloadOf(sweep.calls, "update")).toEqual({ status: "banked", batch_id: null, reserved_at: null });
    expect(sweep.calls.find((c) => c.method === "lt")?.args).toEqual(["reserved_at", new Date(NOW.getTime() - 25 * 3_600_000).toISOString()]);
  });
});

describe("applyBankToPlan — the user's own click", () => {
  it("reserves the bank, adds the days as a HOLD with no credits under the batch's reference, then marks them applied", async () => {
    const stub = db([banked(5), banked(7)]);
    freeDays.grantFreeDays.mockResolvedValue({ ok: true, grantId: "g_1", holdEndsAt: "2026-12-17T00:00:00Z", note: "moved", plan: { kind: "hold" }, endsAt: null, creditsGranted: 0 });
    const out = await applyBankToPlan(stub.client as never, { userId: USER, tier: "plus" }, { now: NOW });
    expect(out).toEqual({ ok: true, days: 12, holdEndsAt: "2026-12-17T00:00:00Z", note: "moved" });
    const [, input] = freeDays.grantFreeDays.mock.calls[0];
    expect(input).toMatchObject({ userId: USER, tier: "plus", units: null, days: 12, grantsCredits: false, holdOnly: true, source: "day_bank" });
    expect(input.reference).toMatch(/^day-bank:[0-9a-f-]{36}$/);
    const applied = stub.forTable("day_bank_entries").find((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "applied")!;
    expect(payloadOf(applied.calls, "update")).toMatchObject({ applied_via: "plan_hold", applied_ref: "g_1" });
  });

  it("a refused grant (no live plan, a plan set to end) hands the days back and says why", async () => {
    const stub = db([banked(7)]);
    freeDays.grantFreeDays.mockResolvedValue({ ok: false, error: "Banked days need a live plan: start a plan first, and they become its free period." });
    const out = await applyBankToPlan(stub.client as never, { userId: USER, tier: "plus" }, { now: NOW });
    expect(out).toMatchObject({ ok: false, code: "no_live_plan" });
    const back = stub.forTable("day_bank_entries").find((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "banked");
    expect(back).toBeTruthy();
  });

  it("nothing banked: nothing granted", async () => {
    const out = await applyBankToPlan(db([]).client as never, { userId: USER, tier: "plus" }, { now: NOW });
    expect(out).toMatchObject({ ok: false, code: "nothing_banked" });
    expect(freeDays.grantFreeDays).not.toHaveBeenCalled();
  });

  it("settleBankBatch reports a failed write without throwing", async () => {
    const stub = db([], { updateError: "down" });
    expect(await settleBankBatch(stub.client as never, "bb_x", { kind: "banked" })).toEqual({ ok: false, days: 0 });
  });
});
