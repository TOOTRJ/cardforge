import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { LocalDate } from "@/components/ui/local-date";
import type { ReartRun } from "@/lib/tools/re-art/server";

/**
 * Re-art's recent runs: when, a sample or the deck, how many cards were
 * painted. On the tool page each names its deck (a link to its studio). In
 * the studio each run that painted a card can be undone (`onUndo`).
 * No hooks: drawn by the server page and by the studio alike.
 */
export function ReartRunList({
  runs,
  showDeck = false,
  onUndo,
  undoHeld = false,
}: {
  runs: Array<ReartRun & { deckTitle?: string | null }>;
  showDeck?: boolean;
  /** Opens "Undo this run" (the studio's list). Absent: not offered. */
  onUndo?: (run: ReartRun) => void;
  /** A run is painting: an undo waits. */
  undoHeld?: boolean;
}) {
  return (
    <section aria-labelledby="reart-runs" className="flex flex-col gap-3">
      <h2 id="reart-runs" className="font-display text-lg text-foreground">
        Recent runs
      </h2>
      <ul className="flex flex-col divide-y divide-border/50 rounded-lg border border-border/60">
        {runs.map((run) => (
          <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              {/* The run's date also describes its Undo button. */}
              <span id={`reart-run-when-${run.id}`}>
                <LocalDate iso={run.createdAt} format="short" className="text-foreground" />
              </span>
              {showDeck && run.deckId ? (
                <Link
                  href={`/dashboard/tools/re-art-deck?deck=${run.deckId}`}
                  className="truncate text-primary-bright underline-offset-2 hover:underline"
                >
                  {run.deckTitle ?? "A deck"}
                </Link>
              ) : null}
              {run.sample ? <Badge variant="outline">Sample</Badge> : null}
              {run.status === "cancelled" ? <Badge variant="outline">Closed</Badge> : null}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted tabular-nums">
              <span>
                {run.made} of {run.cards} painted
                {run.failed > 0 ? ` · ${run.failed} didn't` : ""}
                {run.waiting > 0 && run.status === "generating" ? ` · ${run.waiting} waiting` : ""}
              </span>
              {onUndo && run.made > 0 ? (
                <button
                  type="button"
                  data-reart-undo={run.id}
                  onClick={() => {
                    if (!undoHeld) onUndo(run);
                  }}
                  aria-disabled={undoHeld ? true : undefined}
                  aria-describedby={`reart-run-when-${run.id}`}
                  className={
                    undoHeld
                      ? "cursor-not-allowed rounded-sm text-xs underline-offset-2 opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                      : "rounded-sm text-xs text-primary-bright underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                  }
                >
                  Undo this run…
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
