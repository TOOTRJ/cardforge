import "server-only";

import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getVerifiedFrameKeysPublic } from "@/lib/cards/frame-reviews";
import {
  answeredSignaturePairs,
  mapRequestedFrames,
  publicSignatures,
  type RequestedFrame,
  type RequestedFrameCountRow,
} from "@/lib/frames/requested-frames";

// ---------------------------------------------------------------------------
// The /frames/requested read (TODO NV12, migration 0147): one call to
// requested_frame_counts() and the verified combos (each frame's status),
// both through the cookie-free public client, so the page and the sitemap
// stay ISR-eligible. React cache() lets the page and its generateMetadata
// share it.
//
// Fail-soft: on a database without 0147 (the shared dev DB until this
// merges) the RPC doesn't exist — the page says the list isn't available,
// never throws.
// ---------------------------------------------------------------------------

export type RequestedFramesResult = {
  frames: RequestedFrame[];
  /** Why the list may be empty for another reason than "nobody asked". */
  error: string | null;
};

export const getRequestedFrames = cache(async (): Promise<RequestedFramesResult> => {
  if (!isSupabaseConfigured()) return { frames: [], error: "offline" };
  try {
    const [{ data, error }, verifiedKeys] = await Promise.all([
      createPublicClient().rpc("requested_frame_counts", {
        p_signatures: publicSignatures(),
        p_answered: answeredSignaturePairs(),
      }),
      getVerifiedFrameKeysPublic(),
    ]);
    if (error) {
      console.warn("getRequestedFrames: rpc error", error.message);
      return { frames: [], error: "unavailable" };
    }
    return {
      frames: mapRequestedFrames((data ?? []) as RequestedFrameCountRow[], new Set(verifiedKeys)),
      error: null,
    };
  } catch (error) {
    console.warn("getRequestedFrames: failed", error instanceof Error ? error.message : error);
    return { frames: [], error: "unavailable" };
  }
});
