"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// useSearchParamPatch — URL-as-state for the browse surfaces (gallery, decks,
// decks). Every filter/sort/search change is one `patch()`; the server page
// re-queries from the new query string.
// ---------------------------------------------------------------------------

/** `null` or "" deletes the key, a string sets it, `undefined` leaves it. */
export type SearchParamPatch = Record<string, string | null | undefined>;

/**
 * Patch the current URL's query string in place (`router.replace`, no
 * scroll). Every patch also drops `page` — a changed filter is a new result
 * set and must start on page 1 (the gallery used to keep a stale page) —
 * plus any `alsoReset` keys the caller names (the gallery's discover seed).
 * `isPending` is the transition flag for a spinner.
 */
export function useSearchParamPatch(options: { alsoReset?: readonly string[] } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // Callers pass array literals; keying the callback on the joined string
  // keeps `patch` referentially stable across renders.
  const resetKey = (options.alsoReset ?? []).join(",");

  const patch = useCallback(
    (entries: SearchParamPatch) => {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("page");
      for (const key of resetKey ? resetKey.split(",") : []) next.delete(key);
      for (const [key, value] of Object.entries(entries)) {
        if (value === undefined) continue;
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const queryString = next.toString();
      const href = queryString ? `${pathname}?${queryString}` : pathname;
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router, pathname, searchParams, resetKey],
  );

  return { patch, isPending };
}
