// ---------------------------------------------------------------------------
// PostgREST answers an un-ranged select with at most `max_rows` rows
// (supabase/config.toml: 1000; production's is the project's own setting)
// and says nothing about the rest — a deck past 1000 entries, an account
// export past 1000 cards, silently cut short. A read that must be COMPLETE
// pages through `.range()` with this helper. The caller's query must ORDER
// BY a unique key (an id last), or rows can repeat or go missing between
// pages.
// ---------------------------------------------------------------------------

/** The page asked for. A server whose max_rows is smaller answers fewer rows
 *  per page; the helper then just takes more pages. */
export const POSTGREST_MAX_ROWS = 1000;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  /** Present when the query asked for `{ count: "exact" }`. */
  count?: number | null;
};

export type AllRowsResult<T> = {
  data: T[];
  error: { message: string } | null;
};

/**
 * Read every row: `page(from, to)` builds the ordered query with
 * `.range(from, to)`. The next page starts after the rows actually received
 * (never after the size asked for: a smaller max_rows must not skip rows),
 * and the read ends on an EMPTY page — or, when the query asked for
 * `{ count: "exact" }`, as soon as that many rows are in (saving the empty
 * page's round trip). A failed page, or more than `maxRows` rows (a safety
 * stop for a runaway loop, never reached by real data), is an ERROR: this
 * never hands back part of a table as if it were all of it.
 */
export async function selectAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<AllRowsResult<T>> {
  const pageSize = options.pageSize ?? POSTGREST_MAX_ROWS;
  const maxRows = options.maxRows ?? 100_000;
  const rows: T[] = [];
  for (;;) {
    const { data, error, count } = await page(rows.length, rows.length + pageSize - 1);
    if (error) return { data: rows, error };
    const batch = data ?? [];
    if (batch.length === 0) return { data: rows, error: null };
    rows.push(...batch);
    if (typeof count === "number" && rows.length >= count) return { data: rows, error: null };
    if (rows.length > maxRows) {
      return {
        data: rows,
        error: { message: `read stopped after ${maxRows.toLocaleString("en-US")} rows` },
      };
    }
  }
}

/** Split ids for `.in(…)` filters: 100 uuids are ~3.8 KB of query string,
 *  which with the rest of a PostgREST URL (its select, order and range)
 *  stays well under the 8 KB request line many proxies cap (200 ids
 *  measured 7.9 KB). */
export function chunkIds<T>(ids: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}
