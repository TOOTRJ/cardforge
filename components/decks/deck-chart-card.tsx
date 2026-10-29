"use client";

import { useId, useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// One chart of the deck breakdown (TODO DK7.1 / DK5.12): its title, a line
// of context, the chart — and its TABLE twin. The table is always there
// for a screen reader (visually hidden beside a picture-only chart, whose
// marks are hidden from assistive tech), and the card's "Table" switch
// shows it in the chart's place for anyone who'd rather read the numbers.
// A chart that is its own accessible control (the mana curve's bars, each
// named with its numbers) passes `accessibleChart`: nothing of it is hidden.
// ---------------------------------------------------------------------------

export function DeckChartCard({
  title,
  description,
  chart,
  table,
  accessibleChart = false,
  footer,
  className,
}: {
  title: string;
  description?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  accessibleChart?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col gap-4 rounded-card border border-border/70 bg-surface/80 p-4 sm:p-5", className)}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-semibold text-foreground">
            {title}
          </h3>
          {description ? <div className="mt-1 text-xs leading-5 text-muted">{description}</div> : null}
        </div>
        <button
          type="button"
          aria-pressed={asTable}
          aria-label={`Show ${title.toLowerCase()} as a table`}
          onClick={() => setAsTable((on) => !on)}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
            asTable
              ? "border-primary/60 bg-primary/15 text-primary-bright"
              : "border-border text-muted hover:border-border-strong hover:text-foreground",
          )}
        >
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          Table
        </button>
      </header>
      {asTable ? (
        table
      ) : accessibleChart ? (
        chart
      ) : (
        <>
          <div aria-hidden>{chart}</div>
          <div className="sr-only">{table}</div>
        </>
      )}
      {footer}
    </section>
  );
}
