import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { IMPORT_FINGERPRINT_FIELDS } from "@/lib/cards/import-fingerprint";
import { isExactCopyOfImport, type ExactCopyCard } from "@/lib/cards/exact-copy";

// ---------------------------------------------------------------------------
// The read behind "which of these cards are still exactly the real card"
// (lib/cards/exact-copy.ts) for a surface that holds only ids: My Cards'
// bulk publish and the hourly sweep. Only rows with a stored fingerprint can
// be one, so the read asks for those alone, with every column the
// fingerprint covers. Works with the session client (RLS: the caller's own
// cards) or the service role.
// ---------------------------------------------------------------------------

/** The columns the exact-copy judgment reads, besides what a caller adds. */
export const EXACT_COPY_COLUMNS: readonly string[] = [
  "id",
  "import_scryfall_id",
  "import_fingerprint",
  ...IMPORT_FINGERPRINT_FIELDS,
];

/**
 * The ids among `ids` that are exact copies. A read that fails answers an
 * empty set and logs: a publish is never blocked by it, and the hourly sweep
 * moves any public exact copy that slipped through to unlisted.
 */
export async function readExactCopyIds(
  supabase: Pick<SupabaseClient<Database>, "from">,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("cards")
    .select(EXACT_COPY_COLUMNS.join(", "))
    .in("id", [...ids])
    .not("import_fingerprint", "is", null);
  if (error) {
    console.warn("[exact-copy] read failed; nothing held back:", error.message);
    return new Set();
  }
  return new Set(
    ((data ?? []) as unknown as Array<ExactCopyCard & { id: string }>).filter(isExactCopyOfImport).map((row) => row.id),
  );
}
