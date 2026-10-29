"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { ArrowUp, X } from "lucide-react";
import { ChartLegend, DataTable } from "@/components/decks/deck-chart-parts";
import { MANA_CURVE_ID, useDeckCurveFilter } from "@/components/decks/deck-curve-filter";
import type { CurveColumn } from "@/lib/decks/deck-charts";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The mana curve (TODO DK7.1): nonland cards by mana value, 0 … 7+, each
// column stacked — creatures at the base (chart-1), other spells on top
// (chart-2), a 2 px gap between, a 4 px round top, the total on the cap.
//
// A column is a real control: picking it (a click, Enter or Space) filters
// the deck list above to the cards it counts and takes the reader there
// (deck-curve-filter.tsx); the list's notice clears it or comes back here.
// The columns are ONE tab stop (a toolbar: the arrow keys, Home and End move
// between them), each named with its numbers — "Mana value 3: 15 cards, 9
// creatures and 6 other spells" — so the picture needs no hidden twin; an
// empty column is aria-disabled and says so. A hover or focus shows the
// same numbers as a tooltip (aria-hidden: the name already says them). Off
// the page's provider (a test, another surface) the curve is a picture with
// its table.
// ---------------------------------------------------------------------------

const valueName = (label: string) => (label.endsWith("+") ? `${label.slice(0, -1)} or more` : label);
const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

function columnName(column: CurveColumn, filterable: boolean): string {
  const head = `Mana value ${valueName(column.label)}`;
  if (column.total === 0) return `${head}: no cards`;
  const parts = `${column.creatures} creature${column.creatures === 1 ? "" : "s"} and ${column.other} other spell${column.other === 1 ? "" : "s"}`;
  return `${head}: ${cards(column.total)}, ${parts}${filterable ? ". Show them in the card list" : ""}`;
}

/** The curve's table twin. */
export function ManaCurveTable({ curve }: { curve: CurveColumn[] }) {
  return (
    <DataTable
      caption="Mana curve: nonland cards at each mana value, creatures and other spells"
      columns={["Mana value", "Creatures", "Other spells", "Total"]}
      rows={curve.map((column) => ({
        key: column.label,
        cells: [valueName(column.label), column.creatures, column.other, column.total],
      }))}
    />
  );
}

export function DeckManaCurve({ curve }: { curve: CurveColumn[] }) {
  const context = useDeckCurveFilter();
  const filterable = context !== null;
  const picked = context?.filter?.slot ?? null;
  const hintId = useId();
  const max = curve.reduce((m, column) => Math.max(m, column.total), 0);
  // The toolbar's one tab stop: the focused column while the focus is in
  // it, else the picked one, else the first that holds cards.
  const [focused, setFocused] = useState<number | null>(null);
  const firstFilled = curve.find((column) => column.total > 0)?.slot ?? 0;
  const tabStop = focused ?? picked ?? firstFilled;

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0 && event.key !== "Home" && event.key !== "End") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-curve-slot]")];
    const from = buttons.indexOf(event.target as HTMLElement);
    if (from < 0) return;
    const to = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.min(Math.max(from + step, 0), buttons.length - 1);
    event.preventDefault();
    buttons[to]?.focus();
  };

  const pick = (column: CurveColumn) => {
    if (!context || column.total === 0) return;
    context.show(column.slot);
  };

  const plot = (
    <div className="flex flex-col gap-3">
      <ChartLegend
        items={[
          { label: "Creatures", swatch: "chart-1" },
          { label: "Other spells", swatch: "chart-2" },
        ]}
      />
      <div
        id={filterable ? MANA_CURVE_ID : undefined}
        role={filterable ? "toolbar" : undefined}
        aria-label={filterable ? "Mana curve" : undefined}
        aria-describedby={filterable ? hintId : undefined}
        onKeyDown={filterable ? moveFocus : undefined}
        onFocus={(event) => {
          const slot = (event.target as HTMLElement).getAttribute("data-curve-slot");
          if (slot !== null) setFocused(Number(slot));
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null);
        }}
        className="flex h-52 items-stretch"
      >
        {curve.map((column, index) => {
          const height = max > 0 && column.total > 0 ? Math.max((column.total / max) * 100, 3) : 0;
          // The visible segments, base first; the top one wears the round end.
          const segments = [
            { key: "creatures", n: column.creatures, className: "bg-chart-1" },
            { key: "other", n: column.other, className: "bg-chart-2" },
          ].filter((segment) => segment.n > 0);
          const dimmed = picked !== null && picked !== column.slot;
          const empty = column.total === 0;
          const tooltipSide = index < 2 ? "left-0" : index > curve.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2";
          const body = (
            <>
              <span className="relative flex w-full flex-1 items-end justify-center border-b border-border px-1 pt-6">
                <span
                  className={cn("relative flex w-full max-w-6 flex-col-reverse gap-[2px] transition-opacity", dimmed && "opacity-35")}
                  style={{ height: `${height}%` }}
                >
                  {segments.map((segment, i) => (
                    <span
                      key={segment.key}
                      className={cn("w-full min-h-px", segment.className, i === segments.length - 1 && "rounded-t-[4px]")}
                      style={{ flex: `${segment.n} 1 0px` }}
                    />
                  ))}
                  {column.total > 0 ? (
                    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 font-mono text-[11px] tabular-nums text-muted">
                      {column.total}
                    </span>
                  ) : null}
                </span>
                {column.total > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute bottom-full z-20 mb-1 hidden w-max min-w-[8.5rem] flex-col gap-0.5 rounded-md border border-border bg-elevated px-2.5 py-2 text-left text-xs shadow-lg group-hover:flex group-focus-visible:flex",
                      tooltipSide,
                    )}
                  >
                    <span className="font-semibold text-foreground">{cards(column.total)}</span>
                    <span className="text-subtle">Mana value {column.label}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-muted">
                      <span className="h-0.5 w-3 rounded bg-chart-1" />
                      {column.creatures} creature{column.creatures === 1 ? "" : "s"}
                    </span>
                    <span className="flex items-center gap-1.5 text-muted">
                      <span className="h-0.5 w-3 rounded bg-chart-2" />
                      {column.other} other spell{column.other === 1 ? "" : "s"}
                    </span>
                  </span>
                ) : null}
              </span>
              <span className={cn("py-1.5 text-center text-xs tabular-nums", column.slot === picked ? "font-semibold text-foreground" : "text-subtle")}>
                {column.label}
              </span>
            </>
          );
          if (!filterable) {
            return (
              <div key={column.slot} className="flex min-w-0 flex-1 flex-col">
                {body}
              </div>
            );
          }
          return (
            <button
              key={column.slot}
              type="button"
              data-curve-slot={column.slot}
              tabIndex={column.slot === tabStop ? 0 : -1}
              aria-label={columnName(column, true)}
              aria-disabled={empty ? true : undefined}
              aria-current={column.slot === picked ? "true" : undefined}
              onClick={empty ? undefined : () => pick(column)}
              className={cn(
                "group relative flex min-w-0 flex-1 flex-col rounded-t-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-bright/70",
                empty ? "cursor-default" : "cursor-pointer hover:bg-foreground/[0.04]",
                column.slot === picked && "bg-foreground/[0.05]",
              )}
            >
              {body}
            </button>
          );
        })}
      </div>
      {filterable ? (
        <p id={hintId} className="text-xs leading-5 text-muted">
          Pick a bar to see its cards in the list above.
          <span className="sr-only"> The arrow keys move between the bars.</span>
        </p>
      ) : null}
      {context?.filter ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs">
          <span className="text-muted">
            The card list shows <span className="font-medium text-foreground">mana value {context.filter.label}</span>.
          </span>
          <span className="flex flex-wrap gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => context.filter && context.show(context.filter.slot)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 font-medium text-foreground transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
              Go to the list
            </button>
            <button
              type="button"
              onClick={() => context.clear("curve")}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 font-medium text-foreground transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear filter
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );

  if (filterable) return plot;
  // A picture with its table (no list to filter).
  return (
    <>
      <div aria-hidden>{plot}</div>
      <div className="sr-only">
        <ManaCurveTable curve={curve} />
      </div>
    </>
  );
}
