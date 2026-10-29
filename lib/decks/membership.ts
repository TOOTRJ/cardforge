import "server-only";

import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { revalidateProfilePage } from "@/lib/profile/username";
import { deckEntryLimitMessage } from "@/lib/decks/import-plan";

// ---------------------------------------------------------------------------
// Deck membership helper for the card-create flow: dropping a freshly saved
// custom card into a deck as a custom-only entry (mainboard, ×1). Called
// from createCardAction — best-effort, never fails the card save.
// ---------------------------------------------------------------------------

export async function addCustomCardEntryToDeck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckId: string,
  cardId: string,
  cardTitle: string,
): Promise<{ ok: boolean; deckSlug?: string; error?: string }> {
  // Ownership pre-flight (the RPC and RLS enforce it too; this yields the
  // slug for revalidation and a friendly failure).
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, owner_id")
    .eq("id", deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== userId) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  // Check-then-insert in ONE transaction under the deck's entry lock
  // (migration 0143): two saves racing into one deck — parallel AI deck
  // steps — can no longer both see "not in the deck yet", insert twice, or
  // take the same position. Already in the deck (any board) → no new entry;
  // the deck page is the place to adjust quantities.
  const { data: added, error } = await supabase.rpc("add_custom_deck_entry", {
    p_deck_id: deckId,
    p_card_id: cardId,
    p_name: cardTitle,
  });
  if (error) {
    return { ok: false, error: deckEntryLimitMessage(error) ?? error.message };
  }
  if (added === false) return { ok: true, deckSlug: deck.slug };

  revalidatePath(`/deck/${deck.slug}`);
  revalidatePath(`/deck/${deck.slug}/edit`);
  revalidatePath("/dashboard/decks");
  // Profile "Decks by X" tiles show card counts — membership changes them.
  await revalidateProfilePage(supabase, userId);

  return { ok: true, deckSlug: deck.slug };
}
