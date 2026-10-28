// ---------------------------------------------------------------------------
// The bake's column list across the deploys of migrations 0137 and 0141
// (TODO 3b.16 `printed_types`, TODO 6.3 `nickname`).
//
// BAKE_SELECT_COLUMNS names both. On a merge Vercel builds while Supabase
// applies the migration, and Supabase's runner sometimes fails silently
// (docs/ENVIRONMENTS.md §4): with the new code live on a database that has
// no such column yet, PostgREST answers every one of these reads with 42703
// — no save bake, no automatic re-bake (three failed runs pause the sweep),
// no admin frame previews — for as long as the column is missing. A row
// from before the column prints exactly what a read without the column
// gives (the BUILT type line; no nickname), so that one error is answered
// by reading the same rows without it.
//
// Nothing else is tolerated: any other error comes back as it is, and a save
// that STORES a typed line or a nickname still fails loudly until the column
// exists (it is never dropped silently).
//
// Remove each column from LATE_COLUMNS once its migration is on production
// and on the dev database.
// ---------------------------------------------------------------------------

import { BAKE_SELECT_COLUMNS } from "@/lib/cards/bake-core";
import type { ScopeCard } from "@/lib/cards/layout-version";

/** The bake's columns a database may not have yet, newest last. */
const LATE_COLUMNS = ["printed_types", "nickname"] as const;
type LateColumn = (typeof LATE_COLUMNS)[number];

const COLUMN_0137: LateColumn = "printed_types";

function columnsWithout(dropped: readonly string[]): string {
  return BAKE_SELECT_COLUMNS.split(/,\s*/)
    .filter((column) => !dropped.includes(column))
    .join(", ");
}

/** BAKE_SELECT_COLUMNS for a database from before migration 0137. */
export function bakeSelectColumnsWithout0137(): string {
  return columnsWithout([COLUMN_0137]);
}

/** The late column PostgREST says does not exist ("column
 *  cards.<name> does not exist", 42703), or null for any other answer. */
export function missingLateColumn(error: { code?: string | null; message?: string | null } | null | undefined): LateColumn | null {
  if (error?.code !== "42703") return null;
  const message = error.message ?? "";
  return LATE_COLUMNS.find((column) => message.includes(column)) ?? null;
}

/** True for PostgREST's "column cards.printed_types does not exist". */
export function isMissing0137Column(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return missingLateColumn(error) === COLUMN_0137;
}

/**
 * Runs a read of the bake's columns: `run` is given BAKE_SELECT_COLUMNS and,
 * only while the database answers that one of the late columns does not
 * exist, is run again without it (each late column dropped at most once).
 */
export async function selectBakeColumns<R extends { error: { code?: string | null; message?: string | null } | null }>(
  run: (columns: string) => PromiseLike<R>,
): Promise<R> {
  const dropped: LateColumn[] = [];
  let result = await run(BAKE_SELECT_COLUMNS);
  for (;;) {
    const missing = missingLateColumn(result.error);
    if (!missing || dropped.includes(missing)) return result;
    dropped.push(missing);
    result = await run(columnsWithout(dropped));
  }
}

// ---------------------------------------------------------------------------
// The SCOPE readers' columns: the scans that judge stored bakes against the
// card-scoped bumps (VERSION_SCOPES in lib/cards/layout-version.ts) without
// baking — the daily "newer look" notification (render-update-notify.ts) and
// an override save's null stamps (frame-profile-override-actions.ts).
//
// A scope function reads a column the row does not carry as "can't judge →
// affected": a scan that forgets one reads EVERY card as owing that bump.
// For a sweep bump (v72's kerningGuardsChanged reads the nickname, the typed
// type words and the artist credit) that silences every opt-in badge
// (hasNewerLook) and makes an override save null-stamp cards that owe
// nothing. So both scans select ScopeCard's columns from this ONE list (a
// test holds it to ScopeCard's keys), and on a database without a late
// column (missingLateColumn) read again without it and give each row that
// column as NULL: what such a database holds, and what its bake prints.
// ---------------------------------------------------------------------------

/** Every column a card's layout scope reads (ScopeCard's keys). */
export const SCOPE_CARD_COLUMNS = [
  "rarity", "set_icon_url", "set_icon_code", "frame_style", "color_identity", "art_url",
  "title", "nickname", "supertype", "printed_types", "artist_credit", "card_type", "subtypes",
  "power", "toughness", "loyalty", "defense", "back_face", "rules_text", "flavor_text",
  "face_content", "cost", "art_position",
] as const satisfies readonly (keyof ScopeCard)[];

/**
 * Runs a scope scan: `run` is given `leading` (the scan's own columns: id,
 * stamp, render, visibility) followed by SCOPE_CARD_COLUMNS and, only while
 * the database answers that one of the late columns does not exist, is run
 * again without it (each dropped at most once). The rows it then returns
 * carry every dropped column as null.
 */
export async function selectScopeColumns<R extends { data: unknown; error: { code?: string | null; message?: string | null } | null }>(
  leading: string,
  run: (columns: string) => PromiseLike<R>,
): Promise<R> {
  const dropped: LateColumn[] = [];
  const columns = () =>
    [leading, ...SCOPE_CARD_COLUMNS.filter((column) => !(dropped as readonly string[]).includes(column))].join(", ");
  let result = await run(columns());
  for (;;) {
    const missing = missingLateColumn(result.error);
    if (!missing || dropped.includes(missing) || !(SCOPE_CARD_COLUMNS as readonly string[]).includes(missing)) break;
    dropped.push(missing);
    result = await run(columns());
  }
  if (dropped.length && !result.error && Array.isArray(result.data)) {
    for (const row of result.data as Record<string, unknown>[]) for (const column of dropped) row[column] = null;
  }
  return result;
}
