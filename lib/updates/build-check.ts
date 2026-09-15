// ---------------------------------------------------------------------------
// Pure decision logic for the "new version available" prompt
// (components/updates/update-prompt.tsx). Kept free of React/DOM so the
// edge cases — rollbacks, snoozes, a reload that didn't help — unit-test.
// ---------------------------------------------------------------------------

export type BuildCheckState = {
  /** The build this tab was loaded from. */
  current: string;
  /** What /api/version reported. */
  remote: string;
  /** The remote build we already reloaded for once (localStorage). A second
   *  mismatch against the SAME remote id after a reload means the reload
   *  can't fix it (a rollback, or the check racing a promotion) — never
   *  loop, just stay quiet for that id. */
  reloadedFor: string | null;
  /** Until when (ms epoch) the user asked not to be nagged. */
  snoozedUntil: number | null;
  now: number;
};

export type BuildCheckDecision = "none" | "prompt" | "quiet";

export function decideUpdate(state: BuildCheckState): BuildCheckDecision {
  if (!state.remote || state.remote === state.current) return "none";
  // A tab with no real build id (local dev, or the env var missing) never
  // prompts. The remote side is trusted as-is: production always reports a
  // deployment id, and the reloadedFor guard below caps any surprise at one
  // reload per id.
  if (state.current === "dev") return "none";
  if (state.reloadedFor === state.remote) return "quiet";
  if (state.snoozedUntil !== null && state.snoozedUntil > state.now) return "quiet";
  return "prompt";
}

/** How long "Later" hides the pill. */
export const SNOOZE_MS = 30 * 60 * 1000;
/** Re-check cadence while the tab is visible; focus/visibility also trigger. */
export const POLL_MS = 10 * 60 * 1000;
/** Minimum spacing between two checks (focus + visibility can fire together). */
export const MIN_CHECK_GAP_MS = 60 * 1000;
