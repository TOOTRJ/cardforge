import { describe, expect, it, vi } from "vitest";
import { sweepDb } from "@/tests/stubs/sweep-db";
import {
  acquireManualLease,
  acquireSweepLease,
  leaseBusyMessage,
  MANUAL_PARK_SECONDS,
  releaseSweepLease,
  requestCronYield,
  SWEEP_LEASE_TTL_SECONDS,
} from "@/lib/cards/sweep-lease";

// ---------------------------------------------------------------------------
// The ONE sweep lease shared by the automatic re-bake cron and the manual
// drivers (lib/cards/sweep-lease.ts over migration 0123's RPCs): two
// concurrent holders → exactly one wins; the lease expires on its own just
// after maxDuration; a manual run's PARKED lease keeps the cron out while the
// next manual call takes it straight back; a manual call waits for the cron
// to hand over and gives up with a clear 503 message.
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-09-28T12:00:00.000Z");

function clock() {
  let t = T0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("acquireSweepLease", () => {
  it("two concurrent holders → exactly one wins, the other learns who holds it", async () => {
    const c = clock();
    const db = sweepDb({ now: c.now });
    const [cron, manual] = await Promise.all([
      acquireSweepLease(db.client, "cron", "tok-cron"),
      acquireSweepLease(db.client, "manual", "tok-manual"),
    ]);
    expect([cron.acquired, manual.acquired].filter(Boolean)).toHaveLength(1);
    const loser = cron.acquired ? manual : cron;
    const winner = cron.acquired ? "cron" : "manual";
    expect(loser.holder).toBe(winner);
    expect(db.row.lease_holder).toBe(winner);

    // Two crons at once (an overlapping schedule) — still one.
    const db2 = sweepDb({ now: c.now });
    const results = await Promise.all(
      ["a", "b", "c"].map((t) => acquireSweepLease(db2.client, "cron", `tok-${t}`)),
    );
    expect(results.filter((r) => r.acquired)).toHaveLength(1);
  });

  it("expires just after maxDuration: another holder wins once the TTL has passed", async () => {
    const c = clock();
    const db = sweepDb({ now: c.now });
    expect((await acquireSweepLease(db.client, "cron", "tok-1")).acquired).toBe(true);
    expect(db.row.lease_expires_at).toBe(new Date(T0 + SWEEP_LEASE_TTL_SECONDS * 1000).toISOString());
    expect(SWEEP_LEASE_TTL_SECONDS).toBeGreaterThan(300); // the routes' maxDuration
    c.advance(300_000);
    expect((await acquireSweepLease(db.client, "manual", "tok-2")).acquired).toBe(false);
    c.advance((SWEEP_LEASE_TTL_SECONDS - 300) * 1000);
    expect((await acquireSweepLease(db.client, "manual", "tok-2")).acquired).toBe(true);
    expect(db.row.lease_holder).toBe("manual");
  });

  it("the same token renews its own lease", async () => {
    const c = clock();
    const db = sweepDb({ now: c.now });
    await acquireSweepLease(db.client, "cron", "tok-1");
    c.advance(60_000);
    expect((await acquireSweepLease(db.client, "cron", "tok-1")).acquired).toBe(true);
    expect(db.row.lease_expires_at).toBe(new Date(T0 + 60_000 + SWEEP_LEASE_TTL_SECONDS * 1000).toISOString());
  });

  it("surfaces an RPC error instead of pretending the lease is free", async () => {
    const db = sweepDb({ now: () => T0 });
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "function does not exist" } });
    await expect(acquireSweepLease(db.client, "cron", "tok")).rejects.toThrow(/function does not exist/);
  });
});

describe("releaseSweepLease", () => {
  it("only the holder's token releases", async () => {
    const db = sweepDb({ now: () => T0 });
    await acquireSweepLease(db.client, "cron", "tok-1");
    expect(await releaseSweepLease(db.client, "someone-else")).toBe(false);
    expect(db.row.lease_token).toBe("tok-1");
    expect(await releaseSweepLease(db.client, "tok-1")).toBe(true);
    expect(db.row).toMatchObject({ lease_holder: null, lease_token: null, lease_expires_at: null });
  });

  it("a parked manual lease keeps the cron out, lets the next manual call in, and lapses", async () => {
    const c = clock();
    const db = sweepDb({ now: c.now });
    await acquireSweepLease(db.client, "manual", "call-1");
    expect(await releaseSweepLease(db.client, "call-1", { parkSeconds: MANUAL_PARK_SECONDS })).toBe(true);
    expect(db.row).toMatchObject({ lease_holder: "manual", lease_token: null });

    expect((await acquireSweepLease(db.client, "cron", "cron-1")).acquired).toBe(false);
    expect((await acquireSweepLease(db.client, "manual", "call-2")).acquired).toBe(true);
    await releaseSweepLease(db.client, "call-2", { parkSeconds: MANUAL_PARK_SECONDS });

    c.advance(MANUAL_PARK_SECONDS * 1000);
    expect((await acquireSweepLease(db.client, "cron", "cron-2")).acquired).toBe(true);
  });

  it("a manual call mid-batch (token held) blocks another manual call", async () => {
    const db = sweepDb({ now: () => T0 });
    await acquireSweepLease(db.client, "manual", "call-1");
    expect((await acquireSweepLease(db.client, "manual", "call-2")).acquired).toBe(false);
  });
});

describe("requestCronYield", () => {
  it("stamps the request only while the cron holds a live lease", async () => {
    const db = sweepDb({ now: () => T0 });
    expect(await requestCronYield(db.client)).toBe(false);
    await acquireSweepLease(db.client, "manual", "m");
    expect(await requestCronYield(db.client)).toBe(false);
    await releaseSweepLease(db.client, "m");
    await acquireSweepLease(db.client, "cron", "c");
    expect(await requestCronYield(db.client)).toBe(true);
    expect(db.row.yield_requested_at).toBe(new Date(T0).toISOString());
  });
});

describe("acquireManualLease", () => {
  it("asks a running cron to yield and takes the lease once it lets go", async () => {
    const c = clock();
    const db = sweepDb({ now: c.now });
    await acquireSweepLease(db.client, "cron", "cron-tok");
    let polls = 0;
    // The "cron" finishes its batch on the third poll, sees the request and releases.
    const sleep = vi.fn(async (ms: number) => {
      c.advance(ms);
      polls += 1;
      if (polls === 3 && db.row.yield_requested_at) await releaseSweepLease(db.client, "cron-tok");
    });
    const lease = await acquireManualLease(db.client, "manual-tok", { sleep, now: c.now, pollMs: 2_000, waitMs: 120_000 });
    expect(lease).toEqual({ ok: true, token: "manual-tok", waitedMs: 6_000 });
    expect(db.rpc.mock.calls.filter(([fn]) => fn === "request_render_sweep_yield").length).toBeGreaterThanOrEqual(1);
    expect(db.row).toMatchObject({ lease_holder: "manual", lease_token: "manual-tok", yield_requested_at: null });
  });

  it("gives up after the wait budget with the holder, for a clear 503", async () => {
    const c = clock();
    const db = sweepDb({ now: c.now });
    await acquireSweepLease(db.client, "cron", "cron-tok");
    const sleep = async (ms: number) => {
      c.advance(ms);
    };
    const lease = await acquireManualLease(db.client, "manual-tok", { sleep, now: c.now, pollMs: 2_000, waitMs: 10_000 });
    expect(lease.ok).toBe(false);
    if (lease.ok) return;
    expect(lease.holder).toBe("cron");
    expect(lease.waitedMs).toBeLessThanOrEqual(10_000);
    expect(db.row.lease_token).toBe("cron-tok");
    expect(leaseBusyMessage(lease)).toMatch(/automatic re-bake is mid-batch.*Nothing was baked — try again in a minute/);
    expect(leaseBusyMessage({ ...lease, holder: "manual" })).toMatch(/Another re-bake call is running/);
  });

  it("takes a free lease at once, without asking anyone to yield", async () => {
    const db = sweepDb({ now: () => T0 });
    const sleep = vi.fn();
    const lease = await acquireManualLease(db.client, "manual-tok", { sleep, now: () => T0 });
    expect(lease.ok).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(([fn]) => fn)).toEqual(["acquire_render_sweep_lease"]);
  });
});
