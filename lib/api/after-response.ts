import "server-only";

import { after } from "next/server";

// ---------------------------------------------------------------------------
// afterResponse — run a side task once the response is on its way.
//
// Instrumentation (a funnel row, a tool event) must never add a database
// round trip to a save, a download or a job start, and must never be able to
// fail one. `after()` (next/server) does the first; this adds the second —
// the task's own failure is logged and goes nowhere — and one more thing
// `after()` does not do: it works where there is no request to wait for.
// Outside a request scope (a unit test, a script) `after()` throws; there
// the task simply runs now, unawaited.
//
// Pass identity in as plain values: never re-read the session inside the
// task (it can rotate the cookie with nowhere to set it — the reason every
// `after()` in this codebase takes its user id from the caller).
// ---------------------------------------------------------------------------

export function afterResponse(task: () => Promise<unknown> | unknown): void {
  const run = async () => {
    try {
      await task();
    } catch (error) {
      console.warn("[after-response] a deferred task failed:", error instanceof Error ? error.message : error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
