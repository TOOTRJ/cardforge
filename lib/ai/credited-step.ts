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
 * (spend_ref); patch_job_step then settles that ledger row in the same
 * transaction as the done-write (migration 0106), which is what keeps the
 * cron's hands off it.
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
    return {
      ...step,
      status: "failed",
      error: reserve.message,
      // An empty balance is a plan limit the client should stop on; an infra
      // error is a retryable hiccup and carries no code.
      error_code: reserve.reason === "insufficient_credits" ? "INSUFFICIENT_CREDITS" : undefined,
    };
  }
  // Refund ONLY what was actually debited — admin/billing-off reserves are
  // uncharged, and refunding those would MINT credits out of thin air
  // (grant_credits has no matching-spend check).
  // What the user is told comes from what this returns (lib/ai/failure.ts
  // creditOutcome): `refunded` only when the refund really landed; a refund
  // that failed is left to the reconcile sweep (same key, so never twice)
  // and the step says so (`refund_pending`) instead of claiming it.
  const refundIfCharged = async (): Promise<Pick<JobStep, "refunded" | "refund_pending">> => {
    if (!reserve.charged) return { refunded: 0, refund_pending: false };
    const landed = await refundCredits(userId, amount, reason, `refund:${ref}`);
    return landed ? { refunded: amount, refund_pending: false } : { refunded: 0, refund_pending: true };
  };
  let result: JobStep;
  try {
    result = await body();
  } catch (error) {
    const outcome = await refundIfCharged();
    // runNextJobStep turns the throw into a failed step; it reads the
    // outcome off the error so the user hears the truth about the credit.
    // A thrown string / number / null can carry nothing: it is wrapped in
    // an Error first (its text kept as the message, the original as cause).
    const carrier =
      error !== null && typeof error === "object"
        ? error
        : new Error(String(error), { cause: error });
    Object.assign(carrier, outcome);
    throw carrier;
  }
  if (result.status === "failed") {
    return { ...result, spend_ref: null, ...(await refundIfCharged()) };
  }
  // Success: stamp the charging ref (or clear a stale one from a prior
  // attempt when this run was uncharged — admin / billing off), and clear a
  // prior attempt's failure and refund notes.
  return {
    ...result,
    spend_ref: reserve.charged ? ref : null,
    failure: null,
    refunded: null,
    refund_pending: null,
  };
}
