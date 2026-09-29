"use client";

import { useSyncExternalStore } from "react";
import {
  comboKey,
  createScoreBatchDecoder,
  type ScoreBatchCombo,
  type ScoreBatchEvent,
  type ScoreBatchResult,
} from "@/lib/frames/score-batch";

// ---------------------------------------------------------------------------
// One scoring job per tab (TODO 4.12), shared by every sign-off view: a
// module-level store (like rebake-marked-store.ts) so the job keeps running
// — and keeps its progress — while the admin moves between a template's
// sign-off and its compare pages, and a second click can't start a second
// job. Each round is one POST to /api/admin/frame-score-batch, read as an
// NDJSON stream; a round the server stopped at its time budget is followed
// by another with the combos it didn't start, so a whole treatment is one
// click. Cancel aborts the request: the server finishes the combo in flight
// (its score is recorded) and starts no more.
// ---------------------------------------------------------------------------

export type ComboProgress = {
  status: "queued" | "scoring" | "done" | "failed" | "skipped";
  overall?: number;
  error?: string;
  reason?: string;
};

/** A combo this tab's job scored — shown in the sign-off's table until the
 *  page's refreshed server data (the recorded event) takes over. */
export type LiveComboResult = Extract<ScoreBatchResult, { ok: true }> & {
  template: string;
  colorKey: string;
};

export type ScoreBatchState = {
  status: "idle" | "running" | "done" | "cancelled" | "error";
  /** What the job covers ("template:saga", "treatment:borderless"). */
  scopeKey: string | null;
  label: string | null;
  /** Combo keys ("template/colour") in the order they were asked for. */
  order: string[];
  progress: Record<string, ComboProgress>;
  results: Record<string, LiveComboResult>;
  startedAt: number | null;
  finishedAt: number | null;
  /** Requests sent (more than one when the time budget split the job). */
  rounds: number;
  error: string | null;
};

const INITIAL: ScoreBatchState = {
  status: "idle",
  scopeKey: null,
  label: null,
  order: [],
  progress: {},
  results: {},
  startedAt: null,
  finishedAt: null,
  rounds: 0,
  error: null,
};

/** Hard stop on follow-up rounds (a whole catalogue is ~3 rounds). */
const MAX_ROUNDS = 12;

let state: ScoreBatchState = INITIAL;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<ScoreBatchState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function setProgress(key: string, progress: ComboProgress) {
  set({ progress: { ...state.progress, [key]: progress } });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScoreBatch(): ScoreBatchState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

export function getScoreBatchState(): ScoreBatchState {
  return state;
}

function apply(event: ScoreBatchEvent): { remaining?: ScoreBatchCombo[]; stopped?: string | null; done?: boolean } {
  switch (event.type) {
    case "start":
      for (const skip of event.skipped) {
        setProgress(comboKey(skip), { status: "skipped", reason: skip.reason });
      }
      return {};
    case "scoring":
      setProgress(comboKey(event), { status: "scoring" });
      return {};
    case "result": {
      const key = comboKey(event);
      if (event.ok) {
        const { type: _type, ...rest } = event;
        void _type;
        set({ results: { ...state.results, [key]: rest } });
        setProgress(
          key,
          event.recorded
            ? { status: "done", overall: event.overall }
            : { status: "failed", overall: event.overall, error: "Scored, but not recorded — score it again." },
        );
      } else {
        setProgress(key, { status: "failed", error: event.error });
      }
      return {};
    }
    case "done":
      return { remaining: event.remaining, stopped: event.stopped, done: true };
    case "error":
      set({ error: event.error });
      return {};
  }
}

async function runRound(
  combos: ScoreBatchCombo[],
  signal: AbortSignal,
): Promise<
  | { kind: "done"; remaining: ScoreBatchCombo[]; stopped: string | null }
  | { kind: "cut"; progressed: boolean }
  | { kind: "error"; error: string }
> {
  const response = await fetch("/api/admin/frame-score-batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ combos }),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return { kind: "error", error: body?.error ?? `The scoring request failed (HTTP ${response.status}).` };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const lines = createScoreBatchDecoder();
  // Written from inside `handle` — a holder, so the reads below aren't
  // narrowed to the initial value.
  const round: {
    progressed: boolean;
    finished: { remaining: ScoreBatchCombo[]; stopped: string | null } | null;
  } = { progressed: false, finished: null };
  const handle = (events: ScoreBatchEvent[]) => {
    for (const event of events) {
      if (event.type === "result") round.progressed = true;
      const outcome = apply(event);
      if (outcome.done) round.finished = { remaining: outcome.remaining ?? [], stopped: outcome.stopped ?? null };
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    handle(lines.push(decoder.decode(value, { stream: true })));
  }
  handle(lines.push(decoder.decode()));
  handle(lines.flush());
  if (round.finished) return { kind: "done", ...round.finished };
  if (state.error) return { kind: "error", error: state.error };
  return { kind: "cut", progressed: round.progressed };
}

/** Start a job (no-op while one is running). Resolves with the final
 *  state. */
export async function startScoreBatch(input: {
  scopeKey: string;
  label: string;
  combos: ScoreBatchCombo[];
}): Promise<ScoreBatchState> {
  if (state.status === "running") return state;
  const order = input.combos.map(comboKey);
  controller = new AbortController();
  const signal = controller.signal;
  set({
    ...INITIAL,
    status: "running",
    scopeKey: input.scopeKey,
    label: input.label,
    order,
    progress: Object.fromEntries(order.map((key) => [key, { status: "queued" } as ComboProgress])),
    startedAt: Date.now(),
  });

  let pending = input.combos;
  try {
    for (let round = 0; round < MAX_ROUNDS && pending.length > 0; round += 1) {
      set({ rounds: state.rounds + 1 });
      const outcome = await runRound(pending, signal);
      if (outcome.kind === "error") {
        set({ status: "error", error: outcome.error, finishedAt: Date.now() });
        return state;
      }
      if (outcome.kind === "cut") {
        // The stream ended without "done" (the connection dropped, the
        // function was stopped): carry on with what wasn't scored, as long
        // as the round got somewhere.
        const unfinished = pending.filter((c) => {
          const status = state.progress[comboKey(c)]?.status;
          return status === "queued" || status === "scoring";
        });
        if (!outcome.progressed || unfinished.length === 0) {
          set({
            status: unfinished.length === 0 ? "done" : "error",
            error: unfinished.length === 0 ? null : "The scoring job stopped before it finished — run it again.",
            finishedAt: Date.now(),
          });
          return state;
        }
        for (const c of unfinished) setProgress(comboKey(c), { status: "queued" });
        pending = unfinished;
        continue;
      }
      if (outcome.stopped === "cancelled") {
        set({ status: "cancelled", finishedAt: Date.now() });
        return state;
      }
      pending = outcome.remaining;
    }
    set({
      status: pending.length > 0 ? "error" : "done",
      finishedAt: Date.now(),
      error: pending.length > 0 ? "The job needed too many rounds — run it again for the rest." : null,
    });
  } catch (err) {
    if (signal.aborted) {
      // The combo in flight is finished (and recorded) server-side; the
      // ones still "scoring" here won't report back.
      for (const [key, progress] of Object.entries(state.progress)) {
        if (progress.status === "scoring") setProgress(key, { status: "queued" });
      }
      set({ status: "cancelled", finishedAt: Date.now() });
    } else {
      set({
        status: "error",
        error: err instanceof Error ? err.message : "The scoring request failed.",
        finishedAt: Date.now(),
      });
    }
  } finally {
    controller = null;
  }
  return state;
}

/** Stop the running job: nothing new starts; what was scored stays
 *  recorded. */
export function cancelScoreBatch() {
  controller?.abort();
}

/** Clear a finished job's panel. */
export function dismissScoreBatch() {
  if (state.status === "running") return;
  set(INITIAL);
}

/** Counts for the progress bar. */
export function scoreBatchCounts(s: ScoreBatchState) {
  let done = 0;
  let failed = 0;
  let skipped = 0;
  let scoring = 0;
  for (const key of s.order) {
    const status = s.progress[key]?.status;
    if (status === "done") done += 1;
    else if (status === "failed") failed += 1;
    else if (status === "skipped") skipped += 1;
    else if (status === "scoring") scoring += 1;
  }
  const total = s.order.length;
  return { total, done, failed, skipped, scoring, finished: done + failed + skipped };
}

/** Test hook — the store is module-global. */
export function __resetScoreBatchForTests() {
  controller = null;
  state = INITIAL;
  for (const listener of listeners) listener();
}
