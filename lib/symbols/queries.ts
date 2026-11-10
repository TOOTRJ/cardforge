import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isAllowedMediaUrl } from "@/lib/media/media-urls";
import {
  isSymbolBaseColor,
  SYMBOL_CODE_RE,
  type CustomSymbol,
} from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// Custom symbol reads (migration 0193). Everyone may read every row — a card
// that names a symbol draws its OWNER's picture for every viewer — so these
// run on the request's own client.
// ---------------------------------------------------------------------------

export const SYMBOL_COLUMNS =
  "id, code, name, mana_value, base_color, image_url, source, deleted_at, created_at, updated_at";

export type SymbolRow = {
  id: string;
  code: string;
  name: string;
  mana_value: number;
  base_color: string | null;
  image_url: string;
  source: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A row as the app reads it — null for a row it can't trust (a code or a
 *  picture outside the rules: never drawn). */
export function symbolFromRow(row: SymbolRow, ownerId: string): CustomSymbol | null {
  if (!SYMBOL_CODE_RE.test(row.code)) return null;
  if (!isAllowedMediaUrl("pip", row.image_url, ownerId)) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    manaValue: Number(row.mana_value),
    baseColor: isSymbolBaseColor(row.base_color) ? row.base_color : null,
    imageUrl: row.image_url,
    source: row.source === "forge" ? "forge" : "upload",
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every symbol `ownerId` has made, removed ones included, by code. [] when
 *  the read fails (logged). */
export async function listSymbolsOf(ownerId: string): Promise<CustomSymbol[]> {
  if (!ownerId || !isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("custom_symbols")
    .select(SYMBOL_COLUMNS)
    .eq("owner_id", ownerId)
    .order("code", { ascending: true });
  if (error) {
    console.error("[custom-symbols] read failed:", error.message);
    return [];
  }
  return ((data ?? []) as SymbolRow[])
    .map((row) => symbolFromRow(row, ownerId))
    .filter((symbol): symbol is CustomSymbol => symbol !== null);
}
