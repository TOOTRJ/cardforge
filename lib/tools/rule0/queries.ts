import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { viaDeckLink } from "@/lib/decks/deck-link";
import type { TableSheetRow } from "./model";

// ---------------------------------------------------------------------------
// deck_table_sheets reads (migration 0190) — as the VIEWER: the owner reads
// their row while the tool is open to them; anyone else only a SHARED row of
// a deck that reads for them, while the tool is open to the deck's owner
// (the read policy). The request names the deck (viaDeckLink): an unlisted
// deck's sheet reads only for a request that names it, as its page does.
// ---------------------------------------------------------------------------

const COLUMNS = "deck_id, game_plan, win_conditions, table_notes, shared, ai_drafted_at, updated_at";

type Row = {
  deck_id: string;
  game_plan: string | null;
  win_conditions: string | null;
  table_notes: string | null;
  shared: boolean;
  ai_drafted_at: string | null;
  updated_at: string | null;
};

export function tableSheetFromRow(row: Row): TableSheetRow {
  return {
    deckId: row.deck_id,
    gamePlan: row.game_plan,
    winConditions: row.win_conditions,
    tableNotes: row.table_notes,
    shared: row.shared,
    aiDraftedAt: row.ai_drafted_at,
    updatedAt: row.updated_at,
  };
}

/** The deck's sheet as this viewer may read it; null = none (or not theirs
 *  to read). `deckLink` is the deck's slug or id as the request named it. */
export async function getTableSheet(deckId: string, deckLink: string): Promise<TableSheetRow | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await viaDeckLink(
      supabase.from("deck_table_sheets").select(COLUMNS).eq("deck_id", deckId),
      deckLink,
    ).maybeSingle();
    if (error) {
      // A database 0190 hasn't reached (42P01) reads as "no sheet".
      if (error.code !== "42P01") console.warn("[rule0] sheet read failed:", error.message);
      return null;
    }
    return data ? tableSheetFromRow(data as Row) : null;
  } catch {
    return null;
  }
}

/** The owner's sheets, by deck id (the tool page's list). */
export async function listMyTableSheets(ownerId: string): Promise<Map<string, TableSheetRow>> {
  if (!isSupabaseConfigured()) return new Map();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("deck_table_sheets").select(COLUMNS).eq("owner_id", ownerId);
    if (error) return new Map();
    return new Map(((data ?? []) as Row[]).map((row) => [row.deck_id, tableSheetFromRow(row)]));
  } catch {
    return new Map();
  }
}
