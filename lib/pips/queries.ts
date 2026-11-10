import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";
import {
  isCustomPipSymbol,
  type PipOverrides,
} from "@/lib/pips/override";
import { customSymbolKey, type OwnerSymbols, type SymbolMeanings } from "@/lib/symbols/symbol-token";
import { chunkIds } from "@/lib/supabase/select-all-rows";
import { isSymbolBaseColor, SYMBOL_CODE_RE, SYMBOL_MANA_VALUE_MAX } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// Custom pip reads — the six pips and the owner's own symbols. RLS allows
// public SELECT on both (visitors viewing a public card
// need the OWNER's overrides to render the cost faithfully), so these run on
// the request-scoped anon/session client.
// ---------------------------------------------------------------------------

type OwnerSymbolRow = {
  code: string;
  image_url: string;
  mana_value: number | string | null;
  base_color: string | null;
};

/** The owner's symbols, removed ones too — ONE read per owner per request,
 *  shared by the picture map and the meanings. null when the read fails. */
const readOwnerSymbols = cache(async (ownerId: string): Promise<OwnerSymbolRow[] | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .select("code, image_url, mana_value, base_color")
    .eq("owner_id", ownerId);
  if (error || !data) return null;
  return data as OwnerSymbolRow[];
});

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
      readOwnerSymbols(ownerId),
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
    if (symbols) {
      for (const row of symbols) {
        if (SYMBOL_CODE_RE.test(row.code) && isAllowedMediaUrl("pip", row.image_url, ownerId)) {
          overrides[customSymbolKey(row.code)] = row.image_url;
        }
      }
    }
    return overrides;
  },
);

/**
 * What each of the owner's symbols MEANS (PR 3): its declared mana value and
 * base colour, by code — removed ones too (a card that names one keeps
 * counting it). {} when the owner has none, the read fails or Supabase isn't
 * configured: every `{*CODE}` then counts 0 and no colour, as before. The
 * same read as the picture map (one query per owner per request).
 */
export const getSymbolMeanings = cache(async (ownerId: string): Promise<SymbolMeanings> => {
  if (!ownerId || !isSupabaseConfigured()) return {};
  const rows = await readOwnerSymbols(ownerId);
  return symbolMeaningsFromRows(rows ?? []);
});

/** The meanings map from the table's rows: a row with a code, a mana value or
 *  a colour outside 0193's CHECKs is left out (never counted). */
export function symbolMeaningsFromRows(
  rows: readonly { code: string; mana_value: number | string | null; base_color: string | null }[],
): SymbolMeanings {
  const meanings: Record<string, SymbolMeanings[string]> = {};
  for (const row of rows) {
    const manaValue = Number(row.mana_value);
    if (!SYMBOL_CODE_RE.test(row.code)) continue;
    if (!Number.isInteger(manaValue) || manaValue < 0 || manaValue > SYMBOL_MANA_VALUE_MAX) continue;
    if (row.base_color !== null && !isSymbolBaseColor(row.base_color)) continue;
    meanings[row.code] = { manaValue, baseColor: row.base_color };
  }
  return meanings;
}

/**
 * The symbols of SEVERAL owners in one read (PR 4) — a deck's cards by many
 * makers, an export's: what each symbol means and its picture, by owner.
 * Pass only the owners whose cards name a symbol (costNamesCustomSymbol):
 * the read is skipped when there are none. An owner with no symbols, or a
 * failed read (logged), is absent from the map — their `{*CODE}` then counts
 * 0 and draws the placeholder, as everywhere without a map.
 */
export async function readOwnerSymbolsOf(ownerIds: Iterable<string>): Promise<Map<string, OwnerSymbols>> {
  const out = new Map<string, OwnerSymbols>();
  const ids = Array.from(new Set(ownerIds)).filter(Boolean);
  if (ids.length === 0 || !isSupabaseConfigured()) return out;
  try {
    const supabase = await createClient();
    const rows: Array<OwnerSymbolRow & { owner_id: string }> = [];
    for (const chunk of chunkIds(ids)) {
      const { data, error } = await supabase
        .from("custom_symbols")
        .select("owner_id, code, image_url, mana_value, base_color")
        .in("owner_id", chunk);
      if (error || !data) {
        console.error("[custom-symbols] the owners' symbols could not be read", error?.message);
        return out;
      }
      rows.push(...(data as Array<OwnerSymbolRow & { owner_id: string }>));
    }
    return ownerSymbolsFromRows(rows);
  } catch (error) {
    console.error("[custom-symbols] the owners' symbols could not be read", error);
    return out;
  }
}

/** readOwnerSymbolsOf's map from its rows: each owner's meanings
 *  (symbolMeaningsFromRows' rules) and pictures (the owner's own stored
 *  objects only, as getPipOverrides). */
export function ownerSymbolsFromRows(
  rows: readonly (OwnerSymbolRow & { owner_id: string })[],
): Map<string, OwnerSymbols> {
  const byOwner = new Map<string, Array<OwnerSymbolRow & { owner_id: string }>>();
  for (const row of rows) {
    const list = byOwner.get(row.owner_id) ?? [];
    list.push(row);
    byOwner.set(row.owner_id, list);
  }
  const out = new Map<string, OwnerSymbols>();
  for (const [ownerId, list] of byOwner) {
    const pictures: Record<`*${string}`, string> = {};
    for (const row of list) {
      if (SYMBOL_CODE_RE.test(row.code) && isAllowedMediaUrl("pip", row.image_url, ownerId)) {
        pictures[customSymbolKey(row.code)] = row.image_url;
      }
    }
    out.set(ownerId, { meanings: symbolMeaningsFromRows(list), pictures });
  }
  return out;
}
