import { cache } from "react";
import { unstable_cache } from "next/cache";
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

export const getChallengeBySlug = cache(async (
  slug: string,
): Promise<Challenge | null> => {
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
});

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

export const CHALLENGE_NAV_TAG = "challenge-nav";

const loadNavChallenge = unstable_cache(
  async (): Promise<Pick<Challenge, "starts_at" | "ends_at"> | null> => {
    const supabase = createPublicClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("challenges")
      .select("starts_at, ends_at")
      .lte("starts_at", nowIso)
      .gt("ends_at", nowIso)
      .order("featured", { ascending: false })
      .order("ends_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as Pick<Challenge, "starts_at" | "ends_at">;
  },
  [CHALLENGE_NAV_TAG],
  { revalidate: 300, tags: [CHALLENGE_NAV_TAG] },
);

/** The window of the challenge getCurrentChallenge() picks, for the header's
 *  "Ends in N days" pill (TODO NV1). Cookie-free and cached for 5 minutes
 *  like the what's-new ribbon, so every page that draws the header stays
 *  static; a challenge save purges it. The pill counts the days in the
 *  browser and hides itself once the window has closed. React-cached: the
 *  header draws the pill twice (the Community panel and the drawer), one
 *  read per render. */
export const getNavChallenge = cache(async (): Promise<Pick<Challenge, "starts_at" | "ends_at"> | null> => {
  if (!isSupabaseConfigured()) return null;
  try {
    return await loadNavChallenge();
  } catch {
    return null;
  }
});

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
