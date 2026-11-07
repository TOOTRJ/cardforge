"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { publishCredits } from "@/components/billing/credits-bus";
import type { GenerationJobView, JobStep } from "@/lib/ai/generation-jobs";

// ---------------------------------------------------------------------------
// Runs a Bulk Customize batch from the dialog: each pending step POSTed to
// /api/ai/jobs/<id>/step BY KEY (the AI jobs' one step door — the claim is
// atomic there, the outcome written by patch_job_step), two at a time.
//
//   * a step the server put back in line (error_code RATE_LIMITED: the
//     minute's Scryfall art imports are spent) waits its
//     `retry_after_seconds` and runs again;
//   * a step mid-run in another request (inFlight) is asked again shortly;
//   * a PLAN LIMIT (the card limit, an empty balance) stops the whole run
//     and hands the code back, so the dialog opens the matching upgrade
//     prompt instead of retrying into the same wall;
//   * a 429 from the step door (the AI per-minute limit) waits and retries.
// Failed steps stay failed — the dialog offers "Try the failed ones again".
// ---------------------------------------------------------------------------

const WORKERS = 2;
const IN_FLIGHT_WAIT_MS = 3_000;
const HICCUP_WAIT_MS = 4_000;
/** A step that errors at the door this many times in a row is left failed. */
const MAX_DOOR_ERRORS = 3;

export type BulkRunStop = "CARD_CAPACITY" | "INSUFFICIENT_CREDITS" | null;

export type BulkRunState = {
  steps: JobStep[];
  running: boolean;
  /** Steps waiting on a quota, with when they run again. */
  waitingUntil: number | null;
  stoppedBy: BulkRunStop;
  /** A door error the run couldn't get past (the job is gone, signed out). */
  error: string | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useBulkRunner(job: GenerationJobView | null) {
  const [state, setState] = useState<BulkRunState>({
    steps: job?.steps ?? [],
    running: false,
    waitingUntil: null,
    stoppedBy: null,
    error: null,
  });
  const stopRef = useRef(false);
  const runningRef = useRef(false);
  /** The latest steps, read by a run as it starts (state is a render behind). */
  const stepsRef = useRef<JobStep[]>(job?.steps ?? []);
  const jobId = job?.id ?? null;

  const mergeSteps = useCallback((steps: JobStep[]) => {
    stepsRef.current = steps;
    setState((prev) => ({ ...prev, steps }));
  }, []);

  const run = useCallback(
    async (keys?: string[]) => {
      if (!jobId || runningRef.current) return;
      runningRef.current = true;
      stopRef.current = false;
      setState((prev) => ({ ...prev, running: true, stoppedBy: null, error: null }));

      // The queue: the keys asked for, else every step not yet finished.
      const queue = (
        keys ??
        stepsRef.current.filter((step) => step.status === "pending" || step.status === "running").map((step) => step.key)
      ).slice();
      const doorErrors = new Map<string, number>();
      let stop: BulkRunStop = null;
      let fatal: string | null = null;

      const takeNext = () => queue.shift();
      const worker = async () => {
        for (;;) {
          if (stopRef.current || stop || fatal) return;
          const key = takeNext();
          if (!key) return;
          let response: Response;
          try {
            response = await fetch(`/api/ai/jobs/${jobId}/step`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ step: key }),
            });
          } catch {
            const n = (doorErrors.get(key) ?? 0) + 1;
            doorErrors.set(key, n);
            if (n < MAX_DOOR_ERRORS) {
              await sleep(HICCUP_WAIT_MS);
              queue.push(key);
            }
            continue;
          }
          if (response.status === 429) {
            const retry = Number(response.headers.get("Retry-After")) || 20;
            setState((prev) => ({ ...prev, waitingUntil: Date.now() + retry * 1000 }));
            await sleep(retry * 1000);
            setState((prev) => ({ ...prev, waitingUntil: null }));
            queue.unshift(key);
            continue;
          }
          const body = (await response.json().catch(() => null)) as
            | { ok: true; job: GenerationJobView; inFlight?: boolean; credits?: number | null }
            | { ok: false; error?: string }
            | null;
          if (!body || body.ok !== true) {
            if (response.status === 401 || response.status === 502) {
              const n = (doorErrors.get(key) ?? 0) + 1;
              doorErrors.set(key, n);
              if (n >= MAX_DOOR_ERRORS) {
                fatal = (body && "error" in body && body.error) || "The batch stopped — try again in a moment.";
                return;
              }
              await sleep(HICCUP_WAIT_MS);
              queue.push(key);
            }
            continue;
          }
          if (typeof body.credits === "number") publishCredits(body.credits);
          mergeSteps(body.job.steps);
          const step = body.job.steps.find((s) => s.key === key);
          if (!step) continue;
          if (body.inFlight) {
            await sleep(IN_FLIGHT_WAIT_MS);
            queue.push(key);
            continue;
          }
          if (step.status === "pending" && step.error_code === "RATE_LIMITED") {
            const wait = Math.max(1, step.retry_after_seconds ?? 20) * 1000;
            setState((prev) => ({ ...prev, waitingUntil: Date.now() + wait }));
            await sleep(wait);
            setState((prev) => ({ ...prev, waitingUntil: null }));
            queue.unshift(key);
            continue;
          }
          if (step.status === "failed" && (step.error_code === "CARD_CAPACITY" || step.error_code === "INSUFFICIENT_CREDITS")) {
            stop = step.error_code;
            return;
          }
        }
      };

      await Promise.all(Array.from({ length: WORKERS }, () => worker()));
      runningRef.current = false;
      setState((prev) => ({ ...prev, running: false, waitingUntil: null, stoppedBy: stop, error: fatal }));
    },
    [jobId, mergeSteps],
  );

  // A new job's steps, taken in during render (React's "adjust state on a
  // prop change" pattern — no effect sets them).
  const [shownJob, setShownJob] = useState<string | null>(jobId);
  if (jobId !== shownJob) {
    setShownJob(jobId);
    stepsRef.current = job?.steps ?? [];
    setState({ steps: job?.steps ?? [], running: false, waitingUntil: null, stoppedBy: null, error: null });
  }

  // A new job starts at once.
  useEffect(() => {
    if (!job) return;
    stepsRef.current = job.steps;
    void run();
    return () => {
      stopRef.current = true;
    };
    // Only a new job id restarts the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const retryFailed = useCallback(() => {
    const keys = state.steps.filter((step) => step.status === "failed").map((step) => step.key);
    if (keys.length > 0) void run(keys);
  }, [run, state.steps]);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  return { ...state, retryFailed, stop };
}
