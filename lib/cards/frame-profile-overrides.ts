import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  parseFrameProfileOverride,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";

// ---------------------------------------------------------------------------
// Server read for frame layout overrides. One tiny world-readable select
// (at most one row per frame template). The data is viewer-independent, so it uses the cookie-free
// public client (keeps callers eligible for static/ISR rendering) and is
// cached ACROSS requests via unstable_cache — admin writes bust the tag
// (see frame-profile-override-actions.ts). react cache() on top dedupes
// within a request.
//
// A FAILED READ IS NEVER CACHED (admin audit 2026-10-16, L2): the loader
// retries once and then THROWS, and unstable_cache keeps only what a loader
// returns — so a transient error (network, timeout, a 5xx from PostgREST)
// is not remembered as "no overrides" for the 5-minute window. Two readers:
//
//   getFrameProfileOverrides()        DISPLAY (live preview, creator, card
//                                     page, downloads, OG, admin tools): a
//                                     failed read is logged and answers {} —
//                                     the code profiles — for this request
//                                     only. A broken read must not take down
//                                     card rendering.
//   requireFrameProfileOverrides()    STORED BAKES (lib/cards/bake-render.ts,
//                                     lib/cards/rebake-batch.ts): a failed
//                                     read throws. A bake without an override
//                                     that exists would be stored — and
//                                     stamped current — with the wrong layout
//                                     for good; a refused bake is retried
//                                     (the save bake leaves its pointers
//                                     cleared, which the auto re-bake's sweep
//                                     scope picks up; a batch answers an
//                                     error and nothing is written).
//
// A ROW whose jsonb does not parse is still skipped (a broken row, not a
// failed read: it would fail every retry the same way). No Supabase
// configured = no overrides, not a failure.
//
// Writes live in lib/cards/frame-profile-override-actions.ts.
//
// Known v1 gaps (accepted): BakedCardThumbnail's live fallback and the
// back-face picker thumbs render without overrides — tiny previews, and the
// fallback only fires for never-baked cards.
// ---------------------------------------------------------------------------

export const FRAME_PROFILE_OVERRIDES_TAG = "frame-profile-overrides";

/** Reads per load before a failure is reported (the first + one retry). */
const READ_ATTEMPTS = 2;

/** The uncached read: the map, or a throw when the table can't be read. */
export async function readFrameProfileOverrides(): Promise<FrameProfileOverridesMap> {
  if (!isSupabaseConfigured()) return {};
  let lastError: unknown = null;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    try {
      const supabase = createPublicClient();
      const { data, error } = await supabase
        .from("frame_profile_overrides")
        .select("template, overrides");
      if (error) throw new Error(error.message);
      const map: FrameProfileOverridesMap = {};
      for (const row of data ?? []) {
        const parsed = parseFrameProfileOverride(row.overrides);
        if (parsed) map[row.template] = parsed;
      }
      return map;
    } catch (err) {
      lastError = err;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Frame layout overrides could not be read: ${detail}`);
}

const loadFrameProfileOverrides = unstable_cache(
  readFrameProfileOverrides,
  [FRAME_PROFILE_OVERRIDES_TAG],
  { revalidate: 300, tags: [FRAME_PROFILE_OVERRIDES_TAG] },
);

/** For a STORED bake: the overrides, or a throw — never a silent {}. */
export const requireFrameProfileOverrides = cache(
  (): Promise<FrameProfileOverridesMap> => loadFrameProfileOverrides(),
);

/** For display: the overrides, or {} (logged, uncached) when they can't be
 *  read. */
export const getFrameProfileOverrides = cache(async (): Promise<FrameProfileOverridesMap> => {
  try {
    return await loadFrameProfileOverrides();
  } catch (err) {
    console.error(
      `[frame-profile-overrides] ${err instanceof Error ? err.message : String(err)} — rendering on the code profiles for this request (not cached).`,
    );
    return {};
  }
});
