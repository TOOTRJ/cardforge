import "server-only";

import { getCurrentProfile } from "@/lib/supabase/server";

/** AI-generated cards credit the GENERATING user as the artist (owner
 *  decision, 2026-07-11) — the art is painted for them, and a blank credit
 *  rendered "Art: Unknown" on every AI card. React-cached profile read, so
 *  batch steps don't pay an extra query each. */
export async function aiArtistCredit(): Promise<string | undefined> {
  const profile = await getCurrentProfile();
  const name = profile?.display_name?.trim() || profile?.username?.trim() || "";
  return name ? name.slice(0, 120) : undefined;
}
