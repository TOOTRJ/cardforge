"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Loader2, Search, X } from "lucide-react";
import { ChipGroup, type ChipOption } from "@/components/ui/chip-group";
import { DECK_FORMAT_LABELS, DECK_FORMAT_VALUES, isDeckFormat, type DeckFormat } from "@/types/deck";
import { useSearchParamPatch } from "@/lib/routing/use-search-param-patch";

// DecksSearch — the public decks browse's controls (/decks/browse only; the
// static /decks landing hosts none, lib/routing/browse-params.ts): the
// search box, the sort (recent / most liked / most viewed — the orders
// listPublicDecks already takes) and the format chips (the shared ChipGroup,
// one radio group). Drives ?q= / ?sort= / ?format=; every change starts on
// page 1 (useSearchParamPatch) and keeps the rest — a profile's ?owner=
// filter included (the page draws its own "Every creator" clear link).

type FormatChoice = DeckFormat | "all";

const FORMAT_OPTIONS: ChipOption<FormatChoice>[] = [
  { value: "all", label: "All formats" },
  ...DECK_FORMAT_VALUES.map((format) => ({ value: format, label: DECK_FORMAT_LABELS[format] })),
];

type Sort = "recent" | "popular" | "viewed";

const SORT_LABELS: Record<Sort, string> = {
  recent: "Recently updated",
  popular: "Most liked",
  viewed: "Most viewed",
};

function readSort(value: string | null): Sort {
  return value === "popular" || value === "viewed" ? value : "recent";
}

export function DecksSearch() {
  const searchParams = useSearchParams();
  const { patch, isPending } = useSearchParamPatch();

  const searchParam = searchParams.get("q") ?? "";
  const formatParam = searchParams.get("format");
  const activeFormat = isDeckFormat(formatParam) ? formatParam : null;
  const sort = readSort(searchParams.get("sort"));

  const [value, setValue] = useState(searchParam);
  const [lastSynced, setLastSynced] = useState(searchParam);
  if (searchParam !== lastSynced) {
    setValue(searchParam);
    setLastSynced(searchParam);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            patch({ q: value.trim() || null });
          }}
          className="relative flex w-full max-w-md items-center"
        >
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            type="search"
            placeholder="Search decks by name or description"
            aria-label="Search decks"
            className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-9 text-sm text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />
          {value ? (
            <button
              type="button"
              onClick={() => {
                setValue("");
                patch({ q: null });
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:bg-elevated hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          ) : null}
          {isPending ? (
            <Loader2
              className="absolute -right-6 h-3.5 w-3.5 animate-spin text-muted"
              aria-hidden
            />
          ) : null}
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>

        <div className="relative sm:ml-auto">
          <label className="sr-only" htmlFor="decks-sort">
            Sort decks
          </label>
          <select
            id="decks-sort"
            value={sort}
            onChange={(event) => {
              const next = readSort(event.target.value);
              patch({ sort: next === "recent" ? null : next });
            }}
            className="h-10 w-full appearance-none rounded-md border border-border bg-surface pl-3 pr-9 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-auto"
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((option) => (
              <option key={option} value={option}>
                {SORT_LABELS[option]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
        </div>
      </div>

      <ChipGroup
        ariaLabel="Filter by format"
        value={activeFormat ?? "all"}
        onChange={(next) => patch({ format: next === "all" ? null : next })}
        options={FORMAT_OPTIONS}
        keepCase
      />
    </div>
  );
}
