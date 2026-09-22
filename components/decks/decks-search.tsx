"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { DECK_FORMAT_LABELS, DECK_FORMAT_VALUES, isDeckFormat } from "@/types/deck";
import { cn } from "@/lib/utils";
import { useSearchParamPatch } from "@/lib/routing/use-search-param-patch";

// DecksSearch — search box + format filter chips for the public decks browse.
// Drives the ?q= / ?format= params; the server page re-queries
// listPublicDecks on change. Mirrors SetsSearch so the browse surfaces feel
// the same.
export function DecksSearch() {
  const searchParams = useSearchParams();
  const { patch, isPending } = useSearchParamPatch();

  const searchParam = searchParams.get("q") ?? "";
  const formatParam = searchParams.get("format");
  const activeFormat = isDeckFormat(formatParam) ? formatParam : null;

  const [value, setValue] = useState(searchParam);
  const [lastSynced, setLastSynced] = useState(searchParam);
  if (searchParam !== lastSynced) {
    setValue(searchParam);
    setLastSynced(searchParam);
  }

  return (
    <div className="flex flex-col gap-3">
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

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label="Filter by format"
      >
        <FormatChip
          label="All formats"
          active={activeFormat === null}
          onClick={() => patch({ format: null })}
        />
        {DECK_FORMAT_VALUES.map((format) => (
          <FormatChip
            key={format}
            label={DECK_FORMAT_LABELS[format]}
            active={activeFormat === format}
            onClick={() => patch({ format })}
          />
        ))}
      </div>
    </div>
  );
}

function FormatChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50",
        active
          ? "border-primary bg-primary/15 text-primary-bright"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
