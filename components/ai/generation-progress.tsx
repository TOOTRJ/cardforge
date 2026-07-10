"use client";

import { Check, Loader2, TriangleAlert } from "lucide-react";
import type {
  GenerationJobPhase,
  GenerationJobStep,
} from "@/components/ai/use-generation-job";

/** Live step list for an AI batch-generation job. */
export function GenerationProgress({
  steps,
  phase,
}: {
  steps: GenerationJobStep[];
  phase: GenerationJobPhase;
}) {
  if (steps.length === 0) return null;
  const activeKey =
    phase === "stepping"
      ? steps.find((step) => step.status === "pending")?.key
      : undefined;

  return (
    <ul className="flex flex-col gap-1.5 rounded-md border border-border bg-background/40 p-3">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2 text-sm text-muted">
          {step.status === "done" ? (
            <Check className="h-3.5 w-3.5 text-primary-bright" aria-hidden />
          ) : step.status === "failed" ? (
            <TriangleAlert className="h-3.5 w-3.5 text-danger" aria-hidden />
          ) : step.key === activeKey ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
          ) : (
            <span className="h-3.5 w-3.5 rounded-full border border-border" />
          )}
          <span className={step.status === "done" ? "text-foreground" : undefined}>
            {step.label}
          </span>
          {step.status === "failed" && step.error ? (
            <span className="truncate text-xs text-danger">{step.error}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
