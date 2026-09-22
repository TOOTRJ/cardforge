import { describe, expect, it } from "vitest";

import {
  RECONCILE_GRACE_MS,
  RECONCILE_SCAN_LIMIT,
  reconcileOrphanedSpends,
  type ReconcileClient,
} from "@/lib/billing/credit-reconcile";
import { called, chainClient, type ChainCall } from "@/tests/stubs/supabase-chain";

// ---------------------------------------------------------------------------
// reconcileOrphanedSpends — the safety net for charges orphaned by a platform
// kill. Core contract since migration 0106: an aged spend is legitimate ONLY
// when its ledger row is settled (settled_at stamped by patch_job_step /
// settleSpend); every other spend gets a refund keyed refund:{spendRef}
// (exactly-once vs. the in-process refund path). Job rows are never read.
// ---------------------------------------------------------------------------

const JOB = "11111111-1111-1111-1111-111111111111";
const USER = "00000000-0000-0000-0000-000000000001";
const STAMP = "2026-09-22T06:00:00.000Z";

const ref = (stepKey: string, uuid: string) => `spend:${JOB}:${stepKey}:${uuid}`;

type LedgerRow = {
  user_id: string;
  delta: number;
  idempotency_key: string;
  settled_at: string | null;
};
type GrantCall = {
  p_user_id: string;
  p_amount: number;
  p_reason: string;
  p_idempotency_key: string;
};

const isCountRead = (calls: ChainCall[]) =>
  calls.some(
    (c) => c.method === "select" && (c.args[1] as { head?: boolean } | undefined)?.head === true,
  );

/** A ledger the sweep can scan: the count read answers with the settled
 *  rows, the paged scan hands back the UNSETTLED ones slice by slice
 *  (`.range(from, to)` is inclusive, like PostgREST). */
function stubAdmin(opts: {
  spends: LedgerRow[];
  scanError?: string;
  countError?: string;
  refundError?: (key: string) => string | null;
}) {
  const grants: GrantCall[] = [];
  const stub = chainClient((table, calls) => {
    if (table !== "credit_ledger") {
      throw new Error(`the sweep must not read ${table}`);
    }
    if (isCountRead(calls)) {
      if (opts.countError) return { error: { message: opts.countError } };
      return { count: opts.spends.filter((s) => s.settled_at !== null).length };
    }
    if (opts.scanError) return { error: { message: opts.scanError } };
    const range = calls.find((c) => c.method === "range");
    if (!range) throw new Error("scan must page with .range()");
    const [from, to] = range.args as [number, number];
    return { data: opts.spends.filter((s) => s.settled_at === null).slice(from, to + 1) };
  });
  const admin = {
    from: stub.client.from,
    rpc: async (_fn: string, args: GrantCall) => {
      grants.push(args);
      const message = opts.refundError?.(args.p_idempotency_key) ?? null;
      return { error: message ? { message } : null };
    },
  } as unknown as ReconcileClient;
  return { admin, grants, log: stub.log };
}

describe("reconcileOrphanedSpends", () => {
  it("leaves the settled charge alone and refunds the unsettled twin (the 0066 incident shape)", async () => {
    // Attempt A charged then crashed; the reclaim's attempt B charged and
    // finished the step — patch_job_step settled B. A is orphaned.
    const orphaned = ref("card:0", "attempt-a");
    const winning = ref("card:0", "attempt-b");
    const { admin, grants } = stubAdmin({
      spends: [
        { user_id: USER, delta: -1, idempotency_key: orphaned, settled_at: null },
        { user_id: USER, delta: -1, idempotency_key: winning, settled_at: STAMP },
      ],
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toEqual({ ok: true, scanned: 1, settled: 1, refunded: 1, failed: 0 });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      p_user_id: USER,
      p_amount: 1,
      p_reason: "refund",
      p_idempotency_key: `refund:${orphaned}`,
    });
  });

  it("decides from the ledger alone — settled_at IS NULL to scan, IS NOT NULL to count — and never reads job rows", async () => {
    const { admin, log } = stubAdmin({
      spends: [{ user_id: USER, delta: -1, idempotency_key: ref("card:0", "a"), settled_at: STAMP }],
    });

    await reconcileOrphanedSpends(admin);

    expect(log.every((entry) => entry.table === "credit_ledger")).toBe(true);
    const count = log.find((entry) => isCountRead(entry.calls));
    const scan = log.find((entry) => !isCountRead(entry.calls));
    expect(count && called(count.calls, "not", "settled_at")).toBe(true);
    expect(scan && called(scan.calls, "is", "settled_at")).toBe(true);
    expect(scan && called(scan.calls, "like", "idempotency_key")).toBe(true);
  });

  it("refunds nothing when every aged spend is settled", async () => {
    const { admin, grants } = stubAdmin({
      spends: [
        { user_id: USER, delta: -1, idempotency_key: ref("card:0", "a"), settled_at: STAMP },
        { user_id: USER, delta: -1, idempotency_key: "spend:ideas:b", settled_at: STAMP },
      ],
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toEqual({ ok: true, scanned: 0, settled: 2, refunded: 0, failed: 0 });
    expect(grants).toHaveLength(0);
  });

  it("re-issues the idempotent refund for a failed step (in-process path already keyed it)", async () => {
    // The wrapper refunded this failed attempt under the SAME key — the
    // sweep's grant_credits call dedupes to a no-op in production. What
    // matters here is that the key matches exactly.
    const failedRef = ref("remix:0", "attempt-a");
    const { admin, grants } = stubAdmin({
      spends: [{ user_id: USER, delta: -1, idempotency_key: failedRef, settled_at: null }],
    });

    await reconcileOrphanedSpends(admin);

    expect(grants).toHaveLength(1);
    expect(grants[0]?.p_idempotency_key).toBe(`refund:${failedRef}`);
  });

  it("refunds an unsettled sync-route charge (ideas call killed before settleSpend)", async () => {
    const { admin, grants } = stubAdmin({
      spends: [{ user_id: USER, delta: -1, idempotency_key: "spend:ideas:x", settled_at: null }],
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toMatchObject({ ok: true, refunded: 1 });
    expect(grants[0]?.p_idempotency_key).toBe("refund:spend:ideas:x");
  });

  it("refunds the full charged amount for a multi-credit spend", async () => {
    const { admin, grants } = stubAdmin({
      spends: [{ user_id: USER, delta: -3, idempotency_key: ref("cover", "a"), settled_at: null }],
    });

    await reconcileOrphanedSpends(admin);

    expect(grants[0]?.p_amount).toBe(3);
  });

  it("counts a refund failure and keeps sweeping the rest", async () => {
    const bad = ref("card:0", "bad");
    const good = ref("card:1", "good");
    const { admin, grants } = stubAdmin({
      spends: [
        { user_id: USER, delta: -1, idempotency_key: bad, settled_at: null },
        { user_id: USER, delta: -1, idempotency_key: good, settled_at: null },
      ],
      refundError: (key) => (key === `refund:${bad}` ? "grant exploded" : null),
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toEqual({ ok: true, scanned: 2, settled: 0, refunded: 1, failed: 1 });
    expect(grants).toHaveLength(2);
  });

  it("surfaces a scan failure without attempting refunds", async () => {
    const { admin, grants } = stubAdmin({ spends: [], scanError: "scan failed" });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toEqual({ ok: false, error: "scan failed" });
    expect(grants).toHaveLength(0);
  });

  it("fails closed when settled_at is unknown (code deployed ahead of migration 0106)", async () => {
    // PostgREST rejects the count read on a column that doesn't exist yet;
    // the sweep must stop there instead of refunding every charge in sight.
    const { admin, grants } = stubAdmin({
      spends: [{ user_id: USER, delta: -1, idempotency_key: ref("card:0", "a"), settled_at: null }],
      countError: 'column credit_ledger.settled_at does not exist',
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toEqual({ ok: false, error: "column credit_ledger.settled_at does not exist" });
    expect(grants).toHaveLength(0);
  });

  it("exposes a grace window that outlives any live attempt", () => {
    // 180s function budget + 5-minute stale claim < grace.
    expect(RECONCILE_GRACE_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});

describe("reconcileOrphanedSpends paging", () => {
  it("REGRESSION: walks past the first page instead of silently skipping the rest", async () => {
    // 1,203 orphaned spends → every one must be refunded, in three pages.
    const spends = Array.from({ length: 1203 }, (_, i) => ({
      user_id: "u1",
      delta: -1,
      idempotency_key: `spend:job-${i}:card:0:attempt-${i}`,
      settled_at: null,
    }));
    const { admin, grants, log } = stubAdmin({ spends });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toMatchObject({ ok: true, scanned: 1203, refunded: 1203, settled: 0, failed: 0 });
    expect(grants).toHaveLength(1203);
    const pages = log.filter((entry) => !isCountRead(entry.calls));
    expect(pages).toHaveLength(Math.ceil(1203 / RECONCILE_SCAN_LIMIT));
  });
});
