import "server-only";

import { unstable_rethrow } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { seeThroughTickKeys } from "@/lib/cards/dfc";
import { VerifiedFramesUnavailableError, isVerifiedFramesUnavailable } from "@/lib/cards/frame-list-unavailable";

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

// ---------------------------------------------------------------------------
// The verified combos — the creator's only gate. A read that FAILS (a
// PostgREST or pooler hiccup: the 2026-11-10 incident) is logged and THROWN
// as VerifiedFramesUnavailableError (lib/cards/frame-list-unavailable.ts),
// never answered as "nothing is verified": that answer showed every frame as
// "Soon" on /create and made both card actions refuse every save with "That
// frame isn't available in <colour> yet". Each caller says so in its own
// terms — a save refused with FRAME_LIST_UNAVAILABLE_MESSAGE (retryable), a
// creator page with a notice (readVerifiedFrameKeys), a job or a tool
// refused before any charge.
// ---------------------------------------------------------------------------

type FrameReviewsClient = Pick<Awaited<ReturnType<typeof createClient>>, "from">;

async function readVerifiedKeys(client: () => FrameReviewsClient | Promise<FrameReviewsClient>, reader: string): Promise<string[]> {
  if (!isSupabaseConfigured()) return [];
  let detail: string;
  try {
    const supabase = await client();
    const { data, error } = await supabase
      .from("frame_reviews")
      .select("template, color_key, verified_layout_version")
      .eq("verified", true);
    if (!error) return verifiedKeysOfRows(data ?? []);
    detail = error.message;
  } catch (err) {
    // A redirect / notFound / dynamic-rendering bail-out is Next's, never
    // a failed read.
    unstable_rethrow(err);
    detail = err instanceof Error ? err.message : String(err);
  }
  console.error(`[frame-reviews] the verified frame list read failed (${reader}): ${detail}`);
  throw new VerifiedFramesUnavailableError(detail);
}

/** Just the verified combo keys ("template/color") — what the frame picker
 *  and every save gate need for availability. Throws
 *  VerifiedFramesUnavailableError (logged) when the read fails. */
export async function getVerifiedFrameKeys(): Promise<string[]> {
  return readVerifiedKeys(createClient, "session");
}

/**
 * The same verified keys through the cookie-free public client — for pages
 * that must stay static/ISR (the guest creator at /preview). The table is
 * world-readable by policy, so anonymous visibility is identical; only the
 * cookie access differs. Before this existed, /preview passed no keys at
 * all and every kind but Creature rendered as "Soon" for guests. Throws
 * VerifiedFramesUnavailableError (logged) when the read fails.
 */
export async function getVerifiedFrameKeysPublic(): Promise<string[]> {
  return readVerifiedKeys(createPublicClient, "public");
}

/** The verified keys for a surface that can still be shown without them
 *  (a creator page, the home page's count): the keys, or `unavailable` —
 *  the read failed (already logged) and the surface says so rather than
 *  showing every frame as "Soon". */
export type VerifiedFrameKeysRead = { keys: string[]; unavailable: boolean };

async function settled(read: Promise<string[]>): Promise<VerifiedFrameKeysRead> {
  try {
    return { keys: await read, unavailable: false };
  } catch (err) {
    if (isVerifiedFramesUnavailable(err)) return { keys: [], unavailable: true };
    throw err;
  }
}

/** getVerifiedFrameKeys for a page that says when the read failed. */
export function readVerifiedFrameKeys(): Promise<VerifiedFrameKeysRead> {
  return settled(getVerifiedFrameKeys());
}

/** getVerifiedFrameKeysPublic for a static/ISR page that says when the
 *  read failed (cookie-free, like it). */
export function readVerifiedFrameKeysPublic(): Promise<VerifiedFrameKeysRead> {
  return settled(getVerifiedFrameKeysPublic());
}
