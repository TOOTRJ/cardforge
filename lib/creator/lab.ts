import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  DEFAULT_CREATOR_LAB_MODE,
  isCreatorLabMode,
  type CreatorLabMode,
} from "@/lib/creator/lab-shared";

/** Cache tag for the lab switch (site_settings.creator_lab). */
export const CREATOR_LAB_TAG = "creator-lab";

const loadCreatorLabMode = unstable_cache(
  async (): Promise<CreatorLabMode> => {
    if (!isSupabaseConfigured()) return DEFAULT_CREATOR_LAB_MODE;
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "creator_lab")
      .maybeSingle();
    const value = (data?.value ?? {}) as { mode?: unknown };
    return isCreatorLabMode(value.mode) ? value.mode : DEFAULT_CREATOR_LAB_MODE;
  },
  [CREATOR_LAB_TAG],
  { revalidate: 300, tags: [CREATOR_LAB_TAG] },
);

/** The admin's switch for the hidden canvas walkthrough. Public-client
 *  read (site_settings is readable by everyone) so /create stays cacheable. */
export const getCreatorLabMode = cache(loadCreatorLabMode);
