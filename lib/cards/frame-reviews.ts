import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

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
};

/** Every review row, keyed for the admin checklist. Empty map on any error —
 *  absent rows read as "not yet reviewed". */
export async function getFrameReviews(): Promise<Map<string, FrameReview>> {
  const reviews = new Map<string, FrameReview>();
  if (!isSupabaseConfigured()) return reviews;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("frame_reviews")
      .select("template, color_key, verified, verified_at, reference_scryfall_id");
    for (const row of data ?? []) {
      reviews.set(`${row.template}/${row.color_key}`, {
        template: row.template,
        colorKey: row.color_key,
        verified: row.verified,
        verifiedAt: row.verified_at,
        referenceScryfallId: row.reference_scryfall_id,
      });
    }
  } catch {
    // Fall through — empty map.
  }
  return reviews;
}

/** Just the verified combo keys ("template/color") — what the frame picker
 *  needs for availability. */
export async function getVerifiedFrameKeys(): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("frame_reviews")
      .select("template, color_key")
      .eq("verified", true);
    return (data ?? []).map((row) => `${row.template}/${row.color_key}`);
  } catch {
    return [];
  }
}
