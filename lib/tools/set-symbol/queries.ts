import "server-only";

import { createClient } from "@/lib/supabase/server";
import { SYMBOL_LIBRARY_MAX, type StudioSymbol } from "./model";
import { SYMBOL_COLUMNS, symbolFromRow } from "./server";

/** The viewer's symbols, newest change first (RLS: their own, while the
 *  tool is open to them — anyone else reads none). */
export async function listMySymbols(ownerId: string): Promise<StudioSymbol[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("set_symbols")
      .select(SYMBOL_COLUMNS)
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false })
      .limit(SYMBOL_LIBRARY_MAX);
    if (error || !data) return [];
    return data.map((row) => symbolFromRow(row)).filter((s): s is StudioSymbol => s !== null);
  } catch {
    return [];
  }
}

/** One of the viewer's symbols by id (RLS), or null. */
export async function getMySymbol(ownerId: string, id: string): Promise<StudioSymbol | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("set_symbols")
      .select(SYMBOL_COLUMNS)
      .eq("owner_id", ownerId)
      .eq("id", id)
      .maybeSingle();
    return data ? symbolFromRow(data) : null;
  } catch {
    return null;
  }
}
