"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Set likes — mirror of lib/cards/likes.ts. Toggling via the
// (user_id, set_id) unique constraint stays race-safe; we recount after
// each write so the optimistic UI in <QuickLikeButton> can reconcile.
// ---------------------------------------------------------------------------

export type ToggleSetLikeResult =
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

async function recountSetLikes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  setId: string,
): Promise<number> {
  const { count } = await supabase
    .from("set_likes")
    .select("id", { count: "exact", head: true })
    .eq("set_id", setId);
  return count ?? 0;
}

function revalidateSetLikePaths(
  setSlug: string | undefined,
  ownerUsername: string | null | undefined,
) {
  revalidatePath("/sets");
  revalidatePath("/dashboard");
  if (setSlug) {
    revalidatePath(`/set/${setSlug}`);
  }
  if (ownerUsername) {
    revalidatePath(`/profile/${ownerUsername}`);
  }
}

export async function toggleSetLikeAction(
  setId: string,
  setSlug?: string,
  ownerUsername?: string | null,
): Promise<ToggleSetLikeResult> {
  if (!UUID_PATTERN.test(setId)) {
    return { ok: false, error: "Invalid set id." };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to like sets." };
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("set_likes")
    .select("id")
    .eq("user_id", user.id)
    .eq("set_id", setId)
    .maybeSingle();

  if (existing) {
    const { error: deleteErr } = await supabase
      .from("set_likes")
      .delete()
      .eq("id", existing.id);
    if (deleteErr) {
      return { ok: false, error: deleteErr.message };
    }
    const count = await recountSetLikes(supabase, setId);
    revalidateSetLikePaths(setSlug, ownerUsername);
    return { ok: true, liked: false, likes_count: count };
  }

  const { error: insertErr } = await supabase
    .from("set_likes")
    .insert({ user_id: user.id, set_id: setId });

  if (insertErr) {
    // Unique-constraint race: row appeared between SELECT and INSERT.
    if (insertErr.code === "23505") {
      const count = await recountSetLikes(supabase, setId);
      revalidateSetLikePaths(setSlug, ownerUsername);
      return { ok: true, liked: true, likes_count: count };
    }
    return { ok: false, error: insertErr.message };
  }

  const count = await recountSetLikes(supabase, setId);
  revalidateSetLikePaths(setSlug, ownerUsername);
  return { ok: true, liked: true, likes_count: count };
}
