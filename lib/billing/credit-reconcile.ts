import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Orphaned-spend reconciliation — the safety net under withCreditedStep.
//
// A job step reserves its credit fail-closed BEFORE the image call. If the
// platform kills the function after the charge commits but before the
// refund/patch runs, the credit is gone and the stale-reclaim retry charges
// again (the 0066 incident shape). The in-process wrapper cannot refund a
// charge it didn't live to see fail — this sweep can, because migration 0068
// made every step charge traceable: ledger key "spend:{jobId}:{stepKey}:{uuid}"
// per attempt, and a charged "done" stamps its winning ref onto the step.
//
// Reconciliation rule: an aged spend is LEGITIMATE only if its step is done
// AND carries that exact spend_ref. Everything else — crashed attempt,
// superseded duplicate, failed/cancelled/expired/vanished job — gets a
// refund keyed "refund:{spendRef}". That key is shared with the in-process
// refund path, so grant_credits' idempotency guard guarantees at most ONE
// refund per charge attempt no matter how the two paths race, and re-runs of
// the sweep are free.
// ---------------------------------------------------------------------------

/** Service-role client (ledger scan crosses users; grant_credits is
 *  service-role only). Exported for test stubs to cast to. */
export type ReconcileClient = ReturnType<typeof createAdminClient>;

/** Ignore spends younger than this: a live attempt runs ≤180s and its claim
 *  goes stale at 5 minutes, so 15 minutes cleanly outlives any attempt that
 *  could still refund (or finish) on its own. */
export const RECONCILE_GRACE_MS = 15 * 60_000;

/** How far back one sweep looks. Runs daily (Hobby-plan cron cadence), so
 *  each pass overlaps the previous two — redundant passes are no-ops thanks
 *  to the refund key, and a couple of days of cron outage drops nothing. */
export const RECONCILE_WINDOW_MS = 72 * 60 * 60_000;

/** Per-run row bound (defense against a pathological backlog; the hourly
 *  cadence catches anything a full page leaves behind). */
export const RECONCILE_SCAN_LIMIT = 500;

export type ParsedSpendRef = { jobId: string; stepKey: string };

/** Parse "spend:{jobId}:{stepKey}:{uuid}". The step key itself contains
 *  colons ("card:0"), so the job id is the second segment and the uuid the
 *  last — the step key is everything in between. */
export function parseSpendRef(key: string): ParsedSpendRef | null {
  const parts = key.split(":");
  if (parts.length < 4 || parts[0] !== "spend") return null;
  const jobId = parts[1];
  const stepKey = parts.slice(2, -1).join(":");
  if (!jobId || !stepKey) return null;
  return { jobId, stepKey };
}

export type ReconcileResult =
  | {
      ok: true;
      scanned: number;
      /** Legitimate charges (done step with the matching ref). */
      legitimate: number;
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

type JobSteps = {
  id: string;
  steps: Array<{ key?: string; status?: string; spend_ref?: string | null }>;
};

export async function reconcileOrphanedSpends(
  admin: ReconcileClient,
  now: Date = new Date(),
): Promise<ReconcileResult> {
  const windowStart = new Date(now.getTime() - RECONCILE_WINDOW_MS);
  const graceCutoff = new Date(now.getTime() - RECONCILE_GRACE_MS);

  const { data, error } = await admin
    .from("credit_ledger")
    .select("user_id, delta, idempotency_key")
    .like("idempotency_key", "spend:%")
    .lt("delta", 0)
    .gte("created_at", windowStart.toISOString())
    .lte("created_at", graceCutoff.toISOString())
    .order("created_at", { ascending: true })
    .limit(RECONCILE_SCAN_LIMIT);
  if (error) return { ok: false, error: error.message };

  const spends = (data ?? []) as LedgerSpend[];
  if (spends.length === 0) {
    return { ok: true, scanned: 0, legitimate: 0, refunded: 0, failed: 0 };
  }

  // One job read per distinct job, not per spend.
  const jobIds = [
    ...new Set(
      spends
        .map((spend) => parseSpendRef(spend.idempotency_key)?.jobId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const { data: jobRows, error: jobsError } = await admin
    .from("ai_generation_jobs")
    .select("id, steps")
    .in("id", jobIds);
  if (jobsError) return { ok: false, error: jobsError.message };
  const jobsById = new Map(
    ((jobRows ?? []) as JobSteps[]).map((job) => [job.id, job]),
  );

  let legitimate = 0;
  let refunded = 0;
  let failed = 0;
  for (const spend of spends) {
    const ref = parseSpendRef(spend.idempotency_key);
    if (!ref) {
      failed += 1; // malformed spend: key — leave it for a human, loudly
      console.error(
        `[credits] Unparseable spend ref in ledger: ${spend.idempotency_key}`,
      );
      continue;
    }
    const step = jobsById
      .get(ref.jobId)
      ?.steps?.find((s) => s?.key === ref.stepKey);
    if (
      step?.status === "done" &&
      step.spend_ref === spend.idempotency_key
    ) {
      legitimate += 1;
      continue;
    }

    // Orphan (crashed attempt, superseded duplicate, failed/cancelled step,
    // or the job is gone). The refund key makes this exactly-once per spend
    // even against the in-process refund path.
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

  return { ok: true, scanned: spends.length, legitimate, refunded, failed };
}
