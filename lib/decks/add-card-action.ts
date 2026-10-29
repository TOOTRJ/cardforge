"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { addCustomCardEntryToDeck } from "@/lib/decks/membership";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// "Add from my cards" (TODO DK4.4: the empty deck's third door, and the
// commander slot's "pick one of my cards") — one of the owner's OWN cards
// into their deck as a new entry, ×1, through the same locked RPC the
// creator's deck picker uses (lib/decks/membership.ts, migration 0143 /
// 0144: the entry says it came by `link`). Already in the deck → nothing
// is added, and the answer says so. The commander slot asks for the
// commander zone: the card's mainboard entry — the one just added, or the
// one the deck already had — moves there.
//
// The full add box (search my cards, PipGlyph cards and real cards — TODO
// DK5.2) replaces the dialog that calls this; the action stays its "my
// card" path.
// ---------------------------------------------------------------------------

export type AddMyCardResult =
  /** `added`: a new entry; `commander`: the card is now in the commander
   *  zone (a commander pick — new, or moved from the mainboard). */
  | { ok: true; added: boolean; commander: boolean; title: string }
  | { ok: false; error: string };

export async function addMyCardToDeckAction(
  deckId: string,
  cardId: string,
  board: "main" | "commander" = "main",
): Promise<AddMyCardResult> {
  if (!isUuid(deckId) || !isUuid(cardId)) return { ok: false, error: "Invalid card or deck." };
  if (board !== "main" && board !== "commander") return { ok: false, error: "Invalid board." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase isn't configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  // One of the caller's own cards (the RPC also takes another creator's
  // public card, D3 — that is the add box's, not this door's).
  const { data: card } = await supabase.from("cards").select("id, owner_id, title").eq("id", cardId).maybeSingle();
  if (!card || card.owner_id !== user.id) return { ok: false, error: "That card isn't one of yours." };

  const result = await addCustomCardEntryToDeck(supabase, user.id, deckId, cardId, card.title, { source: "link" });
  if (!result.ok) return { ok: false, error: result.error ?? "Couldn't add the card." };
  const added = Boolean(result.added);
  if (board === "main") return { ok: true, added, commander: false, title: card.title };

  // The commander pick: the card's mainboard entry moves to the commander
  // zone — the one just added, or the one the deck already had (a picked
  // commander left on the mainboard with "already in this deck" was the
  // independent check's L2 of #671). A card that already is the commander,
  // or sits only on another board, stays where it is.
  const { data: moved, error } = await supabase
    .from("deck_cards")
    .update({ board: "commander" })
    .eq("deck_id", deckId)
    .eq("card_id", cardId)
    .eq("board", "main")
    .select("id");
  if (error) {
    return {
      ok: false,
      error: added
        ? `Added ${card.title}, but couldn't make it the commander: ${error.message}`
        : `Couldn't make ${card.title} the commander: ${error.message}`,
    };
  }
  const commander = (moved ?? []).length > 0;
  if (commander && result.deckSlug) revalidatePath(`/deck/${result.deckSlug}`);
  return { ok: true, added, commander, title: card.title };
}
