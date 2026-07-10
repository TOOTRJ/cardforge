"use client";

import { useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// useGenerationJob — client driver for the AI batch-job pipeline
// (/api/ai/jobs). Plans the job, then advances one step per request until
// nothing is pending, exposing live step state for progress UIs. Shared by
// the set generator and the deck generator/remixer panels.
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

export function useGenerationJob() {
  const [phase, setPhase] = useState<GenerationJobPhase>("idle");
  const [steps, setSteps] = useState<GenerationJobStep[]>([]);
  const busy = phase === "planning" || phase === "stepping";

  const run = async (
    body: Record<string, unknown>,
  ): Promise<GenerationJobOutcome> => {
    setPhase("planning");
    setSteps([]);
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
      const slug: string | undefined =
        planPayload.setSlug || planPayload.deckSlug || undefined;
      setSteps(job.steps);
      setPhase("stepping");

      // One step per request; a failed step is recorded and skipped so the
      // rest of the batch still lands.
      while (
        job.status === "generating" &&
        job.steps.some((step) => step.status === "pending")
      ) {
        const stepResponse = await fetch(`/api/ai/jobs/${job.id}/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const stepPayload = await stepResponse.json().catch(() => null);
        if (!stepResponse.ok || !stepPayload?.ok) {
          toast.error(stepPayload?.error ?? "Generation step failed.");
          break;
        }
        job = stepPayload.job;
        setSteps(job.steps);
      }

      const failures = job.steps.filter((s) => s.status === "failed").length;
      const successes = job.steps.filter((s) => s.status === "done").length;
      setPhase("done");
      return { ok: successes > 0, successes, failures, slug };
    } catch {
      toast.error("Network error during generation.");
      setPhase("idle");
      return { ok: false, successes: 0, failures: 0 };
    }
  };

  return { phase, steps, busy, run };
}
