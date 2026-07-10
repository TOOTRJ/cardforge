"use client";

import { useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// useGenerationJob — client driver for the AI batch-job pipeline
// (/api/ai/jobs). Plans the job, then advances one step per request until
// nothing is pending, exposing live step state for progress UIs. Failed
// steps (usually an image that didn't generate) can be retried per-step or
// all at once — the server re-runs only what failed. Shared by the set
// generator and the deck generator/remixer panels.
// ---------------------------------------------------------------------------

export type GenerationJobStep = {
  key: string;
  label: string;
  status: "pending" | "done" | "failed";
  error?: string;
};

type JobPayload = {
  id: string;
  status: "generating" | "done" | "failed" | "cancelled";
  steps: GenerationJobStep[];
};

export type GenerationJobPhase = "idle" | "planning" | "stepping" | "done";

export type GenerationJobOutcome = {
  ok: boolean;
  successes: number;
  failures: number;
  /** Slug of the created/target set or deck, when the server returned one. */
  slug?: string;
};

async function postStep(
  jobId: string,
  stepKey?: string,
): Promise<{ job: JobPayload } | { error: string }> {
  try {
    const response = await fetch(`/api/ai/jobs/${jobId}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stepKey ? { step: stepKey } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      return { error: payload?.error ?? "Generation step failed." };
    }
    return { job: payload.job as JobPayload };
  } catch {
    return { error: "Network error during generation." };
  }
}

function outcomeOf(steps: GenerationJobStep[], slug?: string): GenerationJobOutcome {
  const failures = steps.filter((s) => s.status === "failed").length;
  const successes = steps.filter((s) => s.status === "done").length;
  return { ok: successes > 0, successes, failures, slug };
}

export function useGenerationJob() {
  const [phase, setPhase] = useState<GenerationJobPhase>("idle");
  const [steps, setSteps] = useState<GenerationJobStep[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const busy = phase === "planning" || phase === "stepping";
  const hasFailures = steps.some((step) => step.status === "failed");

  const run = async (
    body: Record<string, unknown>,
  ): Promise<GenerationJobOutcome> => {
    setPhase("planning");
    setSteps([]);
    setJobId(null);
    try {
      const planResponse = await fetch("/api/ai/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const planPayload = await planResponse.json().catch(() => null);
      if (!planResponse.ok || !planPayload?.ok) {
        toast.error(planPayload?.error ?? "AI planning failed. Try again.");
        setPhase("idle");
        return { ok: false, successes: 0, failures: 0 };
      }

      let job: JobPayload = planPayload.job;
      const targetSlug: string | undefined =
        planPayload.setSlug || planPayload.deckSlug || undefined;
      setJobId(job.id);
      setSlug(targetSlug);
      setSteps(job.steps);
      setPhase("stepping");

      // One step per request; a failed step is recorded and skipped so the
      // rest of the batch still lands. A transport error pauses the loop —
      // everything left shows as retryable.
      let transportFailures = 0;
      while (
        job.status === "generating" &&
        job.steps.some((step) => step.status === "pending")
      ) {
        const result = await postStep(job.id);
        if ("error" in result) {
          transportFailures += 1;
          if (transportFailures >= 2) {
            toast.error(
              `${result.error} Generation paused — use Retry to continue where it left off.`,
            );
            break;
          }
          continue; // one silent retry for a transient blip
        }
        transportFailures = 0;
        job = result.job;
        setSteps(job.steps);
      }

      setPhase("done");
      return outcomeOf(job.steps, targetSlug);
    } catch {
      toast.error("Network error during generation.");
      setPhase("idle");
      return { ok: false, successes: 0, failures: 0 };
    }
  };

  /** Re-run one failed step (or a pending one left behind by a pause). */
  const retryStep = async (stepKey: string): Promise<GenerationJobOutcome> => {
    if (!jobId) return outcomeOf(steps, slug);
    setPhase("stepping");
    const result = await postStep(jobId, stepKey);
    if ("error" in result) {
      toast.error(result.error);
      setPhase("done");
      return outcomeOf(steps, slug);
    }
    setSteps(result.job.steps);
    setPhase("done");
    return outcomeOf(result.job.steps, slug);
  };

  /** Re-run every failed step, then finish any steps still pending. */
  const retryFailed = async (): Promise<GenerationJobOutcome> => {
    if (!jobId) return outcomeOf(steps, slug);
    setPhase("stepping");
    let current = steps;
    for (const step of steps.filter((s) => s.status === "failed")) {
      const result = await postStep(jobId, step.key);
      if ("error" in result) {
        toast.error(result.error);
        setPhase("done");
        return outcomeOf(current, slug);
      }
      current = result.job.steps;
      setSteps(current);
    }
    while (current.some((s) => s.status === "pending")) {
      const result = await postStep(jobId);
      if ("error" in result) {
        toast.error(result.error);
        break;
      }
      current = result.job.steps;
      setSteps(current);
    }
    setPhase("done");
    return outcomeOf(current, slug);
  };

  return { phase, steps, busy, hasFailures, run, retryStep, retryFailed };
}
