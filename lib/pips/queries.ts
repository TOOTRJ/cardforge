import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";
import {
  isCustomPipSymbol,
  type PipOverrides,
} from "@/lib/pips/override";
import { customSymbolKey } from "@/lib/symbols/symbol-token";
import { SYMBOL_CODE_RE } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// Custom pip reads — the six pips and the owner's own symbols. RLS allows
// public SELECT on both (visitors viewing a public card
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
    // The owner's own symbols (0193, layout v76) ride the same map under
    // `*CODE` keys — removed ones too: a card that names one keeps drawing
    // it (lib/symbols/symbol-token.ts). Read beside the six pips; a failed
    // read leaves them out (each `{*CODE}` then draws its placeholder),
    // never the six.
    const [pips, symbols] = await Promise.all([
      supabase.from("custom_pips").select("symbol, image_url").eq("owner_id", ownerId),
      supabase.from("custom_symbols").select("code, image_url").eq("owner_id", ownerId),
    ]);

    const overrides: PipOverrides = {};
    // Only the owner's own stored pips (migration 0127,
    // lib/media/media-urls.ts): a row written before it could name any host.
    // Every renderer — preview and bake — reads its overrides from here.
    if (!pips.error && pips.data) {
      for (const row of pips.data) {
        if (isCustomPipSymbol(row.symbol) && isAllowedMediaUrl("pip", row.image_url, ownerId)) {
          overrides[row.symbol] = row.image_url;
        }
      }
    }
    if (!symbols.error && symbols.data) {
      for (const row of symbols.data) {
        if (SYMBOL_CODE_RE.test(row.code) && isAllowedMediaUrl("pip", row.image_url, ownerId)) {
          overrides[customSymbolKey(row.code)] = row.image_url;
        }
      }
    }
    return overrides;
  },
);
