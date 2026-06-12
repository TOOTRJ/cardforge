import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Challenge reads (Community Phase 1). Challenges are admin-authored rows;
// ENTRIES are simply public cards wearing the challenge's tag, fetched with
// the existing listPublicCardsRich({ tag }) — no join table. All reads
// fail soft (empty/null) so a DB hiccup never breaks the marketing shell.
// ---------------------------------------------------------------------------

export type Challenge = {
  id: string;
  slug: string;
  title: string;
  description: string;
  tag: string;
  hero_image_url: string | null;
  starts_at: string;
  ends_at: string;
  featured: boolean;
  created_at: string;
};

/** Whole-day count until the challenge closes; 0 when closed. */
export function daysLeft(challenge: Pick<Challenge, "ends_at">): number {
  const ms = new Date(challenge.ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function isActive(
  challenge: Pick<Challenge, "starts_at" | "ends_at">,
): boolean {
  const now = Date.now();
  return (
    new Date(challenge.starts_at).getTime() <= now &&
    new Date(challenge.ends_at).getTime() > now
  );
}

/** All challenges, newest window first. */
export async function listChallenges(): Promise<Challenge[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .order("ends_at", { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return data as Challenge[];
  } catch {
    return [];
  }
}

export async function getChallengeBySlug(
  slug: string,
): Promise<Challenge | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (error || !data) return null;
    return data as Challenge;
  } catch {
    return null;
  }
}

/** The featured challenge currently in its window (gallery banner / hero).
 *  Soonest-closing wins when several are featured. */
export async function getFeaturedActiveChallenge(): Promise<Challenge | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .eq("featured", true)
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .order("ends_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as Challenge;
  } catch {
    return null;
  }
}
