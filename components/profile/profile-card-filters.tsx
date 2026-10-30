"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Loader2, Search, X } from "lucide-react";
import {
  CARD_TYPE_LABELS,
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_LABELS,
  COLOR_IDENTITY_VALUES,
  type CardType,
  type ColorIdentity,
} from "@/types/card";
import { ManaPip } from "@/components/cards/mana-pip";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { useSearchParamPatch } from "@/lib/routing/use-search-param-patch";
import {
  PROFILE_CARD_SORT_LABELS,
  PROFILE_CARD_SORTS,
  parseProfileCardParams,
} from "@/lib/profile/card-params";

// ---------------------------------------------------------------------------
// ProfileCardFilters — search, colour, type and order for the "All cards"
// section of a profile. URL-as-state (useSearchParamPatch: every change
// drops `page`); the server page queries list_profile_cards from the new
// query string, so the results are the database's, not a client filter of
// one page.
// ---------------------------------------------------------------------------

const COLOR_TO_PIP: Record<ColorIdentity, string> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "C",
  multicolor: "M",
};

const COLOR_OPTIONS: ChipOption<ColorIdentity | "all">[] = [
  { value: "all", label: "All colours" },
  ...COLOR_IDENTITY_VALUES.map((color) => ({
    value: color,
    label: COLOR_IDENTITY_LABELS[color],
    leading: <ManaPip symbol={COLOR_TO_PIP[color]} size="sm" />,
  })),
];

const selectClass =
  "h-11 w-full appearance-none rounded-lg border border-border bg-surface pl-3 pr-9 text-sm font-medium text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function ProfileCardFilters() {
  const searchParams = useSearchParams();
  const params = parseProfileCardParams(Object.fromEntries(searchParams.entries()));
  const { patch, isPending } = useSearchParamPatch();

  // Typing never refetches: the box keeps its own text and re-syncs when
  // the URL changes underneath it (back / forward, "Clear").
  const [input, setInput] = useState(params.q);
  const [synced, setSynced] = useState(params.q);
  if (params.q !== synced) {
    setInput(params.q);
    setSynced(params.q);
  }

  const anyActive = Boolean(params.q || params.color || params.type || params.sort !== "recent");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
        <form
          role="search"
          className="relative"
          onSubmit={(event) => {
            event.preventDefault();
            patch({ q: input.trim() || null });
          }}
        >
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Search by card name or nickname"
            aria-label="Search this creator's cards"
            maxLength={150}
            className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-10 text-sm text-foreground shadow-sm placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          {isPending ? (
            <Loader2
              className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted"
              aria-hidden
            />
          ) : input ? (
            <button
              type="button"
              onClick={() => {
                setInput("");
                patch({ q: null });
              }}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-elevated hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>
        <label className="relative">
          <span className="sr-only">Card type</span>
          <select
            value={params.type ?? ""}
            onChange={(event) => patch({ type: event.target.value || null })}
            className={selectClass}
          >
            <option value="">All types</option>
            {CARD_TYPE_VALUES.map((type: CardType) => (
              <option key={type} value={type}>
                {CARD_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
        </label>
        <label className="relative">
          <span className="sr-only">Order</span>
          <select
            value={params.sort}
            onChange={(event) => patch({ sort: event.target.value === "recent" ? null : event.target.value })}
            className={selectClass}
          >
            {PROFILE_CARD_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {PROFILE_CARD_SORT_LABELS[sort]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChipGroup
          ariaLabel="Colour"
          size="sm"
          keepCase
          value={params.color ?? "all"}
          onChange={(next) => patch({ color: next === "all" ? null : next })}
          options={COLOR_OPTIONS}
        />
        {anyActive ? (
          <button
            type="button"
            onClick={() => {
              setInput("");
              patch({ q: null, color: null, type: null, sort: null });
            }}
            className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-elevated hover:text-foreground"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
