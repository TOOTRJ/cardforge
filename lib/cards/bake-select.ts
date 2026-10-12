// ---------------------------------------------------------------------------
// The bake's column list across the deploy of migration 0137 (TODO 3b.16).
//
// BAKE_SELECT_COLUMNS names `printed_types`. On a merge Vercel builds while
// Supabase applies the migration, and Supabase's runner sometimes fails
// silently (docs/ENVIRONMENTS.md §4): with the new code live on a database
// that has no such column yet, PostgREST answers every one of these reads
// with 42703 — no save bake, no automatic re-bake (three failed runs pause
// the sweep), no admin frame previews — for as long as the column is
// missing. A row from before the column prints the BUILT line, which is
// exactly what a read without the column gives, so that one error is
// answered by reading the same rows without it.
//
// Nothing else is tolerated: any other error comes back as it is, and a save
// that STORES a typed line still fails loudly until the column exists (it is
// never dropped silently).
//
// Remove once 0137 is on production and on the dev database.
// ---------------------------------------------------------------------------

import { BAKE_SELECT_COLUMNS } from "@/lib/cards/bake-core";

const COLUMN = "printed_types";

/** BAKE_SELECT_COLUMNS for a database from before migration 0137. */
export function bakeSelectColumnsWithout0137(): string {
  return BAKE_SELECT_COLUMNS.split(/,\s*/)
    .filter((column) => column !== COLUMN)
    .join(", ");
}

/** True for PostgREST's "column cards.printed_types does not exist". */
export function isMissing0137Column(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return error?.code === "42703" && (error.message ?? "").includes(COLUMN);
}

/**
 * Runs a read of the bake's columns: `run` is given BAKE_SELECT_COLUMNS and,
 * only when the database answers that `printed_types` does not exist, is run
 * once more with the list from before 0137.
 */
export async function selectBakeColumns<R extends { error: { code?: string | null; message?: string | null } | null }>(
  run: (columns: string) => PromiseLike<R>,
): Promise<R> {
  const first = await run(BAKE_SELECT_COLUMNS);
  return isMissing0137Column(first.error) ? run(bakeSelectColumnsWithout0137()) : first;
}
