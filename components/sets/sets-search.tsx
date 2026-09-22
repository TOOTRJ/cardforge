"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { useSearchParamPatch } from "@/lib/routing/use-search-param-patch";

// SetsSearch — a title/description search box for the public sets browse. Drives
// the ?q= param; the server page re-queries listPublicSets on change. Mirrors
// the gallery search input so the two browse surfaces feel the same.
export function SetsSearch() {
  const searchParams = useSearchParams();
  const { patch, isPending } = useSearchParamPatch();

  const searchParam = searchParams.get("q") ?? "";
  const [value, setValue] = useState(searchParam);
  const [lastSynced, setLastSynced] = useState(searchParam);
  if (searchParam !== lastSynced) {
    setValue(searchParam);
    setLastSynced(searchParam);
  }

  return (
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
        placeholder="Search sets by name or description"
        aria-label="Search sets"
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
  );
}
