import "server-only";

import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";

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
  // Ownership pre-flight (RLS enforces too; this yields the slug for
  // revalidation and a friendly failure).
  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, owner_id")
    .eq("id", deckId)
    .maybeSingle();
  if (!deck || deck.owner_id !== userId) {
    return { ok: false, error: "Deck not found or not yours." };
  }

  // Already in the deck (any board) → no duplicate entry; the deck
  // dashboard is the place to adjust quantities.
  const { data: existing } = await supabase
    .from("deck_cards")
    .select("id")
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: true, deckSlug: deck.slug };
  }

  const { data: positions } = await supabase
    .from("deck_cards")
    .select("position")
    .eq("deck_id", deckId)
    .order("position", { ascending: false })
    .limit(1);
  const nextPosition = (positions?.[0]?.position ?? -1) + 1;

  const { error } = await supabase.from("deck_cards").insert({
    deck_id: deckId,
    card_id: cardId,
    name: cardTitle,
    board: "main",
    quantity: 1,
    position: nextPosition,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/deck/${deck.slug}`);
  revalidatePath(`/deck/${deck.slug}/edit`);
  revalidatePath("/dashboard/decks");
  // Profile "Decks by X" tiles show card counts — membership changes them.
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    if (profile?.username) revalidatePath(`/profile/${profile.username}`);
  } catch {
    // best-effort
  }

  return { ok: true, deckSlug: deck.slug };
}
