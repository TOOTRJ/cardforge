import "server-only";

import { createClient } from "@/lib/supabase/server";
import { PIP_LIBRARY_MAX, type ForgedPip } from "./model";
import { PIP_COLUMNS, pipFromRow } from "./server";

/** The viewer's forged pips, newest change first (RLS: their own, while the
 *  tool is open to them — anyone else reads none). */
export async function listMyPips(ownerId: string): Promise<ForgedPip[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("forged_pips")
      .select(PIP_COLUMNS)
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false })
      .limit(PIP_LIBRARY_MAX);
    if (error || !data) return [];
    return data.map((row) => pipFromRow(row)).filter((p): p is ForgedPip => p !== null);
  } catch {
    return [];
  }
}
