import { refundCredits, spendCredits } from "@/lib/ai/rate-limit";
import type { JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// The credit envelope around one job step. Lives apart from
// lib/ai/generation-jobs.ts (which pulls in every generator) so the
// reserve → run → refund/stamp contract can be unit-tested with the ledger
// helpers mocked.
// ---------------------------------------------------------------------------

/**
 * Reserve `amount` credits fail-closed, run the step body, and guarantee the
 * charge never survives a failure: a failed result or a throw refunds before
 * returning/rethrowing. Every credited step type goes through here so "any
 * failed step returns its credit" holds uniformly (cards, remixes, covers,
 * icons). A retried step reserves again — the charge always belongs to the
 * attempt that succeeded.
 *
 * Every charge attempt carries a unique ledger ref (spend:{job}:{step}:{uuid})
 * and refunds under `refund:{that ref}`, so a charge orphaned by a platform
 * kill mid-body — the one failure this wrapper CANNOT refund — is picked up
 * by the reconcile-credits cron, and the two refund paths can never both
 * land for one spend. A charged success stamps the ref onto the step
 * (spend_ref) as the cron's proof the charge earned its keep.
 */
export async function withCreditedStep(
  userId: string,
  jobId: string,
  amount: number,
  reason: string,
  step: JobStep,
  body: () => Promise<JobStep>,
): Promise<JobStep> {
  const ref = `spend:${jobId}:${step.key}:${crypto.randomUUID()}`;
  const reserve = await spendCredits(amount, reason, {
    failClosed: true,
    ref,
  });
  if (!reserve.ok) {
    return { ...step, status: "failed", error: reserve.message };
  }
  // Refund ONLY what was actually debited — admin/billing-off reserves are
  // uncharged, and refunding those would MINT credits out of thin air
  // (grant_credits has no matching-spend check).
  const refundIfCharged = async () => {
    if (reserve.charged) {
      await refundCredits(userId, amount, reason, `refund:${ref}`);
    }
  };
  let result: JobStep;
  try {
    result = await body();
  } catch (error) {
    await refundIfCharged();
    throw error;
  }
  if (result.status === "failed") {
    await refundIfCharged();
    return { ...result, spend_ref: null };
  }
  // Success: stamp the charging ref (or clear a stale one from a prior
  // attempt when this run was uncharged — admin / billing off).
  return { ...result, spend_ref: reserve.charged ? ref : null };
}
