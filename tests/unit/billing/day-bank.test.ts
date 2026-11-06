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
  reclaimOpenCheckouts,
  stampBankBatchSession,
  MIN_ADMIN_BANK_DAYS,
  adminBankReference,
  listBankEntriesForAdmin,
  revokeBankedEntry,
} from "@/lib/billing/day-bank";

const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = new Date("2026-11-10T15:14:00Z");

type Row = { id: string; days: number; source: string; status: string; created_at: string; applied_at: string | null; reference?: string; batch_id?: string; applied_ref?: string };

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
      const statuses = calls.find((c) => c.method === "in" && c.args[0] === "status")?.args[1] as string[] | undefined;
      const batch = calls.find((c) => c.method === "eq" && c.args[0] === "batch_id")?.args[1];
      const hit = rows.filter(
        (r) =>
          (status ? r.status === status : true) &&
          (statuses ? statuses.includes(r.status) : true) &&
          (batch ? (r as { batch_id?: string }).batch_id === batch : true),
      );
      return { data: hit.map((r) => ({ days: r.days, id: r.id })) };
    }
    if (called(calls, "select")) {
      const byRef = calls.find((c) => c.method === "eq" && c.args[0] === "reference")?.args[1];
      if (byRef) return { data: rows.find((r) => r.reference === byRef) ?? null };
      const status = calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1];
      return { data: status ? rows.filter((r) => r.status === status) : rows };
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
    expect(await bankDays(stub.client as never, { userId: USER, days: 7, source: "signup", reference: signupBankReference(USER) })).toEqual({ ok: true, entryId: "e_new", created: true, days: 7 });
    expect(payloadOf(stub.forTable("day_bank_entries")[0].calls, "insert")).toMatchObject({ user_id: USER, days: 7, source: "signup", reference: `signup:${USER}` });
    const dup = db([banked(7, { id: "e_old", reference: signupBankReference(USER) })], { insertCode: "23505" });
    expect(await ensureSignupBankEntry(dup.client as never, USER)).toEqual({ ok: true, entryId: "e_old", created: false, days: 7 });
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

  it(`a single banked day checks out (MIN_BANK_DAYS_AT_CHECKOUT is ${MIN_BANK_DAYS_AT_CHECKOUT}: trial_period_days has no 48 h floor)`, async () => {
    expect(MIN_BANK_DAYS_AT_CHECKOUT).toBe(1);
    const stub = db([banked(1)]);
    expect(await prepareCheckoutBank(stub.client as never, USER, { signupEligible: false, now: NOW })).toMatchObject({ days: 1 });
  });

  it("a comp that already holds the first charge PAST the bank's end leaves the days banked (check P1-3); one that ends inside it spends them", async () => {
    const stub = db([banked(7)]);
    const compEnd = Math.floor(NOW.getTime() / 1000) + 30 * 86_400;
    expect(await prepareCheckoutBank(stub.client as never, USER, { signupEligible: false, now: NOW, skipIfEndsBefore: compEnd })).toBeNull();
    expect(stub.forTable("day_bank_entries").some((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "reserved")).toBe(false);
    const inside = db([banked(7)]);
    expect(await prepareCheckoutBank(inside.client as never, USER, { signupEligible: false, now: NOW, skipIfEndsBefore: Math.floor(NOW.getTime() / 1000) + 3 * 86_400 })).toMatchObject({ days: 7 });
  });

  it("a bank past 730 days is reserved up to the limit, OLDEST first — the entry that would pass it stays banked (check P2)", async () => {
    const rows = [
      banked(700, { id: "e_old", created_at: "2026-01-01T00:00:00Z" }),
      banked(40, { id: "e_mid", created_at: "2026-06-01T00:00:00Z" }),
      banked(20, { id: "e_new", created_at: "2026-11-01T00:00:00Z" }),
    ];
    const stub = chainClient((table, calls): ChainAnswer => {
      if (table !== "day_bank_entries") return {};
      if (called(calls, "update")) {
        const ids = calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1] as string[] | undefined;
        if (!ids) return { data: [] }; // the signup revoke (by reference)
        return { data: rows.filter((r) => ids.includes(r.id)).map((r) => ({ days: r.days })) };
      }
      if (called(calls, "select")) return { data: rows }; // readBank (status) and reserveBank (id, days)
      return {};
    });
    const out = await prepareCheckoutBank(stub.client as never, USER, { signupEligible: false, now: NOW });
    expect(out).toMatchObject({ days: 720 });
    const reserve = stub.forTable("day_bank_entries").find((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "reserved")!;
    expect(reserve.calls.find((c) => c.method === "in" && c.args[0] === "id")?.args[1]).toEqual(["e_old", "e_new"]);
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
    // "Applied" also takes a row the stale sweep put back to `banked` with its
    // batch kept (P3-4): a late completed event still spends it.
    expect(applied.calls.find((c) => c.method === "in" && c.args[0] === "status")?.args[1]).toEqual(["reserved", "banked"]);

    const back = db(rows);
    await settleCheckoutBank(back.client as never, { id: "cs_1", mode: "subscription", metadata: { bank_batch: "bb_1" } }, "expired");
    expect(payloadOf(back.forTable("day_bank_entries")[0].calls, "update")).toEqual({ status: "banked", batch_id: null, reserved_at: null });
    expect(back.forTable("day_bank_entries")[0].calls.find((c) => c.method === "in" && c.args[0] === "status")?.args[1]).toEqual(["reserved"]);

    // A pack session, or one with no batch: nothing.
    const none = db(rows);
    await settleCheckoutBank(none.client as never, { id: "cs_2", mode: "payment", metadata: { bank_batch: "bb_1" } }, "completed");
    await settleCheckoutBank(none.client as never, { id: "cs_3", mode: "subscription", metadata: {} }, "completed");
    expect(none.forTable("day_bank_entries")).toHaveLength(0);
  });

  it("a stale reservation (older than a Checkout's life) goes back to the bank — its batch kept for a late completed event", async () => {
    const stub = db([banked(7, { status: "reserved", batch_id: "bb_old" } as Partial<Row>)]);
    expect(await releaseStaleReservations(stub.client as never, NOW)).toBe(1);
    const sweep = stub.forTable("day_bank_entries")[0];
    expect(payloadOf(sweep.calls, "update")).toEqual({ status: "banked", reserved_at: null });
    expect(sweep.calls.find((c) => c.method === "lt")?.args).toEqual(["reserved_at", new Date(NOW.getTime() - 25 * 3_600_000).toISOString()]);
  });
});

describe("an abandoned Checkout's days (check P1-2)", () => {
  it("stampBankBatchSession writes the session onto the reserved batch", async () => {
    const stub = db([]);
    await stampBankBatchSession(stub.client as never, "bb_1", "cs_open");
    const write = stub.forTable("day_bank_entries")[0];
    expect(payloadOf(write.calls, "update")).toEqual({ applied_ref: "cs_open" });
    expect(write.calls.find((c) => c.method === "eq" && c.args[0] === "batch_id")?.args[1]).toBe("bb_1");
    expect(write.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1]).toBe("reserved");
  });

  it("an OPEN session is expired at Stripe and its days go back; a COMPLETE one is left to its webhook; an EXPIRED one just returns the days", async () => {
    const sessions = { cs_open: "open", cs_done: "complete", cs_gone: "expired" } as Record<string, string>;
    const expire = vi.fn(async () => ({}));
    const stripe = { checkout: { sessions: { retrieve: async (id: string) => ({ id, status: sessions[id] }), expire } } };
    const rows = [
      { ...banked(7, { status: "reserved" }), batch_id: "bb_a", applied_ref: "cs_open" },
      { ...banked(3, { status: "reserved" }), batch_id: "bb_b", applied_ref: "cs_done" },
      { ...banked(2, { status: "reserved" }), batch_id: "bb_c", applied_ref: "cs_gone" },
    ];
    const stub = chainClient((table, calls): ChainAnswer => {
      if (table !== "day_bank_entries") return {};
      if (called(calls, "select") && !called(calls, "update")) return { data: rows.map((r) => ({ batch_id: r.batch_id, applied_ref: r.applied_ref })) };
      const batch = calls.find((c) => c.method === "eq" && c.args[0] === "batch_id")?.args[1];
      return { data: rows.filter((r) => r.batch_id === batch).map((r) => ({ days: r.days })) };
    });
    expect(await reclaimOpenCheckouts(stub.client as never, stripe as never, USER, NOW)).toBe(2);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith("cs_open");
    const released = stub.forTable("day_bank_entries").filter((e) => called(e.calls, "update")).map((e) => e.calls.find((c) => c.method === "eq" && c.args[0] === "batch_id")?.args[1]);
    expect(released.sort()).toEqual(["bb_a", "bb_c"]);
  });

  it("a Stripe read that fails still returns the days (the session, if open, dies on its own within a day)", async () => {
    const stripe = { checkout: { sessions: { retrieve: async () => { throw new Error("down"); }, expire: vi.fn() } } };
    const stub = chainClient((table, calls): ChainAnswer => {
      if (called(calls, "select") && !called(calls, "update")) return { data: [{ batch_id: "bb_a", applied_ref: "cs_open" }] };
      return { data: [{ days: 7 }] };
    });
    expect(await reclaimOpenCheckouts(stub.client as never, stripe as never, USER, NOW)).toBe(1);
  });
});

describe("the admin's comp (owner 2026-11-06): banked days", () => {
  it("MIN_ADMIN_BANK_DAYS is the owner's floor of two; the reference is the form's request id", () => {
    expect(MIN_ADMIN_BANK_DAYS).toBe(2);
    expect(adminBankReference("req_1")).toBe("admin:req_1");
  });

  it("listBankEntriesForAdmin reads every column, newest first; an unreadable bank is said", async () => {
    const stub = chainClient((table, calls): ChainAnswer => {
      if (table !== "day_bank_entries" || !called(calls, "select")) return {};
      return {
        data: [
          { id: "e1", days: 7, source: "admin", status: "banked", created_at: "2026-11-06T00:00:00Z", applied_at: null, reference: "admin:r1", note: "thanks (by a1)", applied_via: null, applied_ref: null, revoked_at: null, revoke_reason: null },
          { id: "e2", days: 7, source: "signup", status: "applied", created_at: "2026-11-01T00:00:00Z", applied_at: "2026-11-05T00:00:00Z", reference: `signup:${USER}`, note: null, applied_via: "checkout", applied_ref: "cs_1", revoked_at: null, revoke_reason: null },
        ],
      };
    });
    const out = await listBankEntriesForAdmin(stub.client as never, USER);
    expect(out.loadError).toBe(false);
    expect(out.rows).toEqual([
      expect.objectContaining({ id: "e1", days: 7, source: "admin", status: "banked", note: "thanks (by a1)", reference: "admin:r1", appliedVia: null }),
      expect.objectContaining({ id: "e2", status: "applied", appliedVia: "checkout", appliedRef: "cs_1", appliedAt: "2026-11-05T00:00:00Z" }),
    ]);
    const calls = stub.forTable("day_bank_entries")[0].calls;
    expect(calls.find((c) => c.method === "eq")?.args).toEqual(["user_id", USER]);
    expect(calls.find((c) => c.method === "order")?.args).toEqual(["created_at", { ascending: false }]);
    const broken = chainClient(() => ({ error: { message: "down" } }));
    expect(await listBankEntriesForAdmin(broken.client as never, USER)).toEqual({ rows: [], loadError: true });
  });

  it("revokeBankedEntry takes a BANKED entry back (its reason cut to 200) and refuses one already applied, reserved or revoked", async () => {
    const stub = chainClient((table, calls): ChainAnswer => {
      if (table !== "day_bank_entries" || !called(calls, "update")) return {};
      const id = calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1];
      return { data: id === "e_banked" ? { days: 7, user_id: USER } : null };
    });
    expect(await revokeBankedEntry(stub.client as never, "e_banked", "x".repeat(300), NOW)).toEqual({ ok: true, days: 7, userId: USER });
    const write = stub.forTable("day_bank_entries")[0];
    expect(payloadOf(write.calls, "update")).toEqual({ status: "revoked", revoked_at: NOW.toISOString(), revoke_reason: "x".repeat(200) });
    expect(write.calls.find((c) => c.method === "eq" && c.args[0] === "status")?.args[1]).toBe("banked");
    expect(await revokeBankedEntry(stub.client as never, "e_applied", "late", NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/aren't banked any more/) });
    const broken = chainClient(() => ({ error: { message: "down" } }));
    expect(await revokeBankedEntry(broken.client as never, "e_banked", "r", NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/down/) });
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

  it("a grant that THROWS hands the days back and fails plainly (never a batch stuck reserved)", async () => {
    const stub = db([banked(7)]);
    freeDays.grantFreeDays.mockRejectedValue(new Error("stripe down"));
    const out = await applyBankToPlan(stub.client as never, { userId: USER, tier: "plus" }, { now: NOW });
    expect(out).toEqual({ ok: false, error: "stripe down", code: "refused" });
    const back = stub.forTable("day_bank_entries").find((e) => called(e.calls, "update") && (payloadOf(e.calls, "update") as { status: string }).status === "banked");
    expect(back).toBeTruthy();
  });

  it("settleBankBatch reports a failed write without throwing", async () => {
    const stub = db([], { updateError: "down" });
    expect(await settleBankBatch(stub.client as never, "bb_x", { kind: "banked" })).toEqual({ ok: false, days: 0 });
  });
});
