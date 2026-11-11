import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A LIST's table on /admin/analytics (referred friends, most viewed cards):
// AnalyticsTable's look — the same hairlines, sizes and text tokens — with
// each column's alignment its own. A chart's twin has one name and then
// numbers, so AnalyticsTable sets everything after the first column right,
// in the number face; a list has names, dates and words in the middle, and
// those read from the left in the text face. Put it in a <TablePanel>: the
// panel scrolls it sideways on a phone.
// ---------------------------------------------------------------------------

export type ListColumn = {
  label: ReactNode;
  /** "number" = right-aligned in the number face (counts, days). */
  kind?: "text" | "number";
};

export function ListTable({
  caption,
  columns,
  rows,
  className,
}: {
  caption: string;
  columns: ListColumn[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  className?: string;
}) {
  return (
    // `relative`: the sr-only caption's containing block stays inside the
    // panel's sideways scroller.
    <table className={cn("relative w-full border-collapse text-left text-xs", className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-subtle">
          {columns.map((column, index) => (
            <th
              key={index}
              scope="col"
              className={cn("whitespace-nowrap py-1.5 pr-4 font-medium last:pr-0", column.kind === "number" && "text-right")}
            >
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border/50 last:border-0">
            {row.cells.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row" className="whitespace-nowrap py-1.5 pr-4 font-normal text-foreground">
                  {cell}
                </th>
              ) : (
                <td
                  key={index}
                  className={cn(
                    "whitespace-nowrap py-1.5 pr-4 text-muted last:pr-0",
                    columns[index]?.kind === "number" && "text-right font-mono tabular-nums",
                  )}
                >
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A person, as a link to their admin page: "@handle", or the start of the
 *  id for an account with no readable handle. */
export function PersonLink({ userId, username }: { userId: string; username: string | null }) {
  return (
    <Link href={`/admin/users?u=${userId}`} className="font-medium text-primary-bright hover:underline">
      {username ? `@${username}` : userId.slice(0, 8)}
    </Link>
  );
}
