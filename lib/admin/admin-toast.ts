import { toast } from "sonner";

// ---------------------------------------------------------------------------
// An admin control's failure (audit L5): the toast the admin sees AND a
// console line, so a refused action leaves a trace in the browser's console
// (and in a session replay) instead of a toast that vanishes after four
// seconds. Client-side; server actions log their own side.
//
// console.WARN, never console.error: `next dev` captures every client
// console.error into its dev overlay ("Issues"), which renders the message a
// SECOND time on the page — the refusal then shows twice (the e2e pin spec's
// strict getByText caught it on #591), and an expected refusal is not a bug
// report. A warning stays in the console and out of the overlay.
// ---------------------------------------------------------------------------

export function adminErrorToast(where: string, message: string, cause?: unknown): void {
  if (cause === undefined) console.warn(`[admin] ${where}:`, message);
  else console.warn(`[admin] ${where}:`, message, cause);
  toast.error(message);
}
