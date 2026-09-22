"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { publishCredits } from "@/components/billing/credits-bus";
import { useLeaveWarning } from "@/components/ai/use-leave-warning";
import { cn } from "@/lib/utils";
import {
  GenerationDetailsDialog,
  type GenerationStats,
} from "@/components/ai/generation-details-dialog";
import { useUpgradeModal } from "@/components/billing/upgrade-modal-provider";
import { useCreditConfirm } from "@/components/billing/credit-confirm-provider";
import { jobStatusOf, openStepKeys } from "@/lib/ai/job-queue";
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
  kind: "deck" | "deck_remix" | "card" | "card_remix" | "card_fill";
  status:
    | "generating"
    | "done"
    | "done_with_errors"
    | "failed"
    | "cancelled";
  steps: GenerationJobStep[];
  request?: Record<string, unknown>;
  deck_id?: string | null;
};

export type ActiveGenerationJob = {
  id: string;
  kind: JobPayload["kind"];
  deckId: string | null;
};

export type RunOptions = {
  /** Resolve as soon as the job is PLANNED (steps exist) and keep stepping
   *  in the background — for flows that navigate away and let the target
   *  page fill in live (deck builds). The outcome then carries `detached`
   *  and `jobId`, with zero successes/failures. */
  detach?: boolean;
};

export type GenerationContextValue = {
  phase: GenerationJobPhase;
  steps: GenerationJobStep[];
  busy: boolean;
  hasFailures: boolean;
  run: (body: Record<string, unknown>, options?: RunOptions) => Promise<GenerationJobOutcome>;
  /** Adopt a finished-with-failures job by id and re-run its failed steps
   *  (the deck page's "Regenerate" bar). */
  retryJob: (jobId: string) => Promise<GenerationJobOutcome>;
  /** Adopt a still-generating job by id (a build interrupted by a reload)
   *  and finish its open steps — never re-runs failed ones. */
  resumeJob: (jobId: string) => Promise<GenerationJobOutcome>;
  /** The job this runner currently owns (or last finished), for pages that
   *  want to show live progress for THEIR deck/set. */
  activeJob: ActiveGenerationJob | null;
  /** Open the progress details dialog (also opened by clicking the widget). */
  openDetails: () => void;
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

// How many card steps to run at once. Each step is one image generation;
// a small pool cuts a big deck's wall-clock ~POOL× without tripping the
// per-minute AI rate limit (40/min for non-admins) at ~11s/image — a full
// 100-step job peaks around 16 calls/min on this pool.
const STEP_CONCURRENCY = 3;

const KIND_LABELS: Record<JobPayload["kind"], string> = {
  deck: "Generating deck cards",
  deck_remix: "Remixing deck",
  card: "Forging your card",
  card_remix: "Remixing your card",
  card_fill: "Generating card fields",
};

async function postStep(
  jobId: string,
  stepKey?: string,
): Promise<{ job: JobPayload; inFlight: boolean } | { error: string }> {
  try {
    // keepalive: a reload or navigation must not tear down the socket while
    // a card is mid-paint — a reset connection failed the step server-side
    // (card row created, art lost) and the resumed tab then re-ran it,
    // which is what "refreshing regenerated my cards" was. The body is a
    // few bytes, well inside the keepalive budget.
    const response = await fetch(`/api/ai/jobs/${jobId}/step`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stepKey ? { step: stepKey } : {}),
      keepalive: true,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      return { error: payload?.error ?? "Generation step failed." };
    }
    // Every step response carries the live post-spend/refund balance —
    // broadcast it so credit meters track the job in real time.
    if (typeof payload.credits === "number") {
      publishCredits(payload.credits);
    }
    return {
      job: payload.job as JobPayload,
      inFlight: payload.inFlight === true,
    };
  } catch {
    return { error: "Network error during generation." };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Credits a set of steps will reserve when (re)run: one per card/icon
 *  step; the deck cover and the how-to-play guide are free. */
function creditedStepCount(steps: ReadonlyArray<{ key: string }>): number {
  return steps.filter((s) => s.key !== "cover" && s.key !== "guide").length;
}

// A step someone else is running is POLLED, not re-executed. The server's
// stale-claim window is 5 minutes, so ~24 polls at 15s guarantees we either
// see the result or reclaim a dead attempt before giving up.
const INFLIGHT_POLL_MS = 15_000;
const MAX_INFLIGHT_POLLS = 24;

function outcomeOf(
  steps: GenerationJobStep[],
  slug?: string,
): GenerationJobOutcome {
  const failures = steps.filter((s) => s.status === "failed").length;
  const successes = steps.filter((s) => s.status === "done").length;
  const cardId = steps.find((s) => s.status === "done" && s.card_id)?.card_id;
  return { ok: successes > 0, successes, failures, slug, cardId };
}

function slugOf(job: JobPayload): string | undefined {
  const request = job.request ?? {};
  const value = request["deck_slug"] ?? request["set_slug"];
  return typeof value === "string" && value ? value : undefined;
}

function targetHref(
  job: JobPayload,
  slug?: string,
  cardId?: string,
): string | undefined {
  // Card jobs link to the created card via the id-redirect shim (the slug
  // isn't known client-side); deck jobs link to the deck page.
  if (job.kind === "card" || job.kind === "card_remix") {
    return cardId ? `/go/card/${cardId}` : undefined;
  }
  if (!slug) return undefined;
  return `/deck/${slug}`;
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Pace bookkeeping for the details dialog's estimate: when the run began
  // and when each step finished during this session.
  const [stats, setStats] = useState<GenerationStats>({
    startedAt: null,
    completions: [],
    concurrency: STEP_CONCURRENCY,
  });
  const seenTerminalRef = useRef<Set<string>>(new Set());
  const noteTerminal = useCallback((job: JobPayload) => {
    const fresh: number[] = [];
    for (const s of job.steps) {
      if ((s.status === "done" || s.status === "failed") && !seenTerminalRef.current.has(s.key)) {
        seenTerminalRef.current.add(s.key);
        fresh.push(Date.now());
      }
    }
    if (fresh.length > 0) {
      setStats((prev) => ({ ...prev, completions: [...prev.completions, ...fresh] }));
    }
  }, []);
  const beginStats = useCallback((job: JobPayload) => {
    seenTerminalRef.current = new Set(
      job.steps.filter((s) => s.status === "done" || s.status === "failed").map((s) => s.key),
    );
    setStats({ startedAt: Date.now(), completions: [], concurrency: STEP_CONCURRENCY });
  }, []);
  const upgrade = useUpgradeModal();
  const confirmSpend = useCreditConfirm();
  // Jobs adopted by auto-resume have no panel awaiting a promise — the
  // provider owns their completion toast.
  const resumedRef = useRef(false);
  const runningRef = useRef(false);

  const busy = phase === "planning" || phase === "stepping";
  // Closing the tab mid-run is safe (the job resumes on the next visit)
  // but never intended — ask first (owner decision 2026-09-17).
  useLeaveWarning(busy);
  const hasFailures = steps.some((step) => step.status === "failed");

  const stepUntilDone = useCallback(
    async (
      startJob: JobPayload,
      options: { includeFailed?: boolean } = {},
    ): Promise<JobPayload> => {
      // Drain the job's open steps with a small pool of workers, each
      // POSTing a DISTINCT step key. The server CLAIMS a step atomically
      // before executing (migration 0066) and writes its result atomically
      // (0065), so parallel steps are safe, a retry can never race a
      // still-running attempt into a duplicate, and an N-card deck finishes
      // in ~N/POOL image-times instead of strictly one-at-a-time.
      const terminal = new Map<string, GenerationJobStep>();
      const latest = new Map<string, GenerationJobStep>();
      // "running" steps (adopted from a dead tab) are queued too: the worker
      // polls them and reclaims once the server marks the claim stale. An
      // explicit retry queues the failed steps as well — the pool posts them
      // by key, so N failed cards regenerate N/POOL at a time instead of
      // one after another.
      const queue = openStepKeys(startJob.steps, options);
      const queued = new Set(queue);
      for (const s of startJob.steps) {
        if ((s.status === "done" || s.status === "failed") && !queued.has(s.key)) {
          terminal.set(s.key, s);
        } else if (s.status === "failed") {
          // A failed step queued for retry shows as open again right away
          // (progress reads 3/4, not "4/4 · 1 failed") until its claim lands.
          latest.set(s.key, { ...s, status: "pending", error: undefined });
        }
      }
      const order = startJob.steps.map((s) => s.key);
      const inFlightPolls = new Map<string, number>();
      let transportFailures = 0;
      let stopped = false;

      const snapshot = (): JobPayload => {
        const steps = startJob.steps.map(
          (s) => terminal.get(s.key) ?? latest.get(s.key) ?? s,
        );
        // Mirrors patch_job_step's honest recompute (migration 0067).
        return { ...startJob, steps, status: jobStatusOf(steps) } as JobPayload;
      };

      const publish = (job: JobPayload) => {
        // done/failed are terminal — record the latest of each (results can
        // arrive out of order across workers). Non-terminal statuses update
        // `latest` so a running claim shows live in the progress list.
        for (const s of job.steps) {
          if (s.status === "done" || s.status === "failed") {
            terminal.set(s.key, s);
          } else {
            latest.set(s.key, s);
          }
        }
        const snap = snapshot();
        setJob(snap);
        setSteps(order.map((k) => snap.steps.find((s) => s.key === k)!));
        noteTerminal(snap);
      };

      const worker = async (): Promise<void> => {
        while (!stopped) {
          const key = queue.shift();
          if (key === undefined) return;
          const result = await postStep(startJob.id, key);
          if ("error" in result) {
            transportFailures += 1;
            if (transportFailures >= 3) {
              stopped = true;
              toast.error(
                `${result.error} Generation paused — it resumes automatically next time you open the app, or use Retry.`,
              );
              return;
            }
            queue.push(key); // one retry for a transient blip
            continue;
          }
          transportFailures = 0;
          publish(result.job);
          if (result.inFlight) {
            // Another request owns this step right now (an earlier attempt
            // whose response we lost, or a second tab). Poll until it
            // resolves — or until its claim goes stale and we reclaim it.
            const polls = (inFlightPolls.get(key) ?? 0) + 1;
            inFlightPolls.set(key, polls);
            if (polls <= MAX_INFLIGHT_POLLS) {
              await sleep(INFLIGHT_POLL_MS);
              queue.push(key);
            } else {
              toast.error(
                "A generation step is stuck — it resumes automatically next time you open the app.",
              );
            }
            continue;
          }
          inFlightPolls.delete(key);
        }
      };

      const pool = Math.min(STEP_CONCURRENCY, Math.max(1, queue.length));
      await Promise.all(Array.from({ length: pool }, () => worker()));
      return snapshot();
    },
    [noteTerminal],
  );

  const run = useCallback(
    async (body: Record<string, unknown>, options: RunOptions = {}): Promise<GenerationJobOutcome> => {
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
      setStats({ startedAt: Date.now(), completions: [], concurrency: STEP_CONCURRENCY });
      seenTerminalRef.current = new Set();
      try {
        const planResponse = await fetch("/api/ai/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const planPayload = await planResponse.json().catch(() => null);
        if (!planResponse.ok || !planPayload?.ok) {
          // Out of credits is a selling moment, not an error toast.
          if (
            planResponse.status === 402 ||
            planPayload?.code === "INSUFFICIENT_CREDITS"
          ) {
            upgrade.open("credits");
          } else {
            toast.error(planPayload?.error ?? "AI planning failed. Try again.");
          }
          setPhase("idle");
          return { ok: false, successes: 0, failures: 0 };
        }
        const startJob: JobPayload = planPayload.job;
        const targetSlug: string | undefined =
          planPayload.setSlug || planPayload.deckSlug || slugOf(startJob);
        // The job is committed — project its full cost onto the credit
        // meters IMMEDIATELY (server-reported pre-spend balance minus the
        // steps about to charge). Each step response then overwrites the
        // projection with the real number, including any refunds.
        if (typeof planPayload.credits === "number") {
          const pendingCost = startJob.steps.filter(
            (s) => s.status === "pending",
          ).length;
          publishCredits(planPayload.credits - pendingCost);
        }
        setJob(startJob);
        setSlug(targetSlug);
        setSteps(startJob.steps);
        setPhase("stepping");
        // Planning is done; measure painting pace from here.
        beginStats(startJob);

        const finishStepping = async (): Promise<JobPayload> => {
          const finished = await stepUntilDone(startJob);
          setPhase("done");
          if (finished.steps.some((s) => s.status === "running")) {
            // Pool drained but a step is still mid-run elsewhere (or its
            // claim hasn't gone stale yet) — that is NOT a clean finish.
            toast.message(
              "One step is still finishing in the background — it completes or becomes retryable on your next visit.",
            );
          }
          return finished;
        };

        if (options.detach) {
          // The caller moves on (e.g. to the deck page, which fills in
          // live); this runner keeps painting and owns the wrap-up toast.
          void finishStepping()
            .then((finished) => {
              const outcome = outcomeOf(finished.steps, targetSlug);
              if (outcome.failures > 0) {
                toast.message(
                  `${outcome.successes} card${outcome.successes === 1 ? "" : "s"} done, ${outcome.failures} failed.`,
                  { description: "Use Regenerate on the deck page — nothing gets generated twice." },
                );
              }
            })
            .catch(() => {
              toast.error("Network error during generation — it resumes next time you open the app.");
              setPhase("done");
            })
            .finally(() => {
              runningRef.current = false;
            });
          return {
            ok: true,
            successes: 0,
            failures: 0,
            slug: targetSlug,
            jobId: startJob.id,
            detached: true,
          };
        }

        const finished = await finishStepping();
        runningRef.current = false;
        return outcomeOf(finished.steps, targetSlug);
      } catch {
        toast.error("Network error during generation.");
        setPhase("idle");
        runningRef.current = false;
        return { ok: false, successes: 0, failures: 0 };
      }
    },
    [stepUntilDone, upgrade, beginStats],
  );

  const retryStep = useCallback(
    async (stepKey: string): Promise<GenerationJobOutcome> => {
      if (!job || runningRef.current) return outcomeOf(steps, slug);
      const stepCost = creditedStepCount(steps.filter((s) => s.key === stepKey));
      if (
        stepCost > 0 &&
        !(await confirmSpend({
          cost: stepCost,
          title: "Retry this step?",
          description: "The failed attempt was refunded; retrying reserves the credit again.",
          confirmLabel: "Retry",
        }))
      ) {
        return outcomeOf(steps, slug);
      }
      if (runningRef.current) return outcomeOf(steps, slug);
      runningRef.current = true;
      setPhase("stepping");
      try {
        const result = await postStep(job.id, stepKey);
        if ("error" in result) {
          toast.error(result.error);
          return outcomeOf(steps, slug);
        }
        if (result.inFlight) {
          toast.message("That step is still running — give it a moment.");
        }
        setJob({ ...job, ...result.job });
        setSteps(result.job.steps);
        return outcomeOf(result.job.steps, slug);
      } finally {
        setPhase("done");
        runningRef.current = false;
      }
    },
    [job, steps, slug, confirmSpend],
  );

  const retryFailed = useCallback(async (): Promise<GenerationJobOutcome> => {
    if (!job || runningRef.current) return outcomeOf(steps, slug);
    const failedSteps = steps.filter((s) => s.status === "failed");
    const retryCost = creditedStepCount(failedSteps);
    if (
      retryCost > 0 &&
      !(await confirmSpend({
        cost: retryCost,
        title: `Retry ${failedSteps.length} failed step${failedSteps.length === 1 ? "" : "s"}?`,
        description: "Failed attempts were refunded; retrying reserves the credits again.",
        confirmLabel: "Retry",
      }))
    ) {
      return outcomeOf(steps, slug);
    }
    if (runningRef.current) return outcomeOf(steps, slug);
    runningRef.current = true;
    setPhase("stepping");
    try {
      const current = await stepUntilDone({ ...job, steps }, { includeFailed: true });
      return outcomeOf(current.steps, slug);
    } finally {
      setPhase("done");
      runningRef.current = false;
    }
  }, [job, steps, slug, stepUntilDone, confirmSpend]);

  const adoptJob = useCallback(
    async (jobId: string, options: { includeFailed: boolean }): Promise<GenerationJobOutcome> => {
      if (runningRef.current) {
        toast.error("Another generation is already running — let it finish first.");
        return { ok: false, successes: 0, failures: 0 };
      }
      let adopted: JobPayload | null = null;
      try {
        const response = await fetch(`/api/ai/jobs/${jobId}`);
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.ok && payload.job) adopted = payload.job as JobPayload;
      } catch {
        adopted = null;
      }
      if (!adopted) {
        toast.error("Couldn't load that generation.");
        return { ok: false, successes: 0, failures: 0 };
      }
      if (openStepKeys(adopted.steps, options).length === 0) {
        setJob(adopted);
        setSlug(slugOf(adopted));
        setSteps(adopted.steps);
        setPhase("done");
        return outcomeOf(adopted.steps, slugOf(adopted));
      }
      if (options.includeFailed) {
        const failedSteps = adopted.steps.filter((s) => s.status === "failed");
        const retryCost = creditedStepCount(failedSteps);
        if (
          retryCost > 0 &&
          !(await confirmSpend({
            cost: retryCost,
            title: `Regenerate ${failedSteps.length} card${failedSteps.length === 1 ? "" : "s"}?`,
            description: "The failed attempts were refunded; regenerating reserves the credits again.",
            confirmLabel: "Regenerate",
          }))
        ) {
          return { ok: false, successes: 0, failures: failedSteps.length };
        }
        if (runningRef.current) {
          toast.error("Another generation is already running — let it finish first.");
          return { ok: false, successes: 0, failures: 0 };
        }
      }
      runningRef.current = true;
      resumedRef.current = false;
      setWidgetDismissed(false);
      setJob(adopted);
      setSlug(slugOf(adopted));
      setSteps(adopted.steps);
      setPhase("stepping");
      beginStats(adopted);
      try {
        const current = await stepUntilDone(adopted, options);
        return outcomeOf(current.steps, slugOf(current));
      } finally {
        setPhase("done");
        runningRef.current = false;
      }
    },
    [stepUntilDone, beginStats, confirmSpend],
  );
  const retryJob = useCallback(
    (jobId: string) => adoptJob(jobId, { includeFailed: true }),
    [adoptJob],
  );
  const resumeJob = useCallback(
    (jobId: string) => adoptJob(jobId, { includeFailed: false }),
    [adoptJob],
  );

  // ---- Auto-resume: pick up an in-flight job from a previous visit ----
  // Checked on mount and again whenever the tab regains focus/visibility
  // (throttled): a reload during a long PLAN request lands before the job
  // row exists, so a mount-only check would miss it and the user would see
  // nothing running — and might start a second build.
  const lastResumeCheckRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (runningRef.current) return;
      const now = Date.now();
      if (now - lastResumeCheckRef.current < 10_000) return;
      lastResumeCheckRef.current = now;
      try {
        const response = await fetch("/api/ai/jobs", { method: "GET" });
        const payload = await response.json().catch(() => null);
        if (cancelled || !payload?.ok || !payload.job) return;
        const pending: JobPayload = payload.job;
        // A fill job's result belongs to the creator form that started it —
        // there is nothing to resume without that form (the GET already
        // filters these out; belt and braces).
        if (pending.kind === "card_fill") return;
        if (
          pending.status !== "generating" ||
          !pending.steps.some(
            (step) => step.status === "pending" || step.status === "running",
          ) ||
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
        beginStats(pending);
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
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doneCount = steps.filter((s) => s.status === "done").length;
  const failedCount = steps.filter((s) => s.status === "failed").length;
  const runningCount = steps.filter((s) => s.status === "running").length;
  const firstFailureError = steps.find(
    (s) => s.status === "failed" && s.error,
  )?.error;
  const doneCardId = steps.find(
    (s) => s.status === "done" && s.card_id,
  )?.card_id;
  // The widget appears the instant a run starts (planning, before the job
  // row exists) and stays while stepping or when something needs a retry.
  const showWidget =
    !widgetDismissed &&
    (phase === "planning" ||
      (job !== null && (busy || (phase === "done" && (failedCount > 0 || runningCount > 0)))));
  const widgetLabel = job ? KIND_LABELS[job.kind] : "Designing…";
  const href = job ? targetHref(job, slug, doneCardId) : undefined;
  const targetLabel = job
    ? `Open ${job.kind === "card" || job.kind === "card_remix" ? "card" : "deck"}`
    : undefined;
  const openDetails = useCallback(() => setDetailsOpen(true), []);
  const activeJob = useMemo<ActiveGenerationJob | null>(
    () => (job ? { id: job.id, kind: job.kind, deckId: job.deck_id ?? null } : null),
    [job],
  );
  // Memoized so a step landing re-renders only the consumers whose inputs
  // changed — with a 100-card job the provider publishes ~100 times.
  const contextValue = useMemo<GenerationContextValue>(
    () => ({ phase, steps, busy, hasFailures, run, retryStep, retryFailed, retryJob, resumeJob, openDetails, activeJob }),
    [phase, steps, busy, hasFailures, run, retryStep, retryFailed, retryJob, resumeJob, openDetails, activeJob],
  );

  return (
    <GenerationContext.Provider value={contextValue}>
      {children}

      {showWidget ? (
        <div
          className="fixed bottom-24 right-4 z-50 w-80 rounded-xl border border-border bg-surface/95 shadow-xl backdrop-blur sm:bottom-28"
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            onClick={openDetails}
            className="flex w-full flex-col gap-2 rounded-xl p-4 text-left transition-colors hover:bg-elevated/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            aria-label={`${widgetLabel} — open details`}
          >
            <span className="flex items-center gap-2 pr-6 text-sm font-semibold text-foreground">
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
              ) : failedCount > 0 ? (
                <TriangleAlert className="h-4 w-4 text-danger" aria-hidden />
              ) : (
                <Check className="h-4 w-4 text-primary-bright" aria-hidden />
              )}
              {widgetLabel}
            </span>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "h-1.5 flex-1 overflow-hidden rounded-full bg-elevated",
                  phase === "planning" && "animate-pulse",
                )}
                role="progressbar"
                aria-valuenow={doneCount}
                aria-valuemin={0}
                aria-valuemax={steps.length || undefined}
              >
                <span
                  className="block h-full rounded-full bg-accent transition-[width]"
                  style={{
                    width:
                      phase === "planning"
                        ? "35%"
                        : `${steps.length ? Math.round(((doneCount + failedCount) / steps.length) * 100) : 0}%`,
                  }}
                />
              </span>
              <span className="text-xs tabular-nums text-muted">
                {phase === "planning" ? "plan" : `${doneCount + failedCount}/${steps.length}`}
              </span>
            </span>
            <span className="text-xs leading-5 text-muted">
              {phase === "planning" ? (
                <>The AI is designing the deck — painting starts in a moment.</>
              ) : busy ? (
                <>Tap for stats and time left. Safe to keep browsing.</>
              ) : failedCount > 0 ? (
                <>
                  {failedCount} step{failedCount === 1 ? "" : "s"} failed
                  {firstFailureError ? `: ${firstFailureError}` : ""} — tap to retry.
                </>
              ) : (
                <>One step is still finishing in the background — tap for details.</>
              )}
            </span>
            {href ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-bright">
                <Sparkles className="h-3 w-3" aria-hidden />
                {targetLabel}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setWidgetDismissed(true)}
            aria-label="Hide generation status"
            className="absolute right-3 top-3 rounded p-0.5 text-subtle transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <GenerationDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        label={widgetLabel}
        phase={phase}
        steps={steps}
        stats={stats}
        targetHref={href}
        targetLabel={targetLabel}
        onRetryStep={(key) => void retryStep(key)}
        onRetryFailed={() => void retryFailed()}
      />
    </GenerationContext.Provider>
  );
}
