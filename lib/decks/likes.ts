"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Deck likes — mirror of lib/sets/likes.ts. Toggling via the
// (user_id, deck_id) unique constraint stays race-safe; we recount after
// each write so the optimistic UI in <QuickLikeButton> can reconcile.
// (decks.likes_count is trigger-synced for listings; the recount here reads
// the source table so the response never races the trigger.)
// ---------------------------------------------------------------------------

export type ToggleDeckLikeResult =
  | {
      ok: true;
      liked: boolean;
      likes_count: number;
    }
  | {
      ok: false;
      error: string;
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function recountDeckLikes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  deckId: string,
): Promise<number> {
  const { count } = await supabase
    .from("deck_likes")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", deckId);
  return count ?? 0;
}

function revalidateDeckLikePaths(
  deckSlug: string | undefined,
  ownerUsername: string | null | undefined,
) {
  revalidatePath("/decks");
  revalidatePath("/dashboard");
  if (deckSlug) {
    revalidatePath(`/deck/${deckSlug}`);
  }
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
  }
}

export async function toggleDeckLikeAction(
  deckId: string,
  deckSlug?: string,
  ownerUsername?: string | null,
): Promise<ToggleDeckLikeResult> {
  if (!UUID_PATTERN.test(deckId)) {
    return { ok: false, error: "Invalid deck id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to like decks." };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("deck_likes")
    .select("id")
    .eq("user_id", user.id)
    .eq("deck_id", deckId)
    .maybeSingle();

  if (existing) {
    const { error: deleteErr } = await supabase
      .from("deck_likes")
      .delete()
      .eq("id", existing.id);
    if (deleteErr) {
      return { ok: false, error: deleteErr.message };
    }
    const count = await recountDeckLikes(supabase, deckId);
    revalidateDeckLikePaths(deckSlug, ownerUsername);
    return { ok: true, liked: false, likes_count: count };
  }

  const { error: insertErr } = await supabase
    .from("deck_likes")
    .insert({ user_id: user.id, deck_id: deckId });

  if (insertErr) {
    // Unique-constraint race: row appeared between SELECT and INSERT.
    if (insertErr.code === "23505") {
      const count = await recountDeckLikes(supabase, deckId);
      revalidateDeckLikePaths(deckSlug, ownerUsername);
      return { ok: true, liked: true, likes_count: count };
    }
    return { ok: false, error: insertErr.message };
  }

  const count = await recountDeckLikes(supabase, deckId);
  revalidateDeckLikePaths(deckSlug, ownerUsername);
  return { ok: true, liked: true, likes_count: count };
}
