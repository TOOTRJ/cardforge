import "server-only";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

// ---------------------------------------------------------------------------
// Owner-handle lookups. `owner_id` columns reference auth.users, not
// profiles, so PostgREST can't join the handle in — every path that needs
// `/card/[username]/…` or `/profile/[username]` after a write does this one
// small read. The signed-in user's OWN handle is `getCurrentUsername()` in
// lib/supabase/server.ts (cached per request).
// ---------------------------------------------------------------------------

/** Any server-side client: cookie-bound, public (anon) or service-role. */
export type ProfileClient = SupabaseClient<Database>;

/** profiles.username for a user id — null when unknown or on any read
 *  error. Callers treat the handle as optional: a path without it is still
 *  valid (the slug-only card URL redirects). */
export async function lookupUsername(
  supabase: ProfileClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .maybeSingle();
    return data?.username ?? null;
  } catch {
    return null;
  }
}

/** Bust the user's public profile page (ISR) after something it shows
 *  changed — pinned cards, avatar/banner, deck card counts. Best-effort. */
export async function revalidateProfilePage(
  supabase: ProfileClient,
  userId: string,
): Promise<void> {
  const username = await lookupUsername(supabase, userId);
  if (username) revalidatePath(`/profile/${username}`);
}
