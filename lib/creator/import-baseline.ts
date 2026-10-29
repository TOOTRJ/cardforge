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
// RE-TAKES it on every value change while its settle window is open
// (card-creator-form.tsx, `importBaselineOpen`). The window closes — so
// nothing the maker does is ever absorbed — on the FIRST of: a quiet spell
// (no render of the form for IMPORT_SETTLE_QUIET_MS after a commit's
// effects — the automatic steps' writes each render it again — capped at
// IMPORT_SETTLE_CAP_MS after the import's first commit); any user gesture anywhere on the
// page (window-level capture of pointer, key, wheel, paste, drop, drag,
// input, click and change events — a drag-pan, a Shift+wheel zoom, a
// dropped or pasted picture never pass through the form's own events); and
// every writer the maker sets off without one (an AI fill or idea, a toast
// action, Start over). The automatic steps all run in effects within a
// render of the import.
//
// The keys are the form's side of lib/cards/import-fingerprint.ts's fields:
// everything but what isn't the card (visibility, tags, decks, the slug,
// the game system) and the source itself, compared on its own. Every
// FormValues key is in exactly one of the two lists
// (tests/unit/creator/import-baseline.test.ts holds them to the form's
// defaults), so a new field is a decision, never a miss.
// ---------------------------------------------------------------------------

/** The settle window: closed once the form has gone this long without a
 *  render after the import (counted from each commit's effects, so a slow
 *  first render never closes it before the automatic steps have run)… */
export const IMPORT_SETTLE_QUIET_MS = 200;
/** …and never later than this after the import's first commit. */
export const IMPORT_SETTLE_CAP_MS = 800;

/** The user gestures that close the settle window, wherever they land. */
export const IMPORT_SETTLE_GESTURES = [
  "pointerdown",
  "mousedown",
  "touchstart",
  "keydown",
  "wheel",
  "paste",
  "drop",
  "dragstart",
  "input",
  "change",
  "click",
] as const;

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

/** `changed`: the form already held something the import isn't
 *  (preImportChanges) — the card can never save as the import's. */
export type ImportBaseline = { scryfallId: string; values: string; changed?: boolean };

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
 *  source printing); `changed` when the form already held something else
 *  before the import (preImportChanges). */
export function importBaselineOf(values: Partial<FormValues>, changed = false): ImportBaseline | null {
  const scryfallId = values.source_scryfall_id?.trim();
  if (!scryfallId) return null;
  return changed ? { scryfallId, values: valuesKeyOf(values), changed: true } : { scryfallId, values: valuesKeyOf(values) };
}

/** Whether the form still holds exactly the baseline's values. */
export function matchesBaseline(baseline: ImportBaseline | null, values: Partial<FormValues>): boolean {
  return Boolean(baseline) && values.source_scryfall_id?.trim() === baseline!.scryfallId && valuesKeyOf(values) === baseline!.values;
}

/** The baseline re-taken on the values as they now stand — the creator's
 *  settle window (an automatic step moved them) and "Fill from the
 *  printing" (the import's own collector line): the same object while
 *  nothing moved, and a card marked changed stays changed. */
export function retakenBaseline(baseline: ImportBaseline | null, values: Partial<FormValues>): ImportBaseline | null {
  if (!baseline || matchesBaseline(baseline, values)) return baseline;
  return importBaselineOf(values, baseline.changed === true);
}

/** What a NEW card's payload says about its import: nothing without an
 *  import this session (or once the maker changed or cleared its source),
 *  else whether every value is still the import's. */
export function importUnchangedPayload(
  baseline: ImportBaseline | null,
  values: Partial<FormValues>,
): { import_unchanged?: boolean } {
  if (!baseline || values.source_scryfall_id?.trim() !== baseline.scryfallId) return {};
  return { import_unchanged: baseline.changed !== true && valuesKeyOf(values) === baseline.values };
}

// ---------------------------------------------------------------------------
// What the form held BEFORE an import that the import leaves in place (the
// review's F2): the import handler (card-creator-form.tsx
// handleScryfallImport) writes the printing's text, type line, colour,
// rarity, frame and anatomy, nickname, rows, faces and source — but NEVER
// the footer, the watermark, the set icon or the frame's finish, nor the
// art when it brought none or the collector line when Scryfall gave none.
// A value there that a NEW card wouldn't have is the maker's (typed before
// the import, during the deck pre-fill's load, or on the card before a
// second import): the card is not the import's, whatever happens next.
// The keys are listed, never inferred — a key the handler conditionally
// writes elsewhere (the stats a kind change seeds) would read as changed.
// ---------------------------------------------------------------------------

export type ImportWrites = {
  /** The import brought its art (`importedArtUrl`). */
  art: boolean;
  /** The import named the printing's collector line (`patch.collector`). */
  collector: boolean;
};

/** The keys holding something the import didn't write and a new card
 *  (`newCard`: the form's new-card defaults; `newCardWatermark`: the
 *  watermark a new card of the import's type starts with — the kind change
 *  sets the free Rose itself) wouldn't have. Empty = nothing left over. */
export function preImportChanges(
  values: Partial<FormValues>,
  newCard: Partial<FormValues>,
  newCardWatermark: FormValues["watermark"],
  wrote: ImportWrites,
): string[] {
  const same = (a: unknown, b: unknown, keepBlank = false) =>
    JSON.stringify(settled(a, keepBlank)) === JSON.stringify(settled(b, keepBlank));
  const out: string[] = [];
  if (!same(values.footer_text, newCard.footer_text, true)) out.push("footer_text");
  if (!same(values.watermark, newCardWatermark)) out.push("watermark");
  if (!same(values.set_icon_url, newCard.set_icon_url)) out.push("set_icon_url");
  if (!same(values.set_icon_code, newCard.set_icon_code)) out.push("set_icon_code");
  if (!same(values.frame_style?.finish, newCard.frame_style?.finish)) out.push("frame_style.finish");
  if (!wrote.art && !same(values.art_url, newCard.art_url)) out.push("art_url");
  if (!wrote.collector) {
    for (const key of ["set_code", "collector_number", "lang"] as const) {
      if (!same(values[key], newCard[key])) out.push(key);
    }
  }
  return out;
}
