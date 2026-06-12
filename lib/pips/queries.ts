import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isCustomPipSymbol,
  type PipOverrides,
} from "@/lib/pips/override";

// ---------------------------------------------------------------------------
// Custom pip reads. RLS allows public SELECT (visitors viewing a public card
// need the OWNER's overrides to render the cost faithfully), so these run on
// the request-scoped anon/session client.
// ---------------------------------------------------------------------------

/**
 * The pip-override map for a user (card owner). Returns {} when the user has
 * no custom pips, on lookup failure, or when Supabase isn't configured —
 * renderers treat a missing entry as "use the standard glyph", so this
 * degrades to stock pips rather than erroring.
 *
 * Wrapped in React's cache() so a page that renders many of the same owner's
 * cards resolves the map once per request.
 */
export const getPipOverrides = cache(
  async (ownerId: string): Promise<PipOverrides> => {
    if (!ownerId || !isSupabaseConfigured()) return {};

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("custom_pips")
      .select("symbol, image_url")
      .eq("owner_id", ownerId);

    if (error || !data) return {};

    const overrides: PipOverrides = {};
    for (const row of data) {
      if (isCustomPipSymbol(row.symbol) && row.image_url) {
        overrides[row.symbol] = row.image_url;
      }
    }
    return overrides;
  },
);
