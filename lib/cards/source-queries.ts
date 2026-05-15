import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Scryfall source-tracking queries (Phase 11 chunk 13).
//
// Two queries:
//   - countPublicRemixesBySource — for the "Also remixed by N others"
//     chip on a card's public detail page. Excludes the current card so
//     the count is "OTHER remixes," not "all remixes including this one."
//   - listPublicRemixesBySource — not yet used in the UI; ready for a
//     future "Lineage" view on the source card. Kept here for symmetry.
//
// Both queries filter to public + unlisted visibilities so a private
// remix doesn't bump the counter. RLS would also block reads, but the
// explicit filter makes the query intent clear.
// ---------------------------------------------------------------------------

export async function countPublicRemixesBySource(
  scryfallId: string,
  excludeCardId?: string,
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  if (!scryfallId) return 0;
  try {
    const supabase = await createClient();
    let query = supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("source_scryfall_id", scryfallId)
      .in("visibility", ["public", "unlisted"]);
    if (excludeCardId) {
      query = query.neq("id", excludeCardId);
    }
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
