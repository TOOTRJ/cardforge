import { importFingerprintOf, type FingerprintCard } from "@/lib/cards/import-fingerprint";

// ---------------------------------------------------------------------------
// The import provenance a NEW card is inserted with (TODO DK2.5, migration
// 0144) — createCardAction's one call. The columns are insert-only (0144's
// guard refuses an API role's change), so an edit never names them:
// updateCardAction has no path to them at all.
//
//   * a remix (`parent_card_id`) carries none: its lineage is its parent;
//   * a card naming a Scryfall source (`source_scryfall_id`: the creator's
//     import, the AI's restyle of a printing, a source typed on the Publish
//     step) was started from that printing → `import_scryfall_id`;
//   * its fingerprint only when the creator says the card still prints what
//     the import gave it (`import_unchanged`, lib/creator/import-baseline.ts)
//     — taken from the row as inserted, the same shape the deck pages read
//     back. A source with no fingerprint is an import changed before its
//     first save: "Edited" from the start.
//   * anything else: nothing (from scratch).
//
// Only a card that HAS a source names the columns, so an ordinary save never
// depends on 0144 having run; withoutImportProvenance is the retry for an
// imported card's save against a database 0144 has not reached (the dev
// database until the merge, a deploy that lands before its migration) —
// remove it once 0144 is on production and dev.
// ---------------------------------------------------------------------------

export type ImportProvenanceInsert = {
  import_scryfall_id?: string;
  import_fingerprint?: string | null;
};

export function importProvenanceInsert(
  data: {
    parent_card_id?: string | null;
    source_scryfall_id?: string | null;
    import_unchanged?: boolean;
  },
  inserted: FingerprintCard,
): ImportProvenanceInsert {
  if (data.parent_card_id) return {};
  const source = data.source_scryfall_id?.trim();
  if (!source) return {};
  return {
    import_scryfall_id: source,
    import_fingerprint: data.import_unchanged === true ? importFingerprintOf(inserted) : null,
  };
}

const PROVENANCE_COLUMNS = ["import_scryfall_id", "import_fingerprint"] as const;

/** PostgREST's answer for an insert naming a column the database lacks
 *  (PGRST204, "Could not find the 'import_fingerprint' column of 'cards' in
 *  the schema cache") — or Postgres' own (42703). */
export function isMissingImportProvenanceColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code !== "PGRST204" && error.code !== "42703") return false;
  return PROVENANCE_COLUMNS.some((column) => (error.message ?? "").includes(column));
}

export function withoutImportProvenance<T extends object>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const column of PROVENANCE_COLUMNS) delete copy[column];
  return copy as T;
}

export function namesImportProvenance(row: object): boolean {
  return PROVENANCE_COLUMNS.some((column) => column in row);
}
