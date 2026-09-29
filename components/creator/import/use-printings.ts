"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PrintingSummary,
  PrintingView,
  PrintingsResponse,
} from "@/lib/scryfall/printing-views";

// ---------------------------------------------------------------------------
// usePrintings(oracleId, view) — one oracle card's printings for the import
// dialog's grid (TODO 1.5; the Art panel's "Use art from a real card", 1.15,
// reuses it). Pages through /api/scryfall/printings with "Load more".
//
// Each (oracle id, view) is fetched once and cached for the dialog's
// lifetime: clicking another printing of the same card, or flipping back to
// a filter already seen, never spends another Scryfall search. State is
// derived from the cache during render — the effect only starts fetches, and
// every setState lands in a fetch callback.
// ---------------------------------------------------------------------------

type Entry = {
  items: PrintingSummary[];
  /** The last page fetched (1-based). */
  page: number;
  hasMore: boolean;
  total: number;
  loadingMore: boolean;
  error: string | null;
};

export type UsePrintingsResult = {
  printings: PrintingSummary[];
  /** The first page is in flight. */
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** Scryfall's count for the whole view. */
  total: number;
  error: string | null;
  /** The next page — or, after a failed first page, that page again. */
  loadMore: () => void;
};

const keyOf = (oracleId: string, view: PrintingView) => `${oracleId}|${view}`;

type PageResult =
  | { ok: true; items: PrintingSummary[]; hasMore: boolean; total: number }
  | { ok: false; error: string };

async function fetchPage(oracleId: string, view: PrintingView, page: number): Promise<PageResult> {
  try {
    const response = await fetch(
      `/api/scryfall/printings?${new URLSearchParams({
        oracle_id: oracleId,
        view,
        page: String(page),
      })}`,
    );
    const body = (await response.json().catch(() => null)) as PrintingsResponse | null;
    if (!body || body.ok !== true || !Array.isArray(body.printings)) {
      return {
        ok: false,
        error: (body && body.ok === false && body.error) || "Couldn't load the printings.",
      };
    }
    return {
      ok: true,
      items: body.printings,
      hasMore: body.has_more === true,
      total: body.total_cards ?? body.printings.length,
    };
  } catch {
    return { ok: false, error: "Couldn't load the printings." };
  }
}

export function usePrintings(
  oracleId: string | null | undefined,
  view: PrintingView,
): UsePrintingsResult {
  const [cache, setCache] = useState<Record<string, Entry>>({});
  const inFlight = useRef(new Set<string>());
  // A response that lands after the dialog closed is dropped. Responses for
  // a filter the user already left still land — in their own cache slot, so
  // coming back to that filter costs no second search.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const key = oracleId ? keyOf(oracleId, view) : null;
  const entry = key ? cache[key] : undefined;

  useEffect(() => {
    if (!oracleId || !key || entry || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    void fetchPage(oracleId, view, 1).then((result) => {
      inFlight.current.delete(key);
      if (!mounted.current) return;
      setCache((prev) => ({
        ...prev,
        [key]: result.ok
          ? {
              items: result.items,
              page: 1,
              hasMore: result.hasMore,
              total: result.total,
              loadingMore: false,
              error: null,
            }
          : { items: [], page: 0, hasMore: false, total: 0, loadingMore: false, error: result.error },
      }));
    });
  }, [oracleId, view, key, entry]);

  const loadMore = useCallback(() => {
    if (!oracleId || !key || !entry || entry.loadingMore) return;
    // A failed first page (page 0 + error) retries through here too.
    const failedFirst = entry.page === 0 && entry.error !== null;
    if (!entry.hasMore && !failedFirst) return;
    const nextPage = entry.page + 1;
    setCache((prev) => ({ ...prev, [key]: { ...prev[key]!, loadingMore: true, error: null } }));
    void fetchPage(oracleId, view, nextPage).then((result) => {
      if (!mounted.current) return;
      setCache((prev) => {
        const current = prev[key];
        if (!current) return prev;
        if (!result.ok) {
          return { ...prev, [key]: { ...current, loadingMore: false, error: result.error } };
        }
        const seen = new Set(current.items.map((p) => p.id));
        return {
          ...prev,
          [key]: {
            items: current.items.concat(result.items.filter((p) => !seen.has(p.id))),
            page: nextPage,
            hasMore: result.hasMore,
            total: result.total || current.total,
            loadingMore: false,
            error: null,
          },
        };
      });
    });
  }, [oracleId, view, key, entry]);

  return {
    printings: entry?.items ?? [],
    loading: Boolean(key) && !entry,
    loadingMore: entry?.loadingMore ?? false,
    hasMore: entry?.hasMore ?? false,
    total: entry?.total ?? 0,
    error: entry?.error ?? null,
    loadMore,
  };
}
