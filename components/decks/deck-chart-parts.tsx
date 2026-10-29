import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { ManaPip } from "@/components/cards/mana-pip";
import type { ColorBalanceRow } from "@/lib/decks/deck-charts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck breakdown's chart pieces (TODO DK7.1 / DK7.3 / DK5.12) — plain
// markup, drawn on the server. One mark system (the dataviz rules): thin
// bars (8 px) grown from one baseline with a 4 px round data end and a
// square base, the series in `--color-chart-1` / `--color-chart-2` (a
// validated pair, app/globals.css), every label and value in TEXT colours —
// never the series colour — and a mana colour only where it MEANS a colour
// (the pip beside a colour's name). Every chart has a TABLE twin with the
// same numbers (DataTable): visually hidden beside the chart, or shown in
// its place by the card's "Table" switch (DeckChartCard).
// ---------------------------------------------------------------------------

/** A whole percent of a share (0–1); "<1%" for a sliver. */
export function percentOf(share: number): string {
  if (share <= 0) return "0%";
  const percent = share * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A chart's legend: a swatch per series (the mark's own shape), the name
 *  in text colour. */
export function ChartLegend({ items }: { items: Array<{ label: string; swatch: "chart-1" | "chart-2" }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("h-2.5 w-2.5 rounded-[2px]", item.swatch === "chart-1" ? "bg-chart-1" : "bg-chart-2")} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** One bar and the value at its tip, in a track that keeps `labelRoom` free
 *  for the value — the longest bar ends where its label still fits, so
 *  nothing runs past the card at 390 px. Never under 2 px when it holds
 *  anything. */
function Bar({
  value,
  max,
  labelRoom,
  className,
  children,
}: {
  value: number;
  max: number;
  labelRoom: string;
  className: string;
  children: ReactNode;
}) {
  const share = value > 0 && max > 0 ? value / max : 0;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span
        className={cn("h-2 shrink-0 rounded-r-[4px]", className)}
        style={{ width: share > 0 ? `max(2px, calc((100% - ${labelRoom}) * ${share.toFixed(4)}))` : "0" }}
      />
      <span className="min-w-0 whitespace-nowrap font-mono tabular-nums text-muted">{children}</span>
    </span>
  );
}

export type BarRowData = {
  key: string;
  label: string;
  count: number;
  /** Drawn before the label (a pip, a tag). */
  leading?: ReactNode;
  /** Drawn after the label (a kind tag). */
  tag?: string;
};

/** One series of nominal rows (types, rarity, status, keywords): one
 *  colour for every bar, the count and its share at the bar's end. */
export function HorizontalBars({ rows, total }: { rows: BarRowData[]; total: number }) {
  const max = rows.reduce((m, row) => Math.max(m, row.count), 0);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-x-3 text-xs sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          {/* A long label wraps (never an ellipsis a touch screen can't open). */}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-4">
            {row.leading}
            <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{row.label}</span>
            {row.tag ? <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] leading-4 text-subtle">{row.tag}</span> : null}
          </span>
          <Bar value={row.count} max={max} labelRoom="5rem" className="bg-chart-1">
            <span className="text-foreground">{row.count}</span>
            {total > 0 ? <span className="text-subtle"> · {percentOf(row.count / total)}</span> : null}
          </Bar>
        </li>
      ))}
    </ul>
  );
}

/** A chart's table twin: a caption, a header row, one row per item. */
export function DataTable({
  caption,
  columns,
  rows,
  className,
}: {
  caption: string;
  columns: ReactNode[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
  className?: string;
}) {
  return (
    <table className={cn("w-full border-collapse text-left text-xs", className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-subtle">
          {columns.map((column, index) => (
            <th key={index} scope="col" className={cn("py-1.5 pr-3 font-medium last:pr-0", index > 0 && "text-right")}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border/50 last:border-0">
            {row.cells.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row" className="py-1.5 pr-3 font-normal text-foreground">
                  {cell}
                </th>
              ) : (
                <td key={index} className="py-1.5 pr-3 text-right font-mono tabular-nums text-muted last:pr-0">
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

/** The table twin of a bar list. */
export function BarsTable({ caption, rows, total, label }: { caption: string; rows: BarRowData[]; total: number; label: string }) {
  return (
    <DataTable
      caption={caption}
      columns={[label, "Cards", "Share"]}
      rows={rows.map((row) => ({
        key: row.key,
        cells: [row.tag ? `${row.label} (${row.tag})` : row.label, row.count, total > 0 ? percentOf(row.count / total) : "—"],
      }))}
    />
  );
}

/** A colour well short of its share of the symbols in sources (10 points
 *  or more) — the hint under its row. */
export function sourcesTrail(row: ColorBalanceRow): boolean {
  return row.symbols > 0 && row.symbolShare - row.sourceShare >= 0.1;
}

/** Colour symbols against mana sources (DK7.1): per colour, its share of
 *  the symbols the costs ask for and of the sources that make it — two
 *  measures on ONE axis (shares), each with its count. */
export function ColorBalance({ rows }: { rows: ColorBalanceRow[] }) {
  const max = rows.reduce((m, row) => Math.max(m, row.symbolShare, row.sourceShare), 0);
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((row) => (
        <li key={row.color} className="grid grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] gap-x-3 text-xs">
          <span className="flex min-w-0 items-center gap-2 self-start pt-0.5">
            <ManaPip symbol={row.color} size="sm" className="shadow-none" />
            <span className="truncate text-foreground">{row.label}</span>
          </span>
          <span className="flex min-w-0 flex-col gap-1.5">
            <Bar value={row.symbolShare} max={max} labelRoom="8.5rem" className="bg-chart-1">
              <span className="text-foreground">{percentOf(row.symbolShare)}</span>
              <span className="text-subtle"> · {plural(row.symbols, "symbol")}</span>
            </Bar>
            <Bar value={row.sourceShare} max={max} labelRoom="8.5rem" className="bg-chart-2">
              <span className="text-foreground">{percentOf(row.sourceShare)}</span>
              <span className="text-subtle"> · {plural(row.sources, "source")}</span>
            </Bar>
            {sourcesTrail(row) ? (
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <AlertTriangle className="h-3 w-3 shrink-0 text-gold" aria-hidden />
                Fewer sources than its share of symbols
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The colour chart's table twin. */
export function ColorBalanceTable({ rows }: { rows: ColorBalanceRow[] }) {
  return (
    <DataTable
      caption="Color symbols in costs against mana sources, per color"
      columns={[
        "Color",
        "Symbols",
        <>
          Share<span className="sr-only"> of symbols</span>
        </>,
        "Sources",
        <>
          Share<span className="sr-only"> of sources</span>
        </>,
      ]}
      rows={rows.map((row) => ({
        key: row.color,
        cells: [
          sourcesTrail(row) ? `${row.label} (fewer sources than its share)` : row.label,
          row.symbols,
          percentOf(row.symbolShare),
          row.sources,
          percentOf(row.sourceShare),
        ],
      }))}
    />
  );
}

/** One headline number (the stat tile): a label, the value in the UI face
 *  with proportional figures, a line of context. */
export function StatTile({ label, value, detail, className }: { label: string; value: ReactNode; detail: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-card border border-border/70 bg-surface/80 p-4 sm:p-5", className)}>
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">{label}</span>
      <span className="text-3xl font-semibold tracking-tight text-foreground">{value}</span>
      <span className="text-xs leading-5 text-muted">{detail}</span>
    </div>
  );
}
