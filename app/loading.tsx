import { Loader2 } from "lucide-react";

// Root-level loading UI shown while route segments resolve (server
// components fetching, route transitions, etc.). Keep it tiny — the UI
// shouldn't flash unnecessarily on fast requests.

export default function GlobalLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full items-center justify-center px-6 py-16 text-muted"
    >
      <span className="flex items-center gap-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading…
      </span>
    </div>
  );
}
