import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CAPPED_DECK_VISIBILITIES } from "@/lib/billing/plans";
import type { DeckCapacity } from "@/lib/billing/deck-capacity-copy";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The owner's private + unlisted decks — what the cap counts (0145). Null
 *  when the count can't be read (never a made-up 0). */
export async function countCappedDecks(supabase: Supabase, ownerId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from("decks")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .in("visibility", [...CAPPED_DECK_VISIBILITIES]);
  if (error) return null;
  return count ?? 0;
}

/**
 * The signed-in user's private + unlisted decks against their plan cap — for
 * the meter (My Decks) and the warnings the create flow and the deck details
 * form show BEFORE a deck is made or turned private. The database enforces
 * the same cap (migration 0145); this is the friendly layer in front of it,
 * like getCardCapacity is for saved cards. Null when signed out, Supabase
 * isn't configured, or the count fails.
 */
export async function getDeckCapacity(): Promise<DeckCapacity | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const entitlements = await getEntitlements();
  try {
    const used = await countCappedDecks(await createClient(), user.id);
    if (used === null) return null;
    return { used, cap: entitlements.deckCapacity, tier: entitlements.effectiveTier };
  } catch {
    return null;
  }
}
