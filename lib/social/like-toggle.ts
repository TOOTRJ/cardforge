import "server-only";

import { revalidatePath } from "next/cache";
import type { Database } from "@/types/supabase";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { USERNAME_PATTERN } from "@/lib/auth/usernames";
import { SLUG_PATTERN } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// ONE like toggle for cards, decks and sets. The three "use server" modules
// (lib/cards/likes.ts, lib/decks/likes.ts, lib/sets/likes.ts) are thin
// wrappers that only differ in the table and the paths to revalidate — they
// used to be three self-described "mirror" copies whose revalidation
// policies had drifted apart.
//
// Race-safety comes from the (user_id, <fk>) unique constraint: a double
// like becomes one row (the 23505 branch), an unlike of nothing is a no-op.
// The count is re-read from the source table after every write so the
// optimistic UI (<QuickLikeButton>) reconciles against the truth, never a
// trigger-synced denormalised column that might lag.
//
// Listing pages are deliberately NOT purged on a like — the ISR window
// absorbs that churn (lib/cards/revalidate.ts). Only the liked thing's own
// page and the owner's profile are busted.
// ---------------------------------------------------------------------------

export type ToggleLikeResult =
  | { ok: true; liked: boolean; likes_count: number }
  | { ok: false; error: string };

type LikeTable = "card_likes" | "deck_likes" | "set_likes";

export type LikeTarget = {
  table: LikeTable;
  /** The FK column naming the liked row. */
  column: "card_id" | "deck_id" | "set_id";
  /** "card" | "deck" | "set" — for the error copy. */
  noun: string;
  /** Paths to revalidate. Both arguments are already shape-checked (null
   *  when the client-supplied value wasn't a well-formed slug / handle). */
  paths: (slug: string | null, ownerUsername: string | null) => string[];
};

/** Both values come from the client; only well-formed ones become paths (a
 *  stray string here would revalidate an arbitrary route). */
function safeSlug(value: string | undefined): string | null {
  return value && SLUG_PATTERN.test(value) ? value : null;
}
function safeUsername(value: string | null | undefined): string | null {
  return value && USERNAME_PATTERN.test(value) ? value : null;
}

export async function toggleLike(
  target: LikeTarget,
  id: string,
  slug?: string,
  ownerUsername?: string | null,
): Promise<ToggleLikeResult> {
  if (!isUuid(id)) {
    return { ok: false, error: `Invalid ${target.noun} id.` };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase isn't configured." };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: `You must be signed in to like ${target.noun}s.` };
  }

  const supabase = await createClient();
  // The three like tables share one shape (id, user_id, <fk>, created_at);
  // typing the builder through card_likes keeps every other column checked
  // while the FK column goes through the string-typed .filter() overload.
  const likes = () => supabase.from(target.table as "card_likes");

  const settle = async (liked: boolean): Promise<ToggleLikeResult> => {
    const { count } = await likes()
      .select("id", { count: "exact", head: true })
      .filter(target.column, "eq", id);
    for (const path of target.paths(safeSlug(slug), safeUsername(ownerUsername))) {
      revalidatePath(path);
    }
    return { ok: true, liked, likes_count: count ?? 0 };
  };

  const { data: existing } = await likes()
    .select("id")
    .eq("user_id", user.id)
    .filter(target.column, "eq", id)
    .maybeSingle();

  if (existing) {
    const { error } = await likes().delete().eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return settle(false);
  }

  // Insert. RLS rejects this when the user can't read the liked row (someone
  // else's private card) thanks to the `exists` check in the policy.
  const row = {
    user_id: user.id,
    [target.column]: id,
  } as unknown as Database["public"]["Tables"]["card_likes"]["Insert"];
  const { error } = await likes().insert(row);
  if (error) {
    // Unique-constraint race: the row appeared between SELECT and INSERT.
    if (error.code === "23505") return settle(true);
    return { ok: false, error: error.message };
  }
  return settle(true);
}
