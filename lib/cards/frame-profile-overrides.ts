import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  parseFrameProfileOverride,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";

// ---------------------------------------------------------------------------
// Server read for frame layout overrides. One tiny world-readable select
// (≤27 rows), request-deduped via react cache(). Every failure mode — table
// missing, bad jsonb, network — degrades to {} (code defaults), never an
// error: a broken override row must not take down card rendering.
//
// Writes live in lib/cards/frame-profile-override-actions.ts.
//
// Known v1 gaps (accepted): BakedCardThumbnail's live fallback and the
// back-face picker thumbs render without overrides — tiny previews, and the
// fallback only fires for never-baked cards.
// ---------------------------------------------------------------------------

export const getFrameProfileOverrides = cache(
  async (): Promise<FrameProfileOverridesMap> => {
    if (!isSupabaseConfigured()) return {};
    try {
      const supabase = await createClient();
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
);
