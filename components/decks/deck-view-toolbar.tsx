"use client";

import { useId } from "react";
import { CheckSquare, LayoutGrid, Layers, List, Sparkles, Table2 } from "lucide-react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import {
  DECK_GROUP_LABELS,
  DECK_GROUPS,
  DECK_SORT_LABELS,
  DECK_SORTS,
  DECK_VIEW_LABELS,
  DECK_VIEWS,
  type DeckGroupBy,
  type DeckSort,
  type DeckView,
  type DeckViewPrefs,
  type StatusFilter,
} from "@/lib/decks/deck-view";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// The deck list's toolbar (TODO DK5.3 / DK5.6 / DK5.12): the view (a
// ChipGroup — one tab stop, arrows move, Space / Enter picks), "Group by"
// and "Sort by" (native selects with their own labels), the status filter
// (a ChipGroup whose chips carry their counts — part of each chip's name),
// "custom cards ⇄ real cards" for a deck with PipGlyph cards in it, and —
// the owner's — Select (TODO DK5.4: the selection's way in that is no
// gesture, WCAG 2.5.7; a long press and Shift + click are the shortcuts).
// ---------------------------------------------------------------------------

const VIEW_ICONS: Record<DeckView, ChipOption<DeckView>["icon"]> = {
  stacks: Layers,
  grid: LayoutGrid,
  list: List,
  table: Table2,
};

const VIEW_OPTIONS: ChipOption<DeckView>[] = DECK_VIEWS.map((view) => ({
  value: view,
  label: DECK_VIEW_LABELS[view],
  icon: VIEW_ICONS[view],
}));

const SELECT_CLASS =
  "h-9 rounded-md border border-border bg-background/60 px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50";

export function DeckViewToolbar({
  prefs,
  onPrefs,
  filter,
  filterOptions,
  onFilter,
  proxyToggle,
  select = null,
}: {
  prefs: DeckViewPrefs;
  onPrefs: (patch: Partial<DeckViewPrefs>) => void;
  filter: StatusFilter;
  filterOptions: Array<{ value: StatusFilter; label: string; count: number }>;
  onFilter: (next: StatusFilter) => void;
  /** Null when the deck has no PipGlyph card to show instead of its printing. */
  proxyToggle: { showProxies: boolean; onToggle: () => void } | null;
  /** The owner's Select toggle (null for a visitor). */
  select?: { selecting: boolean; onToggle: () => void } | null;
}) {
  const groupId = useId();
  const sortId = useId();
  return (
    // One row where the width allows (the cards start higher), wrapping
    // control by control where it doesn't.
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-frame border border-border/60 bg-surface/60 p-3 sm:px-4">
      <ChipGroup ariaLabel="View" options={VIEW_OPTIONS} value={prefs.view} onChange={(view) => onPrefs({ view })} keepCase />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-2">
          <label htmlFor={groupId} className="text-xs font-medium text-muted">
            Group by
          </label>
          <select
            id={groupId}
            value={prefs.group}
            onChange={(event) => onPrefs({ group: event.target.value as DeckGroupBy })}
            className={SELECT_CLASS}
          >
            {DECK_GROUPS.map((group) => (
              <option key={group} value={group}>
                {DECK_GROUP_LABELS[group]}
              </option>
            ))}
          </select>
        </span>
        <span className="flex items-center gap-2">
          <label htmlFor={sortId} className="text-xs font-medium text-muted">
            Sort by
          </label>
          <select
            id={sortId}
            value={prefs.sort}
            onChange={(event) => onPrefs({ sort: event.target.value as DeckSort })}
            className={SELECT_CLASS}
          >
            {DECK_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {DECK_SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </span>
      </div>
      <ChipGroup
        ariaLabel="Filter by card status"
        options={filterOptions.map(({ value, label, count }) => ({
          value,
          label,
          // Part of the chip's name ("Imported 59"): cards, quantities summed.
          badge: (
            <span className="font-mono text-[11px] tabular-nums">
              <span className="sr-only"> </span>
              {count}
            </span>
          ),
        }))}
        value={filter}
        onChange={onFilter}
        keepCase
      />
      {proxyToggle || select ? (
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          {proxyToggle ? (
            <button
              type="button"
              onClick={proxyToggle.onToggle}
              aria-pressed={proxyToggle.showProxies}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              {proxyToggle.showProxies ? "Showing custom cards" : "Showing real cards"}
            </button>
          ) : null}
          {select ? (
            <button
              type="button"
              onClick={select.onToggle}
              aria-pressed={select.selecting}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 pointer-coarse:h-11",
                select.selecting
                  ? "border-primary bg-primary/15 text-primary-bright"
                  : "border-border text-muted hover:border-border-strong hover:text-foreground",
              )}
            >
              <CheckSquare className="h-3.5 w-3.5" aria-hidden />
              Select
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
