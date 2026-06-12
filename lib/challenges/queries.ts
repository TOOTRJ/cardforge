import "server-only";

import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Challenge reads (Community Phase 1). Challenges are admin-authored rows;
// ENTRIES are simply public cards wearing the challenge's tag, fetched with
// the existing listPublicCardsRich({ tag }) — no join table. All reads
// fail soft (empty/null) so a DB hiccup never breaks the marketing shell.
// All reads are viewer-independent, so they use the cookie-free public
// client — pages built on them stay static/ISR-cacheable.
// ---------------------------------------------------------------------------

export {
  daysLeft,
  isActive,
  type Challenge,
} from "@/lib/challenges/shared";

import type { Challenge } from "@/lib/challenges/shared";

/** All challenges, newest window first. */
export async function listChallenges(): Promise<Challenge[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createPublicClient();
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
    const supabase = createPublicClient();
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
    const supabase = createPublicClient();
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

/** The challenge the editor's "Enter the challenge" toggle targets: an
 *  active-window challenge, preferring featured, then soonest-closing. */
export async function getCurrentChallenge(): Promise<Challenge | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = createPublicClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("challenges")
      .select("*")
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .order("featured", { ascending: false })
      .order("ends_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as Challenge;
  } catch {
    return null;
  }
}
