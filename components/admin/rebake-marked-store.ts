"use client";

import { useSyncExternalStore } from "react";
import type { RebakeMarkedResponse } from "@/app/api/admin/rebake-marked/route";

// ---------------------------------------------------------------------------
// One client-side re-bake loop per tab, shared by the compare editor (which
// starts it right after a layout save/reset) and the MarkedRendersPanel
// (which shows progress and offers "Re-bake now"). A module-level store so
// both components see the same run and a second click can't start a second
// loop. Each iteration is one POST to /api/admin/rebake-marked (a route, not
// a server action, so the loop never queues the page's own actions).
// ---------------------------------------------------------------------------

export type MarkedRebakeState = {
  status: "idle" | "running" | "done" | "error";
  rebaked: number;
  failed: Array<{ id: string; error: string }>;
  /** Cards still owed a re-bake after the last batch (null before one ran). */
  remaining: number | null;
  error: string | null;
};

const INITIAL: MarkedRebakeState = {
  status: "idle",
  rebaked: 0,
  failed: [],
  remaining: null,
  error: null,
};

/** Hard stop so a server that keeps answering "remaining > 0" without
 *  progress can't spin forever. */
const MAX_ROUNDS = 400;
/** Consecutive rounds where every card failed before the loop stops and
 *  reports — a systemic failure (storage quota, a renderer regression, an
 *  art host down) shouldn't grind through every marked card. */
const MAX_FAILED_ROUNDS = 2;

async function requestBatch(skipIds: string[]): Promise<RebakeMarkedResponse> {
  const response = await fetch("/api/admin/rebake-marked", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skipIds }),
  });
  const body = (await response.json().catch(() => null)) as RebakeMarkedResponse | null;
  if (!body) return { ok: false, error: `The re-bake request failed (HTTP ${response.status}).` };
  return body;
}

let state: MarkedRebakeState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<MarkedRebakeState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMarkedRebake(): MarkedRebakeState {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

/** Start the loop (no-op while one is running). Resolves with the final
 *  state. */
export async function startMarkedRebake(): Promise<MarkedRebakeState> {
  if (state.status === "running") return state;
  set({ ...INITIAL, status: "running" });
  const skipIds: string[] = [];
  let failedRounds = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let result: RebakeMarkedResponse;
    try {
      result = await requestBatch([...skipIds]);
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : "The re-bake request failed." });
      return state;
    }
    if (!result.ok) {
      set({ status: "error", error: result.error });
      return state;
    }
    skipIds.push(...result.failed.map((f) => f.id));
    set({
      rebaked: state.rebaked + result.rebaked,
      failed: [...state.failed, ...result.failed],
      remaining: result.remaining,
    });
    if (result.remaining === 0) break;
    if (result.rebaked === 0 && result.failed.length > 0) {
      failedRounds += 1;
      if (failedRounds >= MAX_FAILED_ROUNDS) {
        set({ status: "error", error: `Every card in the last batches failed: ${result.failed[0].error}` });
        return state;
      }
    } else {
      failedRounds = 0;
    }
    // No progress and nothing failed: only superseded rows (a save landed
    // mid-batch) justify another round.
    if (result.rebaked === 0 && result.failed.length === 0 && result.superseded === 0) break;
  }
  set({ status: "done" });
  return state;
}

/** Whether a layout Save/Reset result should start the re-bake loop. */
export function shouldRebakeAfterLayoutChange(result: {
  ok: boolean;
  changed?: boolean;
  staleCount?: number;
}): boolean {
  return result.ok && result.changed === true && (result.staleCount ?? 0) > 0;
}

/** Test hook — the store is module-global. */
export function __resetMarkedRebakeForTests() {
  state = INITIAL;
  for (const listener of listeners) listener();
}
