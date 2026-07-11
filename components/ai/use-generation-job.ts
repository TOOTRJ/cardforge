"use client";

import {
  useGenerationContext,
  type GenerationContextValue,
} from "@/components/ai/generation-provider";

// ---------------------------------------------------------------------------
// useGenerationJob — panel-facing hook for the AI batch-job pipeline. The
// actual runner lives in GenerationJobProvider (mounted in the ROOT layout)
// so client-side navigation never interrupts a generation and in-flight
// jobs auto-resume on the next visit. This module keeps the hook's
// historical import path and types.
// ---------------------------------------------------------------------------

export type GenerationJobStep = {
  key: string;
  label: string;
  status: "pending" | "done" | "failed";
  error?: string;
};

export type GenerationJobPhase = "idle" | "planning" | "stepping" | "done";

export type GenerationJobOutcome = {
  ok: boolean;
  successes: number;
  failures: number;
  /** Slug of the created/target set or deck, when the server returned one. */
  slug?: string;
};

export function useGenerationJob(): GenerationContextValue {
  return useGenerationContext();
}
