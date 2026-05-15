"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export type ToggleLikeResult =
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

async function recountLikes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cardId: string,
): Promise<number> {
  const { count } = await supabase
    .from("card_likes")
    .select("id", { count: "exact", head: true })
    .eq("card_id", cardId);
  return count ?? 0;
}

/**
 * Toggle the current user's like on a card.
 *
 * Idempotent against the (user_id, card_id) unique constraint — we don't
 * worry about race conditions: a double-like becomes a single row, and an
 * unlike of nothing becomes a no-op. The action infers the resulting
 * state by looking at whether the user has a row after the operation and
 * returns the fresh count for optimistic-UI confirmation.
 */
export async function toggleLikeAction(
  cardId: string,
  cardSlug?: string,
): Promise<ToggleLikeResult> {
  if (!UUID_PATTERN.test(cardId)) {
    return { ok: false, error: "Invalid card id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to like cards." };
  }

  const supabase = await createClient();

  // Look up the existing like (if any).
  const { data: existing } = await supabase
    .from("card_likes")
    .select("id")
    .eq("user_id", user.id)
    .eq("card_id", cardId)
    .maybeSingle();

  if (existing) {
    const { error: deleteErr } = await supabase
      .from("card_likes")
      .delete()
      .eq("id", existing.id);
    if (deleteErr) {
      return { ok: false, error: deleteErr.message };
    }
    const count = await recountLikes(supabase, cardId);
    if (cardSlug) {
      revalidatePath(`/card/${cardSlug}`);
    }
    return { ok: true, liked: false, likes_count: count };
  }

  // Insert. RLS rejects this if the user can't read the underlying card
  // (e.g. someone else's private card) thanks to the `exists` check in the
  // policy.
  const { error: insertErr } = await supabase
    .from("card_likes")
    .insert({ user_id: user.id, card_id: cardId });

  if (insertErr) {
    // Unique-constraint race (the user double-clicked + the row appeared
    // between SELECT and INSERT). Recompute and treat as already liked.
    if (insertErr.code === "23505") {
      const count = await recountLikes(supabase, cardId);
      if (cardSlug) {
        revalidatePath(`/card/${cardSlug}`);
      }
      return { ok: true, liked: true, likes_count: count };
    }
    return { ok: false, error: insertErr.message };
  }

  const count = await recountLikes(supabase, cardId);
  if (cardSlug) {
    revalidatePath(`/card/${cardSlug}`);
  }
  return { ok: true, liked: true, likes_count: count };
}
