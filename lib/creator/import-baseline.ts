import type { BackFaceFormValues, FormValues } from "@/lib/creator/form-types";

// ---------------------------------------------------------------------------
// "Is this new card still exactly what its Scryfall import gave it?" (TODO
// DK2.5) — the creator's half of the import fingerprint. "Edited" is ANY
// change to the card (owner 2026-10-29), so the creator keeps a BASELINE of
// every value a maker can set the moment an import has landed AND settled,
// and a new card's save says `import_unchanged` (createCardSchema) by
// comparing the values it saves with that baseline — form values with form
// values, one shape, so no conversion can tell them apart. The server
// stores the fingerprint of the ROW only when it is true
// (lib/cards/import-provenance.ts); a card changed before its first save is
// stored with its source and no fingerprint ("Edited").
//
// "Settled": an import lands in one handler, and the form's own automatic
// steps then run on what it wrote — the art's fit to its window, the
// frame follows (token text box, enchantment / subtype dress, part colour),
// anatomy defaults, a kind's own defaults. Those are the import's, never
// the maker's, so the baseline is taken once they have run: the creator
// RE-TAKES it after every commit until the maker's first edit
// (card-creator-form.tsx, `importBaselineOpen`) — the automatic steps all
// run in effects before any input can reach the form.
//
// The keys are the form's side of lib/cards/import-fingerprint.ts's fields:
// everything but what isn't the card (visibility, tags, decks, the slug,
// the game system) and the source itself, compared on its own. Every
// FormValues key is in exactly one of the two lists
// (tests/unit/creator/import-baseline.test.ts holds them to the form's
// defaults), so a new field is a decision, never a miss.
// ---------------------------------------------------------------------------

export const IMPORT_BASELINE_KEYS = [
  "title",
  "nickname",
  "cost",
  "color_identity",
  "supertype",
  "printed_types",
  "card_type",
  "subtypes_text",
  "rarity",
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
  "art_position",
  "frame_style",
  "has_back_face",
  "back_face",
  "set_icon_url",
  "set_icon_code",
  "set_code",
  "collector_number",
  "lang",
  "watermark",
  "footer_text",
] as const satisfies readonly (keyof FormValues)[];

/** The rest of the form: not the card, or compared on its own (the
 *  source). */
export const NOT_COMPARED_FORM_KEYS = [
  "slug",
  "game_system_id",
  "tags_text",
  "visibility",
  "save_as_draft",
  "source_scryfall_id",
  "deck_id",
] as const satisfies readonly (keyof FormValues)[];

/** A second face is compared whole (its colour, crop and body too). */
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
  "art_position",
  "color_identity",
] as const satisfies readonly (keyof BackFaceFormValues)[];

export type ImportBaseline = { scryfallId: string; values: string };

/** The two texts whose blank is a choice of its own: an emptied Types field
 *  prints the subtypes alone, an emptied footer prints none (NULL is the
 *  built line / the profile's default). */
const BLANK_IS_A_VALUE = new Set<string>(["printed_types", "footer_text"]);

/** A value as the save reads it: trimmed text, and nothing for a blank, an
 *  empty array or object; object keys sorted. */
function settled(value: unknown, keepBlank = false): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return keepBlank ? value.trim() : value.trim() || null;
  if (Array.isArray(value)) {
    const items = value.map((item) => settled(item));
    return items.length > 0 ? items : null;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = settled((value as Record<string, unknown>)[key]);
      if (inner !== null) out[key] = inner;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return value;
}

function valuesKeyOf(values: Partial<FormValues>): string {
  const back = values.has_back_face && values.back_face ? values.back_face : null;
  return JSON.stringify([
    IMPORT_BASELINE_KEYS.filter((key) => key !== "back_face").map((key) => settled(values[key], BLANK_IS_A_VALUE.has(key))),
    back ? IMPORT_BASELINE_BACK_KEYS.map((key) => settled(back[key], BLANK_IS_A_VALUE.has(key))) : null,
  ]);
}

/** The baseline of the form as it stands (null when the values name no
 *  source printing). */
export function importBaselineOf(values: Partial<FormValues>): ImportBaseline | null {
  const scryfallId = values.source_scryfall_id?.trim();
  return scryfallId ? { scryfallId, values: valuesKeyOf(values) } : null;
}

/** Whether the form still holds exactly the baseline's values. */
export function matchesBaseline(baseline: ImportBaseline | null, values: Partial<FormValues>): boolean {
  return Boolean(baseline) && values.source_scryfall_id?.trim() === baseline!.scryfallId && valuesKeyOf(values) === baseline!.values;
}

/** What a NEW card's payload says about its import: nothing without an
 *  import this session (or once the maker changed or cleared its source),
 *  else whether every value is still the import's. */
export function importUnchangedPayload(
  baseline: ImportBaseline | null,
  values: Partial<FormValues>,
): { import_unchanged?: boolean } {
  if (!baseline || values.source_scryfall_id?.trim() !== baseline.scryfallId) return {};
  return { import_unchanged: valuesKeyOf(values) === baseline.values };
}
