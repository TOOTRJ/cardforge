import { toast } from "sonner";

// ---------------------------------------------------------------------------
// An admin control's failure (audit L5): the toast the admin sees AND a
// console line, so a refused action leaves a trace in the browser's console
// (and in a session replay) instead of a toast that vanishes after four
// seconds. Client-side; server actions log their own side.
// ---------------------------------------------------------------------------

export function adminErrorToast(where: string, message: string, cause?: unknown): void {
  if (cause === undefined) console.error(`[admin] ${where}:`, message);
  else console.error(`[admin] ${where}:`, message, cause);
  toast.error(message);
}
