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
// (≤27 rows). The data is viewer-independent, so it uses the cookie-free
// public client (keeps callers eligible for static/ISR rendering) and is
// cached ACROSS requests via unstable_cache — admin writes bust the tag
// (see frame-profile-override-actions.ts). react cache() on top dedupes
// within a request. Every failure mode — table missing, bad jsonb, network
// — degrades to {} (code defaults), never an error: a broken override row
// must not take down card rendering.
//
// Writes live in lib/cards/frame-profile-override-actions.ts.
//
// Known v1 gaps (accepted): BakedCardThumbnail's live fallback and the
// back-face picker thumbs render without overrides — tiny previews, and the
// fallback only fires for never-baked cards.
// ---------------------------------------------------------------------------

export const FRAME_PROFILE_OVERRIDES_TAG = "frame-profile-overrides";

const loadFrameProfileOverrides = unstable_cache(
  async (): Promise<FrameProfileOverridesMap> => {
    if (!isSupabaseConfigured()) return {};
    try {
      const supabase = createPublicClient();
      const { data } = await supabase
        .from("frame_profile_overrides")
        .select("template, overrides");
      const map: FrameProfileOverridesMap = {};
      for (const row of data ?? []) {
        const parsed = parseFrameProfileOverride(row.overrides);
        if (parsed) map[row.template] = parsed;
      }
      return map;
    } catch {
      return {};
    }
  },
  [FRAME_PROFILE_OVERRIDES_TAG],
  { revalidate: 300, tags: [FRAME_PROFILE_OVERRIDES_TAG] },
);

export const getFrameProfileOverrides = cache(loadFrameProfileOverrides);
