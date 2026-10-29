import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { seeThroughTickKeys } from "@/lib/cards/dfc";

// ---------------------------------------------------------------------------
// Frame review reads. Writes live in lib/cards/frame-review-actions.ts
// (service role behind an is_admin gate); reads use the caller's session —
// the table is world-readable by policy since the picker needs it.
// ---------------------------------------------------------------------------

export type FrameReview = {
  template: string;
  colorKey: string;
  verified: boolean;
  verifiedAt: string | null;
  referenceScryfallId: string | null;
  referenceName: string | null;
  referenceSet: string | null;
  /** What the tick measured (migration 0115); null on rows ticked before. */
  verifiedLayoutVersion: number | null;
  verifiedOverrideHash: string | null;
  verifiedReferenceId: string | null;
  scoreJson: unknown | null;
};

// select("*"), not a column list: between a deploy and the migration that
// adds a column, an explicit list would 400 and the picker would show NO
// frames. Missing columns simply read as undefined → null.

/** Every review row, keyed for the admin checklist, AND whether the read
 *  failed. An admin surface that acts on the rows (the checklist, the score
 *  batch's pinned references) reads this and says so / refuses on an error,
 *  rather than treating every combo as "not yet reviewed". */
export async function readFrameReviews(): Promise<{ reviews: Map<string, FrameReview>; error: string | null }> {
  const reviews = new Map<string, FrameReview>();
  if (!isSupabaseConfigured()) return { reviews, error: null };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("frame_reviews").select("*");
    if (error) {
      console.error("[frame-reviews] read failed:", error.message);
      return { reviews, error: error.message };
    }
    for (const row of data ?? []) {
      reviews.set(`${row.template}/${row.color_key}`, {
        template: row.template,
        colorKey: row.color_key,
        verified: row.verified,
        verifiedAt: row.verified_at,
        referenceScryfallId: row.reference_scryfall_id,
        referenceName: row.reference_name,
        referenceSet: row.reference_set,
        verifiedLayoutVersion: row.verified_layout_version ?? null,
        verifiedOverrideHash: row.verified_override_hash ?? null,
        verifiedReferenceId: row.verified_reference_id ?? null,
        scoreJson: row.score_json ?? null,
      });
    }
  } catch (err) {
    console.error("[frame-reviews] read failed:", err);
    return { reviews: new Map(), error: err instanceof Error ? err.message : "The frame review read failed." };
  }
  return { reviews, error: null };
}

/** Every review row, keyed for the admin checklist. Empty map on any error
 *  (logged) — absent rows read as "not yet reviewed". For readers where
 *  that is the safe answer (the creator's gate offers nothing unverified);
 *  admin surfaces that act on the rows use readFrameReviews(). */
export async function getFrameReviews(): Promise<Map<string, FrameReview>> {
  return (await readFrameReviews()).reviews;
}

/** The verified combo keys ("template/color") of the verified rows, plus
 *  the see-through keys their ticks publish (TODO 5.11a,
 *  lib/cards/dfc.ts seeThroughTickKeys: a modal body's see-through `c` is
 *  offered to a colourless face with no Artifact word only once its `c`
 *  row was ticked at the version it shipped or later). */
export function verifiedKeysOfRows(
  rows: readonly { template: string; color_key: string; verified_layout_version?: number | null }[],
): string[] {
  return [...rows.map((row) => `${row.template}/${row.color_key}`), ...seeThroughTickKeys(rows)];
}

/** Just the verified combo keys ("template/color") — what the frame picker
 *  needs for availability. */
export async function getVerifiedFrameKeys(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("frame_reviews")
      .select("template, color_key, verified_layout_version")
      .eq("verified", true);
    return verifiedKeysOfRows(data ?? []);
  } catch {
    return [];
  }
}

/**
 * The same verified keys through the cookie-free public client — for pages
 * that must stay static/ISR (the guest creator at /preview). The table is
 * world-readable by policy, so anonymous visibility is identical; only the
 * cookie access differs. Before this existed, /preview passed no keys at
 * all and every kind but Creature rendered as "Soon" for guests.
 */
export async function getVerifiedFrameKeysPublic(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("frame_reviews")
      .select("template, color_key, verified_layout_version")
      .eq("verified", true);
    return verifiedKeysOfRows(data ?? []);
  } catch {
    return [];
  }
}
