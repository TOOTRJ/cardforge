import { beforeEach, describe, expect, it, vi } from "vitest";
import { called, type ChainCall } from "@/tests/stubs/supabase-chain";
import { sweepDb } from "@/tests/stubs/sweep-db";

// ---------------------------------------------------------------------------
// The automatic re-bake loop (lib/cards/auto-rebake.ts) behind
// /api/cron/auto-rebake. Contract:
//   * never bakes without the billing flag (the mark) — refuses, writes no card;
//   * cheap when idle: a paused sweep, a held lease or nothing pending costs a
//     state read + one head count (+ a timestamp write), no lease, no batch;
//   * sweeps in batches until a batch finds nothing, or the 240 s budget
//     would be crossed by the next batch;
//   * skipIds carry across batches (a failing card can't wedge the run) and
//     the poison list carries across invocations (never retried forever);
//   * the breaker pauses + alerts admins on systemic failure, a hung batch,
//     or an overflowing poison list — and only on FIRST-time failures;
//   * a manual run's yield request, or an admin's pause, stops it between
//     batches; the lease is released (kept on a hung batch).
// ---------------------------------------------------------------------------

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cards/rebake-batch", () => ({ DEFAULT_BATCH: 8, runRebakeBatch: vi.fn() }));

import {
  AUTO_REBAKE_BUDGET_MS,
  AUTO_REBAKE_HARD_STOP_MS,
  AUTO_REBAKE_HUNG_BATCH_MS,
  IDLE_RECHECK_MS,
  MAX_EXCLUDED_IDS,
  REFUSED_BILLING_ERROR,
  runAutoRebake,
  type AutoRebakeDeps,
} from "@/lib/cards/auto-rebake";
import { CARD_LAYOUT_VERSION, latestSweepVersion } from "@/lib/cards/layout-version";
import {
  BREAKER_ERROR_RUNS,
  CRASHED_BATCH_ERROR,
  POISON_AFTER_STRIKES,
  POISON_MAX,
} from "@/lib/cards/auto-rebake-state";

const T0 = Date.parse("2026-09-28T12:00:00.000Z");
const ISO0 = new Date(T0).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Batch = {
  processed?: Array<{ id: string; verdict: "rebake" | "stamp" }>;
  failed?: Array<{ id: string; error: string }>;
  superseded?: string[];
  remaining?: number;
};
const ok = (b: Batch) => ({
  ok: true as const,
  scope: { kind: "sweep" as const },
  layoutVersion: CARD_LAYOUT_VERSION,
  billingEnabled: true,
  dry: false,
  plan: { rebake: 0, stamp: 0, optIn: 0 },
  processed: b.processed ?? [],
  failed: b.failed ?? [],
  superseded: b.superseded ?? [],
  remaining: b.remaining ?? 0,
});
const rebaked = (...ns: number[]) => ns.map((n) => ({ id: id(n), verdict: "rebake" as const }));

let t = T0;
let db: ReturnType<typeof sweepDb>;
let pending: number;
let logs: string[];
let revalidate: ReturnType<typeof vi.fn>;
let runBatch: ReturnType<typeof vi.fn>;

function setup(row: Parameters<typeof sweepDb>[0]["row"] = {}, opts: { admins?: string[] } = {}) {
  db = sweepDb({ now: () => t, row, count: () => pending, admins: opts.admins ?? ["admin-1", "admin-2"] });
}

function deps(extra: Partial<AutoRebakeDeps> = {}): AutoRebakeDeps {
  return {
    now: () => t,
    runBatch: runBatch as unknown as AutoRebakeDeps["runBatch"],
    newToken: () => "cron-token",
    revalidate: revalidate as unknown as () => void,
    log: (line) => logs.push(line),
    ...extra,
  };
}

/** Script the batches: each takes `ms` of fake time. */
function script(batches: Batch[], ms = 20_000) {
  let i = 0;
  runBatch.mockImplementation(async () => {
    t += ms;
    const b = batches[Math.min(i, batches.length - 1)];
    i += 1;
    return ok(b);
  });
}

const batchCalls = () => runBatch.mock.calls.map(([, o]) => o as { skipIds: string[]; scope: unknown; billingEnabled: boolean; limit: number });
const countChains = (): ChainCall[][] => db.forTable("cards").map((e) => e.calls);

beforeEach(() => {
  t = T0;
  pending = 5;
  logs = [];
  revalidate = vi.fn();
  runBatch = vi.fn();
  setup();
});

describe("runAutoRebake — refusal and idle paths", () => {
  it("refuses without the billing flag: no lease, no batch, the refusal is recorded", async () => {
    const result = await runAutoRebake(db.client, { billingEnabled: false }, deps());
    expect(result).toEqual({ ok: false, outcome: "refused", error: REFUSED_BILLING_ERROR });
    expect(runBatch).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.countCalls()).toBe(0);
    expect(db.row.last_run).toMatchObject({ stop: "refused", error: REFUSED_BILLING_ERROR });
    expect(logs).toHaveLength(1);
  });

  it("skips while paused — one state read, nothing else", async () => {
    setup({ paused: true, paused_reason: "boom" });
    expect(await runAutoRebake(db.client, { billingEnabled: true }, deps())).toEqual({ ok: true, outcome: "paused" });
    expect(db.log).toHaveLength(1);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
  });

  it("skips while a manual run holds (or has parked) the lease", async () => {
    setup({ lease_holder: "manual", lease_token: null, lease_expires_at: new Date(T0 + 60_000).toISOString() });
    expect(await runAutoRebake(db.client, { billingEnabled: true }, deps())).toEqual({ ok: true, outcome: "manual-run" });
    expect(db.countCalls()).toBe(0);
    expect(runBatch).not.toHaveBeenCalled();
    // An expired lease doesn't block.
    setup({ lease_holder: "manual", lease_token: "x", lease_expires_at: new Date(T0 - 1).toISOString() });
    script([{}]);
    expect((await runAutoRebake(db.client, { billingEnabled: true }, deps())).outcome).toBe("ran");
  });

  it("loses the acquire race to a manual call that took the lease after the state read: bakes nothing", async () => {
    // The state read saw a free lease; the manual route takes it while the
    // cron counts (the count is the last step before the acquire).
    db = sweepDb({
      now: () => t,
      count: () => {
        Object.assign(db.row, {
          lease_holder: "manual",
          lease_token: "manual-token",
          lease_expires_at: new Date(T0 + 300_000).toISOString(),
        });
        return 5;
      },
    });
    script([{ processed: rebaked(1) }]);
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(result).toEqual({ ok: true, outcome: "manual-run" });
    expect(runBatch).not.toHaveBeenCalled();
    expect(db.row).toMatchObject({ lease_holder: "manual", lease_token: "manual-token" });
    expect(db.stateWrites()).toEqual([]);
  });

  it("idle: nothing pending costs a state read, one head count and a timestamp — no lease, no batch", async () => {
    pending = 0;
    setup({ poison: [{ id: id(9), error: "art", failures: 3, at: ISO0 }] });
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(result).toEqual({ ok: true, outcome: "idle", pending: 0 });
    expect(db.log).toHaveLength(3); // read, count, write
    expect(db.rpc).not.toHaveBeenCalled();
    expect(runBatch).not.toHaveBeenCalled();
    expect(db.stateWrites()).toEqual([expect.objectContaining({ last_checked_at: ISO0 })]);

    // The count: published, never baked / unstamped / below the newest sweep version, minus poison.
    const [count] = countChains();
    expect(count.find((c) => c.method === "select")?.args).toEqual(["id", { count: "exact", head: true }]);
    expect(count.find((c) => c.method === "in")?.args).toEqual(["visibility", ["public", "unlisted"]]);
    expect(count.find((c) => c.method === "or")?.args[0]).toBe(
      `rendered_image_url.is.null,layout_version.is.null,layout_version.lt.${latestSweepVersion()}`,
    );
    expect(count.find((c) => c.method === "not")?.args).toEqual(["id", "in", `(${id(9)})`]);
  });

  it("idle finishes a sweep's ISR refresh when the last run ran out of budget at its last card", async () => {
    pending = 0;
    setup({ revalidate_pending: true });
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(db.row.revalidate_pending).toBe(false);
  });

  it("idle fingerprint: the same count a full scan found nothing for skips the scan, for up to 6 h", async () => {
    pending = 4;
    const idle = { layoutVersion: CARD_LAYOUT_VERSION, candidates: 4, at: new Date(T0 - 60_000).toISOString() };
    setup({ idle });
    expect(await runAutoRebake(db.client, { billingEnabled: true }, deps())).toEqual({ ok: true, outcome: "idle", pending: 4 });
    expect(runBatch).not.toHaveBeenCalled();

    // A different count → scan.
    pending = 5;
    setup({ idle });
    script([{}]);
    expect((await runAutoRebake(db.client, { billingEnabled: true }, deps())).outcome).toBe("ran");

    // Too old → scan.
    pending = 4;
    runBatch.mockClear();
    setup({ idle: { ...idle, at: new Date(T0 - IDLE_RECHECK_MS).toISOString() } });
    expect((await runAutoRebake(db.client, { billingEnabled: true }, deps())).outcome).toBe("ran");

    // Another layout version → scan.
    runBatch.mockClear();
    setup({ idle: { ...idle, layoutVersion: CARD_LAYOUT_VERSION - 1 } });
    expect((await runAutoRebake(db.client, { billingEnabled: true }, deps())).outcome).toBe("ran");
    expect(runBatch).toHaveBeenCalled();
  });
});

describe("runAutoRebake — the batch loop", () => {
  it("sweeps until a batch finds nothing, then releases the lease, refreshes ISR once and records the run", async () => {
    script([
      { processed: rebaked(1, 2, 3, 4, 5, 6, 7, 8), remaining: 3 },
      { processed: [...rebaked(9, 10), { id: id(11), verdict: "stamp" }], remaining: 0 },
      {},
    ]);
    pending = 5;
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(result.ok && result.outcome === "ran").toBe(true);
    if (!result.ok || result.outcome !== "ran") return;
    expect(result.summary).toMatchObject({ stop: "done", batches: 3, rebaked: 10, stamped: 1, failed: 0 });
    for (const call of batchCalls()) {
      expect(call).toMatchObject({ scope: { kind: "sweep" }, billingEnabled: true, limit: 8, skipIds: [] });
    }
    expect(db.row).toMatchObject({ lease_holder: null, lease_token: null });
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(db.row.revalidate_pending).toBe(false);
    expect(db.row.last_run).toMatchObject({ stop: "done", rebaked: 10, remaining: 5 });
    // Clean finish → the fingerprint remembers the post-run count.
    expect(db.row.idle).toMatchObject({ layoutVersion: CARD_LAYOUT_VERSION, candidates: 5 });
    expect(logs.at(-1)).toMatch(/^\[auto-rebake\] v\d+ stop=done batches=3 rebaked=10 stamped=1 failed=0/);
  });

  it("stops starting batches once the next one would cross the 240 s budget", async () => {
    script([{ processed: rebaked(1, 2, 3, 4, 5, 6, 7, 8), remaining: 500 }], 20_000);
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    // Batches start at 0, 20 … 200 s; the 30 s floor keeps 220 s + 30 s out.
    expect(result.summary.batches).toBe(11);
    expect(result.summary.stop).toBe("budget");
    expect(t - T0).toBeLessThanOrEqual(AUTO_REBAKE_BUDGET_MS);
    expect(revalidate).not.toHaveBeenCalled();
    expect(db.row.revalidate_pending).toBe(true);
    expect(db.row.idle).toBeNull();
    expect(db.row.lease_token).toBeNull();
  });

  it("projects the longest batch seen: slow batches stop the run earlier", async () => {
    script([{ processed: rebaked(1), remaining: 500 }], 70_000);
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    // Batches start at 0, 70 and 140 s (140 + 70 = 210 ≤ 240); 210 + 70 > 240 stops.
    expect(result.summary.batches).toBe(3);
    expect(t - T0).toBe(210_000);
  });

  it("carries failed cards in skipIds across batches, starting from the poison list", async () => {
    setup({ poison: [{ id: id(99), error: "art", failures: 3, at: ISO0 }] });
    script([
      { processed: rebaked(1), failed: [{ id: id(2), error: "Art unavailable" }], remaining: 4 },
      { processed: rebaked(3), remaining: 1 },
      {},
    ]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    const calls = batchCalls();
    expect(calls[0].skipIds).toEqual([id(99)]);
    expect(calls[1].skipIds).toEqual([id(99), id(2)]);
    expect(calls[2].skipIds).toEqual([id(99), id(2)]);
    // A failure still waiting for its retry: no idle fingerprint.
    expect(db.row.idle).toBeNull();
    expect(db.row.strikes).toMatchObject({ [id(2)]: { n: 1, error: "Art unavailable" } });
  });

  it("a card superseded twice in one run waits for the next run", async () => {
    script([
      { superseded: [id(1)], remaining: 1 },
      { superseded: [id(1)], remaining: 1 },
      {},
    ]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    const calls = batchCalls();
    expect(calls[1].skipIds).toEqual([]);
    expect(calls[2].skipIds).toEqual([id(1)]);
  });

  it("poisons a card on its third failed run; later runs skip it and leave it out of the count", async () => {
    setup({ strikes: { [id(2)]: { n: POISON_AFTER_STRIKES - 1, error: "Art unavailable", at: ISO0 } } });
    script([{ processed: rebaked(1), failed: [{ id: id(2), error: "Art unavailable" }], remaining: 1 }, {}]);
    const first = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!first.ok || first.outcome !== "ran") throw new Error("expected a run");
    expect(first.summary.poisoned).toEqual([id(2)]);
    expect(db.row.poison).toEqual([{ id: id(2), error: "Art unavailable", failures: POISON_AFTER_STRIKES, at: ISO0 }]);
    expect(db.row.strikes).toEqual({});
    expect(db.row.paused).toBe(false); // a known-bad card is not a breaker event

    // Next invocation: the pre-count and the batch both leave it out.
    runBatch.mockClear();
    t = T0 + 600_000;
    pending = 6; // something new arrived, so the fingerprint doesn't short-circuit
    script([{}]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(batchCalls()[0].skipIds).toEqual([id(2)]);
    const lastCount = countChains().at(-1)!;
    expect(lastCount.find((c) => c.method === "not")?.args).toEqual(["id", "in", `(${id(2)})`]);
  });

  it("an admin's Retry during the run survives the run's bookkeeping write", async () => {
    setup({ poison: [{ id: id(50), error: "art", failures: 3, at: ISO0 }] });
    runBatch.mockImplementation(async () => {
      t += 10_000;
      db.row.poison = []; // retryPoisonedCardsAction landed mid-run
      return ok({});
    });
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(db.row.poison).toEqual([]);
  });

  it("a batch error stops the run without pausing it", async () => {
    runBatch.mockResolvedValueOnce({ ok: false, error: "scan failed" });
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary).toMatchObject({ stop: "error", error: "scan failed", batches: 0 });
    expect(db.row.paused).toBe(false);
    expect(db.row.lease_token).toBeNull();
  });
});

describe("runAutoRebake — handing over and stopping", () => {
  it("stops between batches when a manual run asks for the lease, and lets go of it", async () => {
    runBatch.mockImplementation(async () => {
      t += 20_000;
      await db.rpc("request_render_sweep_yield"); // the manual route, mid-batch
      return ok({ processed: rebaked(1), remaining: 50 });
    });
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary).toMatchObject({ stop: "yield", batches: 1 });
    expect(db.row).toMatchObject({ lease_holder: null, lease_token: null });
  });

  it("stops between batches when an admin pauses it — and never un-pauses", async () => {
    runBatch.mockImplementation(async () => {
      t += 20_000;
      db.row.paused = true;
      db.row.paused_reason = "Paused by @dev_admin.";
      return ok({ processed: rebaked(1), remaining: 50 });
    });
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary.stop).toBe("paused");
    expect(db.row.paused).toBe(true);
    expect(db.row.paused_reason).toBe("Paused by @dev_admin.");
    for (const write of db.stateWrites()) expect(write).not.toHaveProperty("paused", false);
  });
});

describe("runAutoRebake — the breaker", () => {
  it("a whole batch of first-time failures pauses the sweep and alerts every admin", async () => {
    const failed = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: id(n), error: "Row update failed: storage quota" }));
    script([{ failed, remaining: 400 }]);
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary.stop).toBe("breaker");
    expect(result.pausedReason).toMatch(/whole batch failed \(8 cards\): Row update failed: storage quota/);
    expect(runBatch).toHaveBeenCalledTimes(1);
    expect(db.row).toMatchObject({ paused: true, paused_at: expect.any(String) });
    expect(db.row.paused_reason).toMatch(/whole batch failed/);
    expect(db.notifications).toEqual([
      { recipient_id: "admin-1", type: "render_sweep_paused", payload: expect.objectContaining({ failed: 8, rebaked: 0 }) },
      { recipient_id: "admin-2", type: "render_sweep_paused", payload: expect.objectContaining({ failed: 8, rebaked: 0 }) },
    ]);
    expect(db.row.lease_token).toBeNull();
    expect(logs.at(-1)).toMatch(/stop=breaker .* paused="A whole batch failed/);
  });

  it("known-bad cards failing again are bookkeeping, not a breaker event", async () => {
    const ids = [1, 2, 3].map(id);
    setup({ strikes: Object.fromEntries(ids.map((i) => [i, { n: 1, error: "art", at: ISO0 }])) });
    script([{ failed: ids.map((i) => ({ id: i, error: "art" })), remaining: 3 }, {}]);
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary.stop).toBe("done");
    expect(db.row.paused).toBe(false);
    expect(db.notifications).toEqual([]);
  });

  it("ten first-time failures spread over a run trip it too", async () => {
    let n = 0;
    runBatch.mockImplementation(async () => {
      t += 5_000;
      n += 1;
      return ok({ processed: rebaked(100 + n), failed: [{ id: id(n), error: "Art unavailable" }], remaining: 100 });
    });
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary).toMatchObject({ stop: "breaker", batches: 10, failed: 10 });
    expect(db.row.paused).toBe(true);
  });

  /** A hard stop on fake time: fires on the next macrotask (after any batch
   *  that resolves at once), moving the clock `ms` forward as it fires. */
  const firesAfter = (ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        t += ms;
        resolve("timeout");
      }, 0);
    });
    return { promise, cancel: () => clearTimeout(timer) };
  };

  it("a hung batch pauses the sweep and keeps the lease until it expires", async () => {
    runBatch.mockImplementation(async (_admin: unknown, o: { onPicked?: (ids: string[]) => Promise<void> }) => {
      await o.onPicked?.([id(1), id(2)]);
      return new Promise(() => {});
    });
    const timeouts: number[] = [];
    const result = await runAutoRebake(
      db.client,
      { billingEnabled: true },
      deps({ timeout: (ms) => (timeouts.push(ms), firesAfter(ms)) }),
    );
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(timeouts).toEqual([AUTO_REBAKE_HARD_STOP_MS]); // the first batch gets the whole 280 s
    expect(result.summary.stop).toBe("hung");
    expect(result.summary.suspects).toEqual([id(1), id(2)]);
    expect(db.row.paused).toBe(true);
    expect(db.row.paused_reason).toMatch(/still running after 280 s — a render may hang/);
    expect(db.row.lease_token).toBe("cron-token");
    expect(db.row.in_flight).toEqual([]);
    expect(db.notifications).toHaveLength(2);
  });

  it("a slow LAST batch that runs into the hard stop is an overrun: lease kept, no pause, no alert", async () => {
    let calls = 0;
    runBatch.mockImplementation(async () => {
      calls += 1;
      if (calls <= 7) {
        t += 30_000; // batches 1–7 take 30 s each (0 → 210 s)
        return ok({ processed: rebaked(calls), remaining: 100 });
      }
      return new Promise(() => {}); // batch 8 starts at 210 s (210 + 30 ≤ 240) and never ends
    });
    // Batch 8's hard stop fires 70 s in — slow, not hung.
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps({ timeout: (ms) => firesAfter(ms) }));
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary).toMatchObject({ stop: "overrun", batches: 7, rebaked: 7 });
    expect(AUTO_REBAKE_HARD_STOP_MS - 210_000).toBeLessThan(AUTO_REBAKE_HUNG_BATCH_MS);
    expect(db.row.paused).toBe(false);
    expect(db.notifications).toEqual([]);
    expect(db.row.lease_token).toBe("cron-token"); // it may still write
  });

  it("does not alert again when it was already paused by the time the run ended", async () => {
    runBatch.mockImplementation(async () => {
      t += 1_000;
      db.row.paused = true;
      return ok({ failed: [1, 2, 3].map((n) => ({ id: id(n), error: "boom" })) });
    });
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(db.notifications).toEqual([]);
  });

  it("the batch it runs is always the watermarked sweep scope", async () => {
    script([{}]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(batchCalls()[0]).toMatchObject({ scope: { kind: "sweep" }, billingEnabled: true, dry: false });
    // The lease RPC ran with the cron holder and a TTL just over maxDuration.
    const acquire = db.rpc.mock.calls.find(([fn]) => fn === "acquire_render_sweep_lease");
    expect(acquire?.[1]).toEqual({ p_holder: "cron", p_token: "cron-token", p_ttl_seconds: 310 });
    expect(called(countChains()[0], "or")).toBe(true);
  });
});

describe("runAutoRebake — a run that died holding the lease", () => {
  // The previous cron run took the lease at T0 - 700 s and was killed (the
  // lease expired at T0 - 390 s): token still set, no summary after it, its
  // batch still recorded as in flight.
  const deadRun = (extra: Parameters<typeof sweepDb>[0]["row"] = {}) => ({
    lease_holder: "cron" as const,
    lease_token: "dead-token",
    lease_acquired_at: new Date(T0 - 700_000).toISOString(),
    lease_expires_at: new Date(T0 - 390_000).toISOString(),
    in_flight: [id(1), id(2)],
    last_run: { stop: "budget", finishedAt: new Date(T0 - 1_300_000).toISOString() },
    ...extra,
  });

  it("strikes the batch it left in flight, records it, and carries on", async () => {
    setup(deadRun());
    script([{ processed: rebaked(3), remaining: 0 }, {}]);
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary.stop).toBe("done"); // this run finished normally
    expect(db.row.strikes).toMatchObject({
      [id(1)]: { n: 1, error: CRASHED_BATCH_ERROR },
      [id(2)]: { n: 1, error: CRASHED_BATCH_ERROR },
    });
    expect(db.row.paused).toBe(false);
    expect(db.notifications).toEqual([]);
    // The crash was recorded before the run (then superseded by its summary).
    const crash = db.stateWrites().find((w) => (w.last_run as { stop?: string } | undefined)?.stop === "crashed");
    expect(crash?.last_run).toMatchObject({ stop: "crashed", crashes: 1, suspects: [id(1), id(2)] });
    expect(crash?.in_flight).toEqual([]);
    expect(logs.some((l) => l.includes("stop=crashed"))).toBe(true);
    expect(logs.join("\n")).not.toContain(id(1)); // no card ids in the log
  });

  it("two dead runs in a row pause the sweep and alert the admins — without baking", async () => {
    setup(
      deadRun({
        last_run: { stop: "crashed", crashes: 1, finishedAt: new Date(T0 - 1_300_000).toISOString() },
        strikes: { [id(1)]: { n: 1, error: CRASHED_BATCH_ERROR, at: ISO0 } },
      }),
    );
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary).toMatchObject({ stop: "crashed", crashes: 2 });
    expect(result.pausedReason).toMatch(/2 automatic runs in a row died before finishing/);
    expect(runBatch).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled(); // no lease taken
    expect(db.row).toMatchObject({ paused: true });
    expect(db.row.strikes).toMatchObject({ [id(1)]: { n: 2 }, [id(2)]: { n: 1 } });
    expect(db.notifications).toHaveLength(2);
  });

  it("a card that kills the renderer three times is poisoned like one that fails", async () => {
    setup(deadRun({ strikes: { [id(1)]: { n: POISON_AFTER_STRIKES - 1, error: CRASHED_BATCH_ERROR, at: ISO0 } } }));
    script([{}]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(db.row.poison).toEqual([expect.objectContaining({ id: id(1), error: CRASHED_BATCH_ERROR })]);
    expect(batchCalls()[0].skipIds).toEqual([id(1)]);
  });

  it("is not fooled by a hung run (summary written after the lease) or a released lease", async () => {
    // Hung: the lease was kept on purpose, but the summary came after it.
    setup(deadRun({ last_run: { stop: "hung", finishedAt: new Date(T0 - 420_000).toISOString() } }));
    script([{}]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(db.row.strikes).toEqual({});
    // Released: no token.
    setup(deadRun({ lease_token: null, lease_holder: null }));
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(db.row.strikes).toEqual({});
    // A manual run that died is the manual route's business, not a cron crash.
    setup(deadRun({ lease_holder: "manual" }));
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(db.row.strikes).toEqual({});
  });

  it("clears a stale in-flight batch (a dead run a manual call took over) when it takes the lease", async () => {
    setup({ in_flight: [id(40), id(41)] }); // no dead cron lease any more: nothing to blame
    let seenAtFirstBatch: unknown = "unset";
    runBatch.mockImplementation(async () => {
      if (seenAtFirstBatch === "unset") seenAtFirstBatch = db.row.in_flight;
      t += 5_000;
      return ok({});
    });
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(seenAtFirstBatch).toEqual([]);
    expect(db.row.strikes).toEqual({});
  });

  it("records the batch it is baking before rendering, and clears it when the run ends", async () => {
    const seen: unknown[] = [];
    runBatch.mockImplementation(async (_admin: unknown, o: { onPicked?: (ids: string[]) => Promise<void> }) => {
      t += 10_000;
      if (seen.length === 0) {
        await o.onPicked?.([id(7), id(8)]);
        seen.push(db.row.in_flight);
        return ok({ processed: rebaked(7, 8), remaining: 0 });
      }
      return ok({});
    });
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(seen).toEqual([[id(7), id(8)]]);
    expect(db.row.in_flight).toEqual([]);
  });
});

describe("runAutoRebake — errors that repeat", () => {
  it(`a batch query failing ${BREAKER_ERROR_RUNS} runs in a row trips the breaker; a blip doesn't`, async () => {
    runBatch.mockResolvedValue({ ok: false, error: 'column cards.frame_preview does not exist' });
    const results = [];
    for (let run = 1; run <= BREAKER_ERROR_RUNS; run += 1) {
      t = T0 + run * 600_000;
      const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
      if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
      results.push(result.summary);
    }
    expect(results.map((s) => s.stop)).toEqual(["error", "error", "breaker"]);
    expect(results.map((s) => s.errorStreak)).toEqual([1, 2, 3]);
    expect(db.row.paused).toBe(true);
    expect(db.row.paused_reason).toMatch(/failed 3 runs in a row: column cards\.frame_preview does not exist/);
    expect(db.notifications).toHaveLength(2);

    // After Resume the streak starts over.
    db.row.paused = false;
    t += 600_000;
    const after = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!after.ok || after.outcome !== "ran") throw new Error("expected a run");
    expect(after.summary).toMatchObject({ stop: "error", errorStreak: 1 });
    expect(db.row.paused).toBe(false);
  });

  it("a successful run in between resets the streak", async () => {
    setup({ last_run: { stop: "error", errorStreak: 2, finishedAt: new Date(T0 - 600_000).toISOString() } });
    script([{}]);
    const result = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!result.ok || result.outcome !== "ran") throw new Error("expected a run");
    expect(result.summary.stop).toBe("done");
    expect(result.summary.errorStreak).toBeUndefined();
  });
});

describe("runAutoRebake — the poison list stays meaningful", () => {
  const entry = (n: number) => ({ id: id(n), error: "Art unavailable", failures: 3, at: ISO0 });

  it("drops entries whose card no longer owes a re-bake (fixed, unpublished, deleted)", async () => {
    db = sweepDb({
      now: () => t,
      row: { poison: [entry(1), entry(2), entry(3)] },
      count: () => pending,
      owed: (card) => card === id(2),
    });
    script([{}]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect((db.row.poison as Array<{ id: string }>).map((p) => p.id)).toEqual([id(2)]);
    // The lookup: those ids, published, still below the newest sweep version.
    const lookup = db.forTable("cards").find((e) => e.calls.some((c) => c.method === "in" && c.args[0] === "id"));
    expect(lookup?.calls.find((c) => c.method === "or")?.args[0]).toBe(
      `rendered_image_url.is.null,layout_version.is.null,layout_version.lt.${latestSweepVersion()}`,
    );
    expect(lookup?.calls.find((c) => c.method === "in" && c.args[0] === "visibility")?.args[1]).toEqual(["public", "unlisted"]);
  });

  it("keeps the list as it is when the lookup fails", async () => {
    setup({ poison: [entry(1)] });
    const from = db.client as unknown as { from: (t: string) => unknown };
    const original = from.from;
    from.from = (table: string) => {
      const builder = original(table) as Record<string, unknown>;
      if (table !== "cards") return builder;
      return new Proxy(builder, {
        get(target, prop) {
          if (prop === "select") {
            return (...args: unknown[]) => {
              if (args.length === 1) {
                // the prune's plain select → an erroring builder
                const failing: Record<string | symbol, unknown> = new Proxy(
                  {},
                  {
                    get(_t, p) {
                      if (p === "then") return (f: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(f);
                      return () => failing;
                    },
                  },
                );
                return failing;
              }
              return (target.select as (...a: unknown[]) => unknown)(...args);
            };
          }
          return target[prop as string];
        },
      });
    };
    script([{}]);
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    expect(db.row.poison).toEqual([entry(1)]);
  });

  it("trips the breaker when a run pushes the list past the cap — once, not after every Resume", async () => {
    const full = Array.from({ length: POISON_MAX }, (_, i) => entry(1000 + i));
    setup({
      poison: full,
      strikes: { [id(1)]: { n: POISON_AFTER_STRIKES - 1, error: "art", at: ISO0 } },
    });
    script([{ processed: rebaked(5), failed: [{ id: id(1), error: "art" }], remaining: 3 }, {}]);
    const first = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!first.ok || first.outcome !== "ran") throw new Error("expected a run");
    expect(first.summary.stop).toBe("breaker");
    expect(first.pausedReason).toMatch(/51 cards keep failing/);
    expect(db.row.paused).toBe(true);

    // Resume: the list is still over the cap, but this run didn't grow it
    // past — the sweep carries on (poisoned cards skipped).
    db.row.paused = false;
    db.row.idle = null;
    runBatch.mockReset();
    script([{ processed: rebaked(6), remaining: 0 }, {}]);
    t += 600_000;
    pending = 7;
    const second = await runAutoRebake(db.client, { billingEnabled: true }, deps());
    if (!second.ok || second.outcome !== "ran") throw new Error("expected a run");
    expect(second.summary.stop).toBe("done");
    expect(db.row.paused).toBe(false);
  });

  it(`leaves at most ${MAX_EXCLUDED_IDS} poisoned ids out of the count by name (the filter rides in the URL)`, async () => {
    pending = 0;
    setup({ poison: Array.from({ length: MAX_EXCLUDED_IDS + 40 }, (_, i) => entry(5000 + i)) });
    await runAutoRebake(db.client, { billingEnabled: true }, deps());
    const not = countChains()[0].find((c) => c.method === "not");
    expect((not?.args[2] as string).split(",")).toHaveLength(MAX_EXCLUDED_IDS);
  });
});
