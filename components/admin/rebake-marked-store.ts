"use client";

import { useSyncExternalStore } from "react";
import { rebakeMarkedRendersAction } from "@/lib/cards/rebake-actions";

// ---------------------------------------------------------------------------
// One client-side re-bake loop per tab, shared by the compare editor (which
// starts it right after a layout save/reset) and the MarkedRendersPanel
// (which shows progress and offers "Re-bake now"). A module-level store so
// both components see the same run and a second click can't start a second
// loop. Each iteration is one server-action call (lib/cards/rebake-actions.ts).
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
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    let result: Awaited<ReturnType<typeof rebakeMarkedRendersAction>>;
    try {
      result = await rebakeMarkedRendersAction({ skipIds: [...skipIds] });
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
    if (result.rebaked === 0 && result.failed.length === 0) break;
  }
  set({ status: "done" });
  return state;
}

/** Test hook — the store is module-global. */
export function __resetMarkedRebakeForTests() {
  state = INITIAL;
  for (const listener of listeners) listener();
}
