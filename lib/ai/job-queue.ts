// ---------------------------------------------------------------------------
// Pure helpers for the client-side job runner (components/ai/
// generation-provider.tsx): which steps a run should post, and the honest
// job status for a step list (mirrors patch_job_step, migration 0067).
// ---------------------------------------------------------------------------

export type QueueableStep = { key: string; status: "pending" | "running" | "done" | "failed" };

/**
 * Step keys a runner should post, in order. Pending and (possibly stale)
 * running steps always; failed ones only for an explicit retry — the claim
 * RPC accepts a failed step by key but never picks one up automatically.
 */
export function openStepKeys(steps: QueueableStep[], opts: { includeFailed?: boolean } = {}): string[] {
  return steps
    .filter(
      (s) =>
        s.status === "pending" ||
        s.status === "running" ||
        (opts.includeFailed === true && s.status === "failed"),
    )
    .map((s) => s.key);
}

export type JobStatusOf = "generating" | "done" | "done_with_errors" | "failed";

export function jobStatusOf(steps: QueueableStep[]): JobStatusOf {
  if (steps.some((s) => s.status === "pending" || s.status === "running")) return "generating";
  if (!steps.some((s) => s.status === "failed")) return "done";
  return steps.some((s) => s.status === "done") ? "done_with_errors" : "failed";
}
