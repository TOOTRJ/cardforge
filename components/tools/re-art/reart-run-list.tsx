import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatShortDate } from "@/lib/format/dates";
import type { ReartRun } from "@/lib/tools/re-art/server";

/**
 * Re-art's recent runs: when, a sample or the deck, how many cards were
 * painted. On the tool page each names its deck (a link to its studio).
 * No hooks: drawn by the server page and by the studio alike.
 */
export function ReartRunList({
  runs,
  showDeck = false,
}: {
  runs: Array<ReartRun & { deckTitle?: string | null }>;
  showDeck?: boolean;
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
              <span className="text-foreground">{formatShortDate(run.createdAt)}</span>
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
            <span className="text-muted tabular-nums">
              {run.made} of {run.cards} painted
              {run.failed > 0 ? ` · ${run.failed} didn't` : ""}
              {run.waiting > 0 && run.status === "generating" ? ` · ${run.waiting} waiting` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
