import { describe, expect, it } from "vitest";
import {
  applyRunOutcome,
  breakerAfterBatch,
  breakerForPoison,
  BREAKER_NEW_FAILURES,
  EMPTY_AUTO_REBAKE_STATE,
  formatRunLog,
  leaseIsLive,
  parseSweepState,
  POISON_AFTER_STRIKES,
  POISON_MAX,
  STRIKE_TTL_MS,
  type AutoRebakeRunSummary,
  type PoisonEntry,
} from "@/lib/cards/auto-rebake-state";

// ---------------------------------------------------------------------------
// The automatic re-bake's bookkeeping (lib/cards/auto-rebake-state.ts): the
// defensive row parser, strikes → poison list (a card is never retried
// forever), and the circuit breaker's rules (systemic failures pause the
// sweep; a known-bad card failing again does not).
// ---------------------------------------------------------------------------

const AT = "2026-09-28T12:00:00.000Z";

describe("parseSweepState", () => {
  it("reads a full row", () => {
    const state = parseSweepState({
      lease_holder: "cron",
      lease_token: "tok",
      lease_expires_at: "2026-09-28T12:05:10Z",
      lease_acquired_at: "2026-09-28T12:00:00Z",
      yield_requested_at: null,
      paused: true,
      paused_reason: "boom",
      paused_at: AT,
      strikes: { a: { n: 2, error: "art", at: AT } },
      poison: [{ id: "b", error: "art", failures: 3, at: AT }],
      last_run: { stop: "done", rebaked: 3 },
      idle: { layoutVersion: 32, candidates: 4, at: AT },
      last_checked_at: AT,
      revalidate_pending: true,
    });
    expect(state.lease).toEqual({ holder: "cron", running: true, expiresAt: "2026-09-28T12:05:10Z", acquiredAt: "2026-09-28T12:00:00Z" });
    expect(state.paused).toBe(true);
    expect(state.pausedReason).toBe("boom");
    expect(state.strikes).toEqual({ a: { n: 2, error: "art", at: AT } });
    expect(state.poison).toEqual([{ id: "b", error: "art", failures: 3, at: AT }]);
    expect(state.idle).toEqual({ layoutVersion: 32, candidates: 4, at: AT });
    expect(state.lastRun).toMatchObject({ stop: "done", rebaked: 3 });
    expect(state.revalidatePending).toBe(true);
  });

  it("tolerates a missing row and junk jsonb (never crashes the cron or the admin page)", () => {
    expect(parseSweepState(null)).toEqual(EMPTY_AUTO_REBAKE_STATE);
    const state = parseSweepState({
      lease_holder: "someone-else",
      strikes: ["nope", 1],
      poison: [null, 3, { error: "no id" }, { id: "x" }, { id: "x" }],
      idle: { layoutVersion: "32" },
      last_run: "garbage",
      paused: "yes",
    });
    expect(state.lease.holder).toBeNull();
    expect(state.lease.running).toBe(false);
    expect(state.strikes).toEqual({});
    expect(state.poison).toEqual([{ id: "x", error: "Unknown error", failures: POISON_AFTER_STRIKES, at: "" }]);
    expect(state.idle).toBeNull();
    expect(state.lastRun).toBeNull();
    expect(state.paused).toBe(false);
  });

  it("a manual holder without a token is parked, not running", () => {
    const state = parseSweepState({ lease_holder: "manual", lease_token: null, lease_expires_at: AT });
    expect(state.lease).toMatchObject({ holder: "manual", running: false });
  });
});

describe("leaseIsLive", () => {
  const at = (holder: "cron" | "manual" | null, expiresAt: string | null) =>
    parseSweepState({ lease_holder: holder, lease_token: holder ? "t" : null, lease_expires_at: expiresAt });
  it("is live only while a holder's expiry is in the future", () => {
    const now = Date.parse(AT);
    expect(leaseIsLive(at("cron", "2026-09-28T12:00:01Z"), now)).toBe(true);
    expect(leaseIsLive(at("manual", "2026-09-28T12:00:01Z"), now)).toBe(true);
    expect(leaseIsLive(at("cron", "2026-09-28T11:59:59Z"), now)).toBe(false);
    expect(leaseIsLive(at("cron", AT), now)).toBe(false);
    expect(leaseIsLive(at(null, null), now)).toBe(false);
  });
});

describe("applyRunOutcome — strikes and the poison list", () => {
  const empty = { strikes: {}, poison: [] as PoisonEntry[] };

  it("gives each failed card one strike per run and poisons it on the third", () => {
    let prev = empty;
    for (let run = 1; run < POISON_AFTER_STRIKES; run += 1) {
      const out = applyRunOutcome(prev, { failed: [{ id: "a", error: `art ${run}` }], succeeded: [], at: AT });
      expect(out.strikes.a).toEqual({ n: run, error: `art ${run}`, at: AT });
      expect(out.poisoned).toEqual([]);
      prev = out;
    }
    const last = applyRunOutcome(prev, { failed: [{ id: "a", error: "art 3" }], succeeded: [], at: AT });
    expect(last.strikes.a).toBeUndefined();
    expect(last.poison).toEqual([{ id: "a", error: "art 3", failures: POISON_AFTER_STRIKES, at: AT }]);
    expect(last.poisoned.map((p) => p.id)).toEqual(["a"]);
  });

  it("counts a card once per run, however often it appears", () => {
    const out = applyRunOutcome(empty, {
      failed: [
        { id: "a", error: "x" },
        { id: "a", error: "y" },
      ],
      succeeded: [],
      at: AT,
    });
    expect(out.strikes.a.n).toBe(1);
  });

  it("a card that re-bakes loses its strikes and leaves the poison list", () => {
    const prev = {
      strikes: { a: { n: 2, error: "art", at: AT } },
      poison: [{ id: "p", error: "art", failures: 3, at: AT }],
    };
    const out = applyRunOutcome(prev, { failed: [], succeeded: ["a", "p"], at: AT });
    expect(out.strikes).toEqual({});
    expect(out.poison).toEqual([]);
  });

  it("forgets strikes nobody retried for a week, keeps younger ones", () => {
    const old = new Date(Date.parse(AT) - STRIKE_TTL_MS - 1000).toISOString();
    const young = new Date(Date.parse(AT) - 60_000).toISOString();
    const out = applyRunOutcome(
      { strikes: { old: { n: 2, error: "e", at: old }, young: { n: 1, error: "e", at: young } }, poison: [] },
      { failed: [], succeeded: [], at: AT },
    );
    expect(Object.keys(out.strikes)).toEqual(["young"]);
  });

  it("never adds a poisoned card twice", () => {
    const prev = { strikes: {}, poison: [{ id: "p", error: "art", failures: 3, at: AT }] };
    const out = applyRunOutcome(prev, { failed: [{ id: "p", error: "again" }], succeeded: [], at: AT });
    expect(out.poison).toHaveLength(1);
    expect(out.poisoned).toEqual([]);
  });
});

describe("the breaker", () => {
  const fail = (...ids: string[]) => ids.map((id) => ({ id, error: `Row update failed (${id})` }));

  it("trips when a whole batch of first-time failures re-baked nothing", () => {
    const reason = breakerAfterBatch({ processed: 0, superseded: 0, failed: fail("a", "b", "c") }, { newFailures: 3 }, new Set());
    expect(reason).toMatch(/whole batch failed \(3 cards\): Row update failed \(a\)/i);
  });

  it("doesn't trip on a small tail batch, on known-bad cards, or when something succeeded", () => {
    expect(breakerAfterBatch({ processed: 0, superseded: 0, failed: fail("a", "b") }, { newFailures: 2 }, new Set())).toBeNull();
    expect(
      breakerAfterBatch({ processed: 0, superseded: 0, failed: fail("a", "b", "c") }, { newFailures: 0 }, new Set(["a", "b", "c"])),
    ).toBeNull();
    expect(breakerAfterBatch({ processed: 5, superseded: 0, failed: fail("a", "b", "c") }, { newFailures: 3 }, new Set())).toBeNull();
    expect(breakerAfterBatch({ processed: 0, superseded: 1, failed: fail("a", "b", "c") }, { newFailures: 3 }, new Set())).toBeNull();
  });

  it("trips once first-time failures in one run reach the threshold", () => {
    expect(
      breakerAfterBatch({ processed: 6, superseded: 0, failed: fail("z") }, { newFailures: BREAKER_NEW_FAILURES - 1 }, new Set()),
    ).toBeNull();
    expect(
      breakerAfterBatch({ processed: 6, superseded: 0, failed: fail("z") }, { newFailures: BREAKER_NEW_FAILURES }, new Set()),
    ).toMatch(new RegExp(`${BREAKER_NEW_FAILURES} cards failed`));
  });

  it("trips when the poison list outgrows its cap", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, error: "e", failures: 3, at: AT }));
    expect(breakerForPoison(list(POISON_MAX))).toBeNull();
    expect(breakerForPoison(list(POISON_MAX + 1))).toMatch(/keep failing/);
  });
});

describe("formatRunLog", () => {
  it("is one compact line with the counts, never per-card ids", () => {
    const summary: AutoRebakeRunSummary = {
      startedAt: AT,
      finishedAt: AT,
      durationMs: 238_400,
      layoutVersion: 32,
      batches: 12,
      rebaked: 90,
      stamped: 3,
      failed: 1,
      superseded: 0,
      remaining: 140,
      stop: "budget",
      failures: [{ id: "11111111-1111-4111-8111-111111111111", error: "art" }],
      poisoned: [],
    };
    const line = formatRunLog(summary);
    expect(line).toBe(
      "[auto-rebake] v32 stop=budget batches=12 rebaked=90 stamped=3 failed=1 superseded=0 remaining=140 238s",
    );
    expect(line).not.toContain("\n");
    expect(line).not.toContain("11111111");
  });
});
