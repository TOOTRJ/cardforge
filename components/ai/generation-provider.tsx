"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { Check, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import type {
  GenerationJobOutcome,
  GenerationJobPhase,
  GenerationJobStep,
} from "@/components/ai/use-generation-job";

// ---------------------------------------------------------------------------
// GenerationJobProvider — the AI batch-job runner, lifted to the ROOT layout
// so client-side navigation never interrupts a generation. While a job runs,
// a floating status widget tells the user it's safe to browse. Jobs are
// persisted rows (ai_generation_jobs), so even a closed tab only PAUSES a
// job: on the next app visit the provider finds it and picks up where it
// left off (steps already done are never redone).
//
// Panels talk to this through useGenerationJob() (components/ai/
// use-generation-job.ts) — same API the panels always had.
// ---------------------------------------------------------------------------

type JobPayload = {
  id: string;
  kind: "set" | "deck" | "deck_remix";
  status: "generating" | "done" | "failed" | "cancelled";
  steps: GenerationJobStep[];
  request?: Record<string, unknown>;
};

export type GenerationContextValue = {
  phase: GenerationJobPhase;
  steps: GenerationJobStep[];
  busy: boolean;
  hasFailures: boolean;
  run: (body: Record<string, unknown>) => Promise<GenerationJobOutcome>;
  retryStep: (stepKey: string) => Promise<GenerationJobOutcome>;
  retryFailed: () => Promise<GenerationJobOutcome>;
};

const GenerationContext = createContext<GenerationContextValue | null>(null);

export function useGenerationContext(): GenerationContextValue {
  const value = useContext(GenerationContext);
  if (!value) {
    throw new Error("useGenerationJob must be used inside GenerationJobProvider.");
  }
  return value;
}

const KIND_LABELS: Record<JobPayload["kind"], string> = {
  set: "Generating set",
  deck: "Generating deck cards",
  deck_remix: "Remixing deck",
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

function outcomeOf(
  steps: GenerationJobStep[],
  slug?: string,
): GenerationJobOutcome {
  const failures = steps.filter((s) => s.status === "failed").length;
  const successes = steps.filter((s) => s.status === "done").length;
  return { ok: successes > 0, successes, failures, slug };
}

function slugOf(job: JobPayload): string | undefined {
  const request = job.request ?? {};
  const value = request["deck_slug"] ?? request["set_slug"];
  return typeof value === "string" && value ? value : undefined;
}

function targetHref(job: JobPayload, slug?: string): string | undefined {
  if (!slug) return undefined;
  return job.kind === "set" ? `/set/${slug}/edit` : `/deck/${slug}/edit`;
}

export function GenerationJobProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [phase, setPhase] = useState<GenerationJobPhase>("idle");
  const [steps, setSteps] = useState<GenerationJobStep[]>([]);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const [widgetDismissed, setWidgetDismissed] = useState(false);
  // Jobs adopted by auto-resume have no panel awaiting a promise — the
  // provider owns their completion toast.
  const resumedRef = useRef(false);
  const runningRef = useRef(false);

  const busy = phase === "planning" || phase === "stepping";
  const hasFailures = steps.some((step) => step.status === "failed");

  const stepUntilDone = useCallback(
    async (startJob: JobPayload): Promise<JobPayload> => {
      let current = startJob;
      let transportFailures = 0;
      while (
        current.status === "generating" &&
        current.steps.some((step) => step.status === "pending")
      ) {
        const result = await postStep(current.id);
        if ("error" in result) {
          transportFailures += 1;
          if (transportFailures >= 2) {
            toast.error(
              `${result.error} Generation paused — it resumes automatically next time you open the app, or use Retry.`,
            );
            break;
          }
          continue; // one silent retry for a transient blip
        }
        transportFailures = 0;
        current = { ...current, ...result.job };
        setJob(current);
        setSteps(current.steps);
      }
      return current;
    },
    [],
  );

  const run = useCallback(
    async (body: Record<string, unknown>): Promise<GenerationJobOutcome> => {
      if (runningRef.current) {
        toast.error("Another generation is already running — let it finish first.");
        return { ok: false, successes: 0, failures: 0 };
      }
      runningRef.current = true;
      resumedRef.current = false;
      setWidgetDismissed(false);
      setPhase("planning");
      setSteps([]);
      setJob(null);
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
        const startJob: JobPayload = planPayload.job;
        const targetSlug: string | undefined =
          planPayload.setSlug || planPayload.deckSlug || slugOf(startJob);
        setJob(startJob);
        setSlug(targetSlug);
        setSteps(startJob.steps);
        setPhase("stepping");

        const finished = await stepUntilDone(startJob);
        setPhase("done");
        return outcomeOf(finished.steps, targetSlug);
      } catch {
        toast.error("Network error during generation.");
        setPhase("idle");
        return { ok: false, successes: 0, failures: 0 };
      } finally {
        runningRef.current = false;
      }
    },
    [stepUntilDone],
  );

  const retryStep = useCallback(
    async (stepKey: string): Promise<GenerationJobOutcome> => {
      if (!job || runningRef.current) return outcomeOf(steps, slug);
      runningRef.current = true;
      setPhase("stepping");
      try {
        const result = await postStep(job.id, stepKey);
        if ("error" in result) {
          toast.error(result.error);
          return outcomeOf(steps, slug);
        }
        setJob({ ...job, ...result.job });
        setSteps(result.job.steps);
        return outcomeOf(result.job.steps, slug);
      } finally {
        setPhase("done");
        runningRef.current = false;
      }
    },
    [job, steps, slug],
  );

  const retryFailed = useCallback(async (): Promise<GenerationJobOutcome> => {
    if (!job || runningRef.current) return outcomeOf(steps, slug);
    runningRef.current = true;
    setPhase("stepping");
    try {
      let current: JobPayload = { ...job, steps };
      for (const step of steps.filter((s) => s.status === "failed")) {
        const result = await postStep(job.id, step.key);
        if ("error" in result) {
          toast.error(result.error);
          return outcomeOf(current.steps, slug);
        }
        current = { ...current, ...result.job };
        setJob(current);
        setSteps(current.steps);
      }
      current = await stepUntilDone(current);
      return outcomeOf(current.steps, slug);
    } finally {
      setPhase("done");
      runningRef.current = false;
    }
  }, [job, steps, slug, stepUntilDone]);

  // ---- Auto-resume: pick up an in-flight job from a previous visit ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/ai/jobs", { method: "GET" });
        const payload = await response.json().catch(() => null);
        if (cancelled || !payload?.ok || !payload.job) return;
        const pending: JobPayload = payload.job;
        if (
          pending.status !== "generating" ||
          !pending.steps.some((step) => step.status === "pending") ||
          runningRef.current
        ) {
          return;
        }
        runningRef.current = true;
        resumedRef.current = true;
        setJob(pending);
        setSlug(slugOf(pending));
        setSteps(pending.steps);
        setPhase("stepping");
        try {
          const finished = await stepUntilDone(pending);
          setPhase("done");
          const outcome = outcomeOf(finished.steps, slugOf(finished));
          if (outcome.ok) {
            toast.success(
              outcome.failures > 0
                ? `Resumed generation finished with ${outcome.failures} failed step${outcome.failures === 1 ? "" : "s"}.`
                : "Your AI generation from earlier finished successfully.",
            );
          }
        } finally {
          runningRef.current = false;
        }
      } catch {
        // No resumable job / signed out — nothing to do.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = steps.filter((s) => s.status === "done").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;
  const showWidget =
    !widgetDismissed &&
    job !== null &&
    (busy || (phase === "done" && failedCount > 0));

  return (
    <GenerationContext.Provider
      value={{ phase, steps, busy, hasFailures, run, retryStep, retryFailed }}
    >
      {children}

      {showWidget ? (
        <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-border bg-surface/95 p-4 shadow-xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
              ) : failedCount > 0 ? (
                <TriangleAlert className="h-4 w-4 text-danger" aria-hidden />
              ) : (
                <Check className="h-4 w-4 text-primary-bright" aria-hidden />
              )}
              {job ? KIND_LABELS[job.kind] : "Generating"}
            </div>
            <button
              type="button"
              onClick={() => setWidgetDismissed(true)}
              aria-label="Hide generation status"
              className="rounded p-0.5 text-subtle transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated"
              role="progressbar"
              aria-valuenow={doneCount}
              aria-valuemin={0}
              aria-valuemax={steps.length}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{
                  width: `${steps.length ? Math.round(((doneCount + failedCount) / steps.length) * 100) : 0}%`,
                }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted">
              {doneCount + failedCount}/{steps.length}
            </span>
          </div>

          <p className="mt-2 text-xs leading-5 text-muted">
            {busy ? (
              <>
                Safe to keep browsing — generation continues in the
                background. If you close the tab it pauses and resumes
                automatically on your next visit.
              </>
            ) : (
              <>
                {failedCount} step{failedCount === 1 ? "" : "s"} failed — open
                the generator panel to retry them.
              </>
            )}
          </p>

          {slug && job ? (
            <Link
              href={targetHref(job, slug) ?? "#"}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-bright underline-offset-2 hover:underline"
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              View {job.kind === "set" ? "set" : "deck"}
            </Link>
          ) : null}
        </div>
      ) : null}
    </GenerationContext.Provider>
  );
}
