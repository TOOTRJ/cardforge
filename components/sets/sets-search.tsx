"use client";

import { useCallback, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";

// SetsSearch — a title/description search box for the public sets browse. Drives
// the ?q= param; the server page re-queries listPublicSets on change. Mirrors
// the gallery search input so the two browse surfaces feel the same.
export function SetsSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const searchParam = searchParams.get("q") ?? "";
  const [value, setValue] = useState(searchParam);
  const [lastSynced, setLastSynced] = useState(searchParam);
  if (searchParam !== lastSynced) {
    setValue(searchParam);
    setLastSynced(searchParam);
  }

  const apply = useCallback(
    (q: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (q) next.set("q", q);
      else next.delete("q");
      // A new search resets pagination to page 1.
      next.delete("page");
      const qs = next.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        apply(value.trim() || null);
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
            apply(null);
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
