"use client";

import { Check, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import type {
  GenerationJobPhase,
  GenerationJobStep,
} from "@/components/ai/use-generation-job";

/** Live step list for an AI batch-generation job, with per-step retry for
 *  anything that failed (usually an image that didn't generate). */
export function GenerationProgress({
  steps,
  phase,
  onRetryStep,
}: {
  steps: GenerationJobStep[];
  phase: GenerationJobPhase;
  /** When provided, failed rows render a Retry affordance. */
  onRetryStep?: (stepKey: string) => void;
}) {
  if (steps.length === 0) return null;
  const activeKeys = new Set(
    phase === "stepping"
      ? steps
          .filter((step) => step.status === "running")
          .map((step) => step.key)
          .concat(steps.find((step) => step.status === "pending")?.key ?? [])
      : [],
  );
  const canRetry = Boolean(onRetryStep) && phase === "done";

  return (
    <ul className="flex flex-col gap-1.5 rounded-md border border-border bg-background/40 p-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2 text-sm text-muted">
          {step.status === "done" ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-primary-bright" aria-hidden />
          ) : step.status === "failed" ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
          ) : activeKeys.has(step.key) ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden />
          ) : (
            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />
          )}
          <span
            className={`truncate ${step.status === "done" ? "text-foreground" : ""}`}
          >
            {step.label}
          </span>
          {step.status === "failed" ? (
            <span className="min-w-0 flex-1 truncate text-xs text-danger" title={step.error}>
              {step.error}
            </span>
          ) : null}
          {step.status === "failed" && canRetry ? (
            <button
              type="button"
              onClick={() => onRetryStep?.(step.key)}
              className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:border-border-strong"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              Retry
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
