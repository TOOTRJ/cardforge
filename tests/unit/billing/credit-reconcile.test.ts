import { describe, expect, it } from "vitest";

import {
  RECONCILE_GRACE_MS,
  parseSpendRef,
  reconcileOrphanedSpends,
  type ReconcileClient,
} from "@/lib/billing/credit-reconcile";

// ---------------------------------------------------------------------------
// reconcileOrphanedSpends — the safety net for charges orphaned by a platform
// kill. Core contract: an aged spend is legitimate ONLY when its step is done
// AND stamped with that exact spend_ref; every other spend gets a refund
// keyed refund:{spendRef} (exactly-once vs. the in-process refund path).
// ---------------------------------------------------------------------------

const JOB = "11111111-1111-1111-1111-111111111111";
const USER = "00000000-0000-0000-0000-000000000001";

const ref = (stepKey: string, uuid: string) => `spend:${JOB}:${stepKey}:${uuid}`;

type LedgerRow = { user_id: string; delta: number; idempotency_key: string };
type JobRow = {
  id: string;
  steps: Array<{ key: string; status: string; spend_ref?: string | null }>;
};
type GrantCall = {
  p_user_id: string;
  p_amount: number;
  p_reason: string;
  p_idempotency_key: string;
};

function stubAdmin(opts: {
  spends: LedgerRow[];
  jobs: JobRow[];
  ledgerReadError?: string;
}): { admin: ReconcileClient; grants: GrantCall[] } {
  const grants: GrantCall[] = [];
  const admin = {
    from: (table: string) => ({
      select: () => {
        if (table === "credit_ledger") {
          return {
            like: () => ({
              lt: () => ({
                gte: () => ({
                  lte: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: opts.ledgerReadError ? null : opts.spends,
                        error: opts.ledgerReadError
                          ? { message: opts.ledgerReadError }
                          : null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          in: async (_col: string, ids: string[]) => ({
            data: opts.jobs.filter((job) => ids.includes(job.id)),
            error: null,
          }),
        };
      },
    }),
    rpc: async (_fn: string, args: GrantCall) => {
      grants.push(args);
      return { error: null };
    },
  } as unknown as ReconcileClient;
  return { admin, grants };
}

describe("parseSpendRef", () => {
  it("splits jobId and a colon-bearing step key around the uuid", () => {
    expect(parseSpendRef(`spend:${JOB}:card:12:abc-uuid`)).toEqual({
      jobId: JOB,
      stepKey: "card:12",
    });
  });

  it("handles single-segment step keys (icon, cover)", () => {
    expect(parseSpendRef(`spend:${JOB}:icon:abc-uuid`)).toEqual({
      jobId: JOB,
      stepKey: "icon",
    });
  });

  it("rejects non-spend and malformed keys", () => {
    expect(parseSpendRef(`refund:spend:${JOB}:card:0:x`)).toBeNull();
    expect(parseSpendRef("spend:only-two")).toBeNull();
  });
});

describe("reconcileOrphanedSpends", () => {
  it("leaves the legitimate charge alone and refunds the orphaned twin (the 0066 incident shape)", async () => {
    // Attempt A charged then crashed; the reclaim's attempt B charged and
    // finished the step. B's ref is stamped on the done step — A is orphaned.
    const orphaned = ref("card:0", "attempt-a");
    const winning = ref("card:0", "attempt-b");
    const { admin, grants } = stubAdmin({
      spends: [
        { user_id: USER, delta: -1, idempotency_key: orphaned },
        { user_id: USER, delta: -1, idempotency_key: winning },
      ],
      jobs: [
        {
          id: JOB,
          steps: [{ key: "card:0", status: "done", spend_ref: winning }],
        },
      ],
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toEqual({
      ok: true,
      scanned: 2,
      legitimate: 1,
      refunded: 1,
      failed: 0,
    });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      p_user_id: USER,
      p_amount: 1,
      p_reason: "refund",
      p_idempotency_key: `refund:${orphaned}`,
    });
  });

  it("refunds a spend whose job row is gone entirely", async () => {
    const orphaned = ref("card:0", "attempt-a");
    const { admin, grants } = stubAdmin({
      spends: [{ user_id: USER, delta: -1, idempotency_key: orphaned }],
      jobs: [],
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toMatchObject({ ok: true, refunded: 1, legitimate: 0 });
    expect(grants[0]?.p_idempotency_key).toBe(`refund:${orphaned}`);
  });

  it("re-issues the idempotent refund for a failed step (in-process path already keyed it)", async () => {
    // The wrapper refunded this failed attempt under the SAME key — the
    // sweep's grant_credits call dedupes to a no-op in production. What
    // matters here is that the key matches exactly.
    const failedRef = ref("remix:0", "attempt-a");
    const { admin, grants } = stubAdmin({
      spends: [{ user_id: USER, delta: -1, idempotency_key: failedRef }],
      jobs: [
        {
          id: JOB,
          steps: [{ key: "remix:0", status: "failed", spend_ref: null }],
        },
      ],
    });

    await reconcileOrphanedSpends(admin);

    expect(grants).toHaveLength(1);
    expect(grants[0]?.p_idempotency_key).toBe(`refund:${failedRef}`);
  });

  it("refunds a done step's charge when the stamped ref belongs to a DIFFERENT attempt", async () => {
    // Uncharged admin retry finished the step (spend_ref null) after a real
    // user charge crashed — the charge must still come back.
    const orphaned = ref("cover", "attempt-a");
    const { admin, grants } = stubAdmin({
      spends: [{ user_id: USER, delta: -1, idempotency_key: orphaned }],
      jobs: [
        { id: JOB, steps: [{ key: "cover", status: "done", spend_ref: null }] },
      ],
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toMatchObject({ ok: true, refunded: 1, legitimate: 0 });
    expect(grants[0]?.p_idempotency_key).toBe(`refund:${orphaned}`);
  });

  it("surfaces a ledger read failure without attempting refunds", async () => {
    const { admin, grants } = stubAdmin({
      spends: [],
      jobs: [],
      ledgerReadError: "scan failed",
    });

    const result = await reconcileOrphanedSpends(admin);

    expect(result).toEqual({ ok: false, error: "scan failed" });
    expect(grants).toHaveLength(0);
  });

  it("exposes a grace window that outlives any live attempt", () => {
    // 180s function budget + 5-minute stale claim < grace.
    expect(RECONCILE_GRACE_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });
});
