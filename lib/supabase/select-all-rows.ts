// ---------------------------------------------------------------------------
// PostgREST answers an un-ranged select with at most `max_rows` rows
// (supabase/config.toml: 1000; production's is the same default) and says
// nothing about the rest — a deck past 1000 entries, an account export past
// 1000 cards, silently cut short. A read that must be COMPLETE pages through
// `.range()` with this helper. The caller's query must ORDER BY a unique key
// (an id last), or rows can repeat or go missing between pages.
// ---------------------------------------------------------------------------

/** The page size: PostgREST's own cap, so a short page means the last one. */
export const POSTGREST_MAX_ROWS = 1000;

type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

export type AllRowsResult<T> = {
  data: T[];
  error: { message: string } | null;
};

/**
 * Read every row: `page(from, to)` builds the ordered query with
 * `.range(from, to)`. Stops at the first short page, at an error (returned,
 * with the rows read so far), or after `maxRows` (a safety stop for a
 * runaway loop, never reached by real data).
 */
export async function selectAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<AllRowsResult<T>> {
  const pageSize = options.pageSize ?? POSTGREST_MAX_ROWS;
  const maxRows = options.maxRows ?? 100_000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: rows, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return { data: rows, error: null };
}

/** Split ids for `.in(…)` filters: a few hundred uuids per request keeps the
 *  URL well inside every proxy's limit. */
export function chunkIds<T>(ids: T[], size = 200): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}
