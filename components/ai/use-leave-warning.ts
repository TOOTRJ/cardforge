"use client";

import { useEffect } from "react";

/** While `active`, closing or reloading the tab gets the browser's own
 *  "leave site?" prompt. Used wherever a credit is being spent (the job
 *  runner, the sync ideas/analysis requests) so nobody walks away from a
 *  generation by accident. In-app navigation is deliberately NOT blocked
 *  for the job runner — it lives in the root layout and survives it. */
export function useLeaveWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
