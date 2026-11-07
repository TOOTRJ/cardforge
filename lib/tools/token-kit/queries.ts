import "server-only";

import { createClient } from "@/lib/supabase/server";

/** One of the viewer's saved kits, for the Token Kit's "Recent kits". */
export type RecentTokenKit = {
  id: string;
  title: string;
  /** The deck it was built from (null: a pasted list, or a deck since
   *  deleted — then `sourceText` reopens it if it was a list). */
  deckId: string | null;
  sourceText: string | null;
  updatedAt: string;
  /** How many tokens the kit has choices for. */
  tokens: number;
};

/** The viewer's most recently changed kits (RLS: their own, while the tool
 *  is open to them). A kit with neither its deck nor a list can't be
 *  reopened and is left out. */
export async function listRecentTokenKits(ownerId: string, limit = 6): Promise<RecentTokenKit[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("token_kits")
      .select("id, title, deck_id, source_text, updated_at, items")
      .eq("owner_id", ownerId)
      // A kit whose deck was deleted names no source: never a "recent" slot.
      .or("deck_id.not.is.null,source_text.not.is.null")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data
      .filter((row) => row.deck_id || row.source_text)
      .map((row) => ({
        id: row.id,
        title: row.title ?? "Untitled kit",
        deckId: row.deck_id,
        sourceText: row.source_text,
        updatedAt: row.updated_at,
        tokens: row.items && typeof row.items === "object" ? Object.keys(row.items as object).length : 0,
      }));
  } catch {
    return [];
  }
}
