import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The one inline "couldn't load" state of an admin page (audit L5): a read
// that FAILED says so, never an empty state that reads as "nothing here".
// The query that failed logs the error itself (console.error, the server
// log); this only tells the admin the list below is not the whole truth.
// ---------------------------------------------------------------------------

export function AdminLoadError({ what, className }: { what: string; className?: string }) {
  return (
    <div
      role="alert"
      data-testid="admin-load-error"
      className={cn(
        "flex items-start gap-3 rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm leading-6 text-foreground",
        className,
      )}
    >
      <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-danger" aria-hidden />
      <p className="min-w-0">
        <strong className="mr-1">Couldn&rsquo;t load {what}.</strong>
        What shows here may be incomplete — reload to try again. The error is in the server log.
      </p>
    </div>
  );
}
