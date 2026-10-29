import type { BackFaceFormValues, FormValues } from "@/lib/creator/form-types";

// ---------------------------------------------------------------------------
// "Does this new card still print what its Scryfall import gave it?" (TODO
// DK2.5) — the creator's half of the import fingerprint. The creator keeps a
// BASELINE of the printed form values the moment an import lands; a new
// card's save says `import_unchanged` (createCardSchema) by comparing the
// values it saves with that baseline — form values with form values, one
// shape, so no conversion can tell them apart. The server stores the
// fingerprint of the ROW only when it is true
// (lib/cards/import-provenance.ts); a card changed before its first save is
// stored with its source and no fingerprint ("Edited").
//
// The keys are the form's side of lib/cards/import-fingerprint.ts's fields:
// what the card prints and its picture — the structured rows too, which the
// save writes into the rules text. Every FormValues key is either here or in
// NOT_PRINTED_FORM_KEYS (tests/unit/creator/import-baseline.test.ts holds the
// two to the form's defaults), so a new field is a decision, never a miss.
// ---------------------------------------------------------------------------

export const IMPORT_BASELINE_KEYS = [
  "title",
  "nickname",
  "cost",
  "supertype",
  "printed_types",
  "card_type",
  "subtypes_text",
  "rules_text",
  "loyalty_abilities",
  "saga_intro",
  "saga_chapters",
  "saga_creature_text",
  "station_pt_tier",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "artist_credit",
  "art_url",
  "has_back_face",
  "back_face",
] as const satisfies readonly (keyof FormValues)[];

/** The rest of the form: frame, colour, rarity, set and collector fields,
 *  visibility, tags, decks, watermark, footer — and the source itself,
 *  compared on its own. */
export const NOT_PRINTED_FORM_KEYS = [
  "slug",
  "game_system_id",
  "color_identity",
  "tags_text",
  "rarity",
  "art_position",
  "frame_style",
  "visibility",
  "save_as_draft",
  "source_scryfall_id",
  "set_icon_url",
  "set_icon_code",
  "set_code",
  "collector_number",
  "lang",
  "deck_id",
  "watermark",
  "footer_text",
] as const satisfies readonly (keyof FormValues)[];

export const IMPORT_BASELINE_BACK_KEYS = [
  "title",
  "cost",
  "card_type",
  "supertype",
  "printed_types",
  "subtypes_text",
  "rules_text",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "artist_credit",
  "art_url",
] as const satisfies readonly (keyof BackFaceFormValues)[];

export const NOT_PRINTED_BACK_FORM_KEYS = ["art_position", "color_identity"] as const satisfies readonly (keyof BackFaceFormValues)[];

export type ImportBaseline = { scryfallId: string; printed: string };

function settled(value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(settled);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, settled(inner)]));
  }
  return value ?? null;
}

function printedKeyOf(values: Partial<FormValues>): string {
  const back = values.has_back_face && values.back_face ? values.back_face : null;
  return JSON.stringify([
    IMPORT_BASELINE_KEYS.filter((key) => key !== "back_face").map((key) => settled(values[key])),
    back ? IMPORT_BASELINE_BACK_KEYS.map((key) => settled(back[key])) : null,
  ]);
}

/** The baseline right after an import has landed (null when the values name
 *  no source printing). */
export function importBaselineOf(values: Partial<FormValues>): ImportBaseline | null {
  const scryfallId = values.source_scryfall_id?.trim();
  return scryfallId ? { scryfallId, printed: printedKeyOf(values) } : null;
}

/** What a NEW card's payload says about its import: nothing without an
 *  import this session (or once the maker changed or cleared its source),
 *  else whether every printed field is still the import's. */
export function importUnchangedPayload(
  baseline: ImportBaseline | null,
  values: Partial<FormValues>,
): { import_unchanged?: boolean } {
  if (!baseline || values.source_scryfall_id?.trim() !== baseline.scryfallId) return {};
  return { import_unchanged: printedKeyOf(values) === baseline.printed };
}
