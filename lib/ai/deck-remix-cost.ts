"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { batchCardLimit } from "@/lib/ai/generation-limits";

/**
 * What a deck remix will charge: one credit per remixable entry, capped at
 * the batch limit — the same sizing the job route uses for its pre-check,
 * so the confirmation dialog shows the real number.
 */
export async function getDeckRemixCost(deckId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const user = await getCurrentUser();
  if (!user) return 0;
  const supabase = await createClient();
  const [{ count }, limit] = await Promise.all([
    supabase
      .from("deck_cards")
      .select("*", { count: "exact", head: true })
      .eq("deck_id", deckId)
      .or("card_id.not.is.null,scryfall_id.not.is.null"),
    batchCardLimit(),
  ]);
  // 0 remixable entries (or a deck RLS hides) shows "1 card" — the route
  // refuses such a job before charging anything.
  return Math.max(1, Math.min(limit, count ?? 1));
}
