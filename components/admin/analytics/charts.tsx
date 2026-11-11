import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { DeckChartCard } from "@/components/decks/deck-chart-card";
import { DataTable } from "@/components/decks/deck-chart-parts";
import { niceTicks } from "@/components/admin/tools/usage-chart";
import { formatUtcDate } from "@/lib/format/dates";
import { changeOf, changeText, formatCount, type DayPoint } from "@/lib/admin/analytics/series";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The analytics page's chart pieces — server-rendered HTML + CSS, no chart
// library and no client code of their own.
//
// The rules they hold (so a tab never restates them):
//   - ONE hue. Every chart here is a single series in --color-chart-1 (the
//     validated token); a second measure is a second chart, never a second
//     axis, and nominal categories are ranked bars in that one hue — never
//     a colour per category, never a colour by value.
//   - Thin marks: a column is at most 24 px wide with a 4 px rounded top on
//     a square baseline; a ranked bar is 8 px. Gridlines are solid
//     hairlines.
//   - Text wears text tokens, never the data colour.
//   - Every chart sits in a <ChartCard> beside its TABLE twin (the card's
//     Table switch; the table is what a screen reader gets), so a hover
//     tooltip only ever repeats what the table holds.
//   - A number is a tile, not a one-bar chart: <KpiTile>.
// ---------------------------------------------------------------------------

/** A chart with its table twin and the Table switch (the decks' card). */
export function ChartCard({
  title,
  description,
  chart,
  table,
  footer,
  className,
}: {
  title: string;
  description?: ReactNode;
  chart: ReactNode;
  table: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return <DeckChartCard title={title} description={description} chart={chart} table={table} footer={footer} className={className} />;
}

/** A table: a chart's twin, or a list in its own right. */
export { DataTable as AnalyticsTable };

/** A titled block of a tab. */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <header>
        <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 max-w-[70ch] text-sm leading-6 text-muted">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** A plain bordered box for a table that is not a chart's twin. */
export function TablePanel({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border/70 bg-surface/80 p-4 sm:p-5">
      <header>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-xs leading-5 text-muted">{description}</p> : null}
      </header>
      <div className="min-w-0 overflow-x-auto">{children}</div>
    </section>
  );
}

/** "Nothing here yet", in a chart's or a table's place. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted">{children}</p>;
}

/**
 * One headline number, with how it compares with the period before. The
 * change is a signed figure with an arrow and its words — never colour
 * alone — and `upIsGood` only picks the arrow's tint.
 */
export function KpiTile({
  label,
  value,
  current,
  previous,
  previousLabel,
  upIsGood = true,
  hint,
}: {
  label: string;
  /** The value as shown ("1,284", "$420.00"). */
  value: string;
  /** The numbers behind it, when there is a previous period to compare. */
  current?: number;
  previous?: number;
  /** "the previous 30 days". */
  previousLabel?: string;
  upIsGood?: boolean;
  hint?: ReactNode;
}) {
  const change = current !== undefined && previous !== undefined ? changeOf(current, previous) : null;
  const Arrow = change?.direction === "up" ? ArrowUpRight : change?.direction === "down" ? ArrowDownRight : Minus;
  const good = change && change.direction !== "flat" ? (change.direction === "up") === upIsGood : null;
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-card border border-border/70 bg-surface/70 p-4">
      <dt className="text-xs font-medium uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="text-2xl font-semibold text-foreground">{value}</dd>
      {change ? (
        <dd className="flex items-center gap-1 text-xs text-muted">
          <Arrow
            className={cn("h-3.5 w-3.5 shrink-0", good === true && "text-foreground", good === false && "text-danger", good === null && "text-subtle")}
            aria-hidden
          />
          <span>
            <span className="font-medium text-foreground">{changeText(change)}</span>
            {previousLabel ? ` vs ${previousLabel}` : null}
            {previous !== undefined ? ` (${formatCount(previous)})` : null}
          </span>
        </dd>
      ) : null}
      {hint ? <dd className="text-xs text-subtle">{hint}</dd> : null}
    </div>
  );
}

/** A row of tiles. */
export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6", className)}>{children}</dl>;
}

/**
 * One measure per UTC day — a single-series column chart. `points` are
 * zero-filled by the caller (lib/admin/analytics/series.ts fillDays), oldest
 * first. The whole column is the hover target; the tooltip leads with the
 * value. Put it in a <ChartCard> with <DailyTable> as its twin.
 */
export function DailyColumns({
  points,
  unit,
  formatValue = formatCount,
}: {
  points: DayPoint[];
  /** What a value counts, singular and plural: ["signup", "signups"]. */
  unit: readonly [string, string];
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const middle = points[Math.floor((points.length - 1) / 2)];
  if (points.length === 0 || total === 0) return <EmptyNote>No {unit[1]} in this period.</EmptyNote>;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex h-44 gap-3">
        <div className="flex w-10 shrink-0 flex-col-reverse justify-between text-right font-mono text-[10px] tabular-nums text-subtle">
          {ticks.map((tick) => (
            <span key={tick} className="-mb-1.5 leading-3">
              {formatValue(tick)}
            </span>
          ))}
        </div>
        <div className="relative flex min-w-0 flex-1 items-end gap-[2px] border-b border-border">
          {ticks.slice(1).map((tick) => (
            <span key={tick} className="pointer-events-none absolute inset-x-0 border-t border-border/40" style={{ bottom: `${(tick / top) * 100}%` }} />
          ))}
          {points.map((point, index) => (
            <div key={point.day} className="group relative flex h-full min-w-0 flex-1 items-end justify-center">
              <div
                className="w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity group-hover:opacity-75"
                style={{ height: point.value === 0 ? 0 : `max(2px, ${(point.value / top) * 100}%)` }}
              />
              <div
                className={cn(
                  "pointer-events-none absolute bottom-full z-10 mb-2 hidden whitespace-nowrap rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs shadow-lg group-hover:block",
                  // Kept inside the plot at both ends.
                  index < points.length / 4 ? "left-0" : index > (points.length * 3) / 4 ? "right-0" : "left-1/2 -translate-x-1/2",
                )}
              >
                <p className="font-semibold text-foreground">
                  {formatValue(point.value)} {point.value === 1 ? unit[0] : unit[1]}
                </p>
                <p className="text-muted">{formatUtcDate(point.day, "short")}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-between pl-[3.25rem] font-mono text-[10px] text-subtle">
        <span>{formatUtcDate(points[0].day, "short")}</span>
        {points.length > 14 && middle ? <span>{formatUtcDate(middle.day, "short")}</span> : null}
        <span>{formatUtcDate(points[points.length - 1].day, "short")}</span>
      </div>
    </div>
  );
}

/** A daily chart's table twin: newest day first, quiet days left out. */
export function DailyTable({
  points,
  caption,
  column,
  formatValue = formatCount,
}: {
  points: DayPoint[];
  caption: string;
  /** The value column's heading ("Signups"). */
  column: string;
  formatValue?: (value: number) => string;
}) {
  const rows = [...points].reverse().filter((p) => p.value !== 0);
  if (rows.length === 0) return <EmptyNote>Nothing in this period.</EmptyNote>;
  return (
    <div className="max-h-72 overflow-auto">
      <DataTable
        caption={caption}
        columns={["Day (UTC)", column]}
        rows={rows.map((p) => ({ key: p.day, cells: [formatUtcDate(p.day, "short"), formatValue(p.value)] }))}
      />
    </div>
  );
}

export type RankedRow = {
  key: string;
  label: ReactNode;
  value: number;
  /** Beside the value: a share, a rate ("63% of signups"). */
  note?: string;
};

/**
 * Named things compared on one baseline — horizontal bars in one hue,
 * in the order given (rank them, or keep a funnel's own order). The value
 * is printed at each bar, so nothing is read from colour or from hovering.
 * Its table twin is <RankedTable>.
 */
export function RankedBars({
  rows,
  formatValue = formatCount,
  max,
  empty = "Nothing in this period.",
}: {
  rows: RankedRow[];
  formatValue?: (value: number) => string;
  /** The value a full-width bar stands for (default: the largest row). */
  max?: number;
  empty?: string;
}) {
  if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  const top = Math.max(1, max ?? Math.max(...rows.map((row) => row.value)));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-x-3 text-xs">
          <span className="truncate text-foreground">{row.label}</span>
          <span className="flex h-2 min-w-0 items-center">
            <span
              className="h-2 rounded-r-[4px] bg-chart-1"
              style={{ width: row.value <= 0 ? 0 : `max(2px, ${Math.min(100, (row.value / top) * 100)}%)` }}
            />
          </span>
          <span className="whitespace-nowrap text-right font-mono tabular-nums text-foreground">
            {formatValue(row.value)}
            {row.note ? <span className="text-subtle"> · {row.note}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The table twin of <RankedBars>. */
export function RankedTable({
  rows,
  caption,
  columns,
  formatValue = formatCount,
}: {
  rows: RankedRow[];
  caption: string;
  /** [the thing, the value, the note] — the third only when rows carry notes. */
  columns: readonly [string, string] | readonly [string, string, string];
  formatValue?: (value: number) => string;
}) {
  if (rows.length === 0) return <EmptyNote>Nothing in this period.</EmptyNote>;
  const withNote = columns.length === 3;
  return (
    <DataTable
      caption={caption}
      columns={[...columns]}
      rows={rows.map((row) => ({
        key: row.key,
        cells: withNote ? [row.label, formatValue(row.value), row.note ?? "—"] : [row.label, formatValue(row.value)],
      }))}
    />
  );
}
