import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Orphaned-spend reconciliation — the safety net under withCreditedStep and
// the credited sync routes.
//
// A charge is reserved fail-closed BEFORE the AI call. If the platform kills
// the function after the charge commits but before the refund runs, the
// credit is gone and a stale-reclaim retry charges again (the 0066 incident
// shape). The in-process wrapper cannot refund a charge it didn't live to
// see fail — this sweep can, because every charge attempt carries a unique
// ledger ref ("spend:{jobId}:{stepKey}:{uuid}", or "spend:ideas:{uuid}" for
// the sync routes; migration 0068) and, since migration 0106, the ledger
// row itself records the verdict: `settled_at` is stamped by settle_spend()
// once the charge's work is durably recorded — by patch_job_step in the
// same transaction as the step's `done` write, or by settleSpend() in a
// sync route right after its work succeeds.
//
// Reconciliation rule: an aged spend is LEGITIMATE iff it is settled.
// Everything else — crashed attempt, superseded duplicate, failed step,
// unrecorded sync call — gets a refund keyed "refund:{spendRef}". That key
// is shared with the in-process refund path, so grant_credits' idempotency
// guard guarantees at most ONE refund per charge attempt no matter how the
// two paths race, and re-runs of the sweep are free. The sweep never reads
// job rows.
// ---------------------------------------------------------------------------

/** Service-role client (ledger scan crosses users; grant_credits is
 *  service-role only). Exported for test stubs to cast to. */
export type ReconcileClient = ReturnType<typeof createAdminClient>;

/** Ignore spends younger than this: a live attempt runs ≤180s and its claim
 *  goes stale at 5 minutes, so 15 minutes cleanly outlives any attempt that
 *  could still settle (or refund) on its own. */
export const RECONCILE_GRACE_MS = 15 * 60_000;

/** How far back one sweep looks. Runs daily (Hobby-plan cron cadence), so
 *  each pass overlaps the previous two — redundant passes are no-ops thanks
 *  to the refund key, and a couple of days of cron outage drops nothing. */
const RECONCILE_WINDOW_MS = 72 * 60 * 60_000;

/** Per-run row bound (defense against a pathological backlog). With the
 *  DAILY cadence a backlog beyond this drains at 500/day, so it must stay
 *  inside RECONCILE_WINDOW_MS — raise the limit (or the window) while a
 *  large incident is being reconciled. */
export const RECONCILE_SCAN_LIMIT = 500;
/** Pages of RECONCILE_SCAN_LIMIT per run — 20 × 500 = 10,000 spends, far above any day so far. */
const RECONCILE_MAX_PAGES = 20;

export type ReconcileResult =
  | {
      ok: true;
      /** Aged, unsettled spends examined (each one is refunded or fails). */
      scanned: number;
      /** Settled spends in the same window — the health signal that the
       *  executors are still stamping. A run that settles nothing while
       *  refunding plenty means settlement broke, not that users crashed. */
      settled: number;
      /** Refunds issued — includes idempotent no-ops for spends the
       *  in-process path already refunded (indistinguishable by design). */
      refunded: number;
      failed: number;
    }
  | { ok: false; error: string };

type LedgerSpend = {
  user_id: string;
  delta: number;
  idempotency_key: string;
};

export async function reconcileOrphanedSpends(
  admin: ReconcileClient,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const windowStart = new Date(now.getTime() - RECONCILE_WINDOW_MS);
  const graceCutoff = new Date(now.getTime() - RECONCILE_GRACE_MS);

  // Both reads happen before any refund: on a database that doesn't know
  // settled_at yet (code deployed ahead of migration 0106) they fail and the
  // sweep refunds nothing, instead of treating every charge as orphaned.
  const { count: settledCount, error: countError } = await admin
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .like("idempotency_key", "spend:%")
    .lt("delta", 0)
    .not("settled_at", "is", null)
    .gte("created_at", windowStart.toISOString())
    .lte("created_at", graceCutoff.toISOString());
  if (countError) return { ok: false, error: countError.message };

  // Page through the whole window. A single .limit(500) meant a busy day
  // reconciled only its oldest 500 spends and silently skipped the rest —
  // and the window is a sliding one, so skipped spends could age out
  // unreconciled. The page cap is a runaway guard, not a budget.
  const spends: LedgerSpend[] = [];
  for (let page = 0; page < RECONCILE_MAX_PAGES; page += 1) {
    const from = page * RECONCILE_SCAN_LIMIT;
    const { data, error } = await admin
      .from("credit_ledger")
      .select("user_id, delta, idempotency_key")
      .like("idempotency_key", "spend:%")
      .lt("delta", 0)
      .is("settled_at", null)
      .gte("created_at", windowStart.toISOString())
      .lte("created_at", graceCutoff.toISOString())
      .order("created_at", { ascending: true })
      .range(from, from + RECONCILE_SCAN_LIMIT - 1);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as LedgerSpend[];
    spends.push(...rows);
    if (rows.length < RECONCILE_SCAN_LIMIT) break;
  }

  let refunded = 0;
  let failed = 0;
  for (const spend of spends) {
    // Orphan (crashed attempt, superseded duplicate, failed step, unrecorded
    // sync call). The refund key makes this exactly-once per spend even
    // against the in-process refund path.
    const { error: refundError } = await admin.rpc("grant_credits", {
      p_user_id: spend.user_id,
      p_amount: -spend.delta,
      p_reason: "refund",
      p_idempotency_key: `refund:${spend.idempotency_key}`,
    });
    if (refundError) {
      failed += 1;
      console.error(
        `[credits] Reconciliation refund failed for ${spend.idempotency_key}: ${refundError.message}`,
      );
    } else {
      refunded += 1;
    }
  }

  return {
    ok: true,
    scanned: spends.length,
    settled: settledCount ?? 0,
    refunded,
    failed,
  };
}
