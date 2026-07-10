"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { DECK_BOARD_VALUES } from "@/types/deck";

// ---------------------------------------------------------------------------
// Deck entry actions — the deck-card modal's mutations: quantity/board
// edits, remove, and linking/unlinking a custom proxy card. Same
// discriminated-union posture as lib/decks/actions.ts.
// ---------------------------------------------------------------------------

export type DeckCardActionResult =
  | { ok: true; deckCardId: string }
  | { ok: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Load an entry + prove the caller owns its deck. Returns the deck slug
 *  for revalidation. */
async function getOwnedEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckCardId: string,
): Promise<
  | { ok: true; entry: { id: string; deck_id: string }; deckSlug: string }
  | { ok: false; error: string }
> {
  const { data: entry } = await supabase
    .from("deck_cards")
    .select("id, deck_id")
    .eq("id", deckCardId)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Deck entry not found." };

  const { data: deck } = await supabase
    .from("decks")
    .select("id, slug, owner_id")
    .eq("id", entry.deck_id)
    .maybeSingle();
  if (!deck || deck.owner_id !== userId) {
    return { ok: false, error: "Deck not found or not yours." };
  }
  return { ok: true, entry, deckSlug: deck.slug };
}

async function revalidateDeckCardPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deckSlug: string,
) {
  revalidatePath(`/deck/${deckSlug}`);
  revalidatePath(`/deck/${deckSlug}/edit`);
  revalidatePath("/dashboard/decks");
  revalidatePath("/decks");
  // The profile's "Decks by X" tiles show card counts + proxy % — entry
  // mutations change those numbers too.
  try {
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    if (data?.username) revalidatePath(`/profile/${data.username}`);
  } catch {
    // best-effort — ISR catches up on its own
  }
}

const updateDeckCardSchema = z
  .object({
    quantity: z.number().int().min(1).max(250).optional(),
    board: z.enum(DECK_BOARD_VALUES).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "No changes provided.",
  });

export async function updateDeckCardAction(
  deckCardId: string,
  payload: unknown,
): Promise<DeckCardActionResult> {
  if (!UUID_PATTERN.test(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  const parsed = updateDeckCardSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid change.",
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from("deck_cards")
    .update(parsed.data)
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

export async function removeDeckCardAction(
  deckCardId: string,
): Promise<DeckCardActionResult> {
  if (!UUID_PATTERN.test(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from("deck_cards")
    .delete()
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

/** Link one of the caller's custom cards as this entry's proxy. RLS also
 *  enforces card ownership (the deck_cards UPDATE policy checks it), but the
 *  pre-flight gives a friendlier error. */
export async function linkDeckCardAction(
  deckCardId: string,
  cardId: string,
): Promise<DeckCardActionResult> {
  if (!UUID_PATTERN.test(deckCardId) || !UUID_PATTERN.test(cardId)) {
    return { ok: false, error: "Invalid id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { data: card } = await supabase
    .from("cards")
    .select("id, owner_id")
    .eq("id", cardId)
    .maybeSingle();
  if (!card || card.owner_id !== user.id) {
    return {
      ok: false,
      error: "You can only link cards you own as proxies.",
    };
  }

  const { error } = await supabase
    .from("deck_cards")
    .update({ card_id: cardId })
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

export async function unlinkDeckCardAction(
  deckCardId: string,
): Promise<DeckCardActionResult> {
  if (!UUID_PATTERN.test(deckCardId)) {
    return { ok: false, error: "Invalid deck entry id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to edit decks." };

  const supabase = await createClient();
  const owned = await getOwnedEntry(supabase, user.id, deckCardId);
  if (!owned.ok) return owned;

  const { error } = await supabase
    .from("deck_cards")
    .update({ card_id: null })
    .eq("id", deckCardId);
  if (error) return { ok: false, error: error.message };

  await revalidateDeckCardPaths(supabase, user.id, owned.deckSlug);
  return { ok: true, deckCardId };
}

// ---------------------------------------------------------------------------
// Link picker data — a lite listing of the caller's cards, lazily fetched
// by the deck-card modal's "Link an existing card" panel.
// ---------------------------------------------------------------------------

export type MyCardLite = {
  id: string;
  title: string;
  slug: string;
  rendered_image_url: string | null;
};

export type ListMyCardsLiteResult =
  | { ok: true; cards: MyCardLite[] }
  | { ok: false; error: string };

export async function listMyCardsLiteAction(): Promise<ListMyCardsLiteResult> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cards")
    .select("id, title, slug, rendered_image_url")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: error.message };
  return { ok: true, cards: data ?? [] };
}
