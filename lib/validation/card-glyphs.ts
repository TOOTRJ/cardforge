import { copyrightFace } from "@/lib/cards/copyright-slot";
import { tokenizeRulesText } from "@/lib/cards/rules-text";
import { collectorStyleOf, COLLECTOR_TEMPLATES } from "@/lib/cards/collector-line";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { faceOf, type FaceRole } from "@/lib/cards/type-faces";
import { drawsManaGem } from "@/lib/cards/mana-gem";
import { symbolStyle, symbolStyleOf, type SymbolStyleSpec } from "@/lib/cards/symbol-style";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import { pipOverrideForToken, type PipOverrides } from "@/lib/pips/override";
import {
  CARD_DISPLAY_COVERAGE,
  CARD_ITALIC_COVERAGE,
  CARD_RULES_COVERAGE,
  type CodepointRanges,
} from "@/lib/render/glyph-coverage";

// ---------------------------------------------------------------------------
// Characters the card IMAGE may not draw — a warning, never a validation
// error (TODO 6.16a). The bake draws with the card's printed fonts plus a
// bundled Noto Sans fallback and never fetches a font or emoji at render
// time, so:
//   * emoji are left out of the image (a blank space where they were);
//   * scripts no bundled font covers (CJK, Arabic, Hebrew, Thai, Indic…) and
//     symbols outside the card fonts (★, ⇒, ✗…) draw blank or as boxes;
//   * a character the face's first font maps to an EMPTY glyph vanishes —
//     MPlantin does that to Č, °, ×, →, đ and ~180 more, so they drop out of
//     rules text although MPlantin italic and Beleren have them;
//   * italic runs (flavor text, reminder text) never reach the Noto
//     fallback, so "Ǵ" draws in rules text but not in flavor text;
//   * in names, type lines, the footer and stats a character only the Noto
//     fallback has draws in some words and as a box in others — flagged, as
//     one that "may not show".
// The per-face tables come from the committed fonts
// (scripts/lib/glyph-coverage.mjs). The preview in the browser uses system
// fonts and shows all of them, which is exactly why the creator says so.
// Shared client + server; pure.
// ---------------------------------------------------------------------------

/** Which bake face a field is drawn with: "display" (titles, type lines,
 *  footer, stats), "rules" (rules text — read through the shared tokenizer,
 *  so its reminder text and ability words are checked as italic and its
 *  {mana} tokens, which become pips, are skipped — a saga's reminder
 *  block and chapters are rules text too, TODO 4.21c), "italic" (flavor
 *  text) or "body" (plain MPlantin: a collector card's footer
 *  mark in the © slot — TODO 4.9b — read as it is, no tokenizer). */
export type GlyphFace = "display" | "rules" | "italic" | "body";

export type GlyphCheckField = {
  label: string;
  face: GlyphFace;
  value: string | null | undefined;
  /** Some templates print this line in capitals (the artist / footer line):
   *  the upper-case form must draw too. */
  uppercase?: boolean;
};

export type UnrenderableField = { label: string; characters: string[] };

const COVERAGE: Record<GlyphFace, CodepointRanges> = {
  display: CARD_DISPLAY_COVERAGE,
  rules: CARD_RULES_COVERAGE,
  italic: CARD_ITALIC_COVERAGE,
  body: CARD_RULES_COVERAGE,
};

function covered(ranges: CodepointRanges, cp: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = ranges[mid];
    const start = typeof entry === "number" ? entry : entry[0];
    const end = typeof entry === "number" ? entry : entry[1];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

/** How a character is shown in the warning — invisible ones by code point. */
export function displayCharacter(grapheme: string): string {
  if (/^[\p{L}\p{N}\p{P}\p{S}\p{Extended_Pictographic}]/u.test(grapheme)) return grapheme;
  return Array.from(grapheme, (c) => `U+${(c.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

/** The bake prints U+2212 MINUS SIGN in rules / flavor text as a hyphen
 *  (bakeText in lib/render/card-image.tsx), so it is never missing there. */
function asBaked(grapheme: string, face: GlyphFace): string {
  return face === "display" ? grapheme : grapheme.replace(/−/g, "-");
}

function drawable(grapheme: string, face: GlyphFace, uppercase: boolean): boolean {
  const forms = uppercase ? [grapheme, grapheme.toUpperCase()] : [grapheme];
  return forms.every((form) =>
    Array.from(asBaked(form, face)).every((c) => covered(COVERAGE[face], c.codePointAt(0) as number)),
  );
}

/** Graphemes that draw nothing by design: whitespace, controls and
 *  zero-width / format characters never count. */
const INVISIBLE = /^[\s\p{Cc}\p{Cf}]+$/u;

function collect(found: string[], text: string, face: GlyphFace, uppercase: boolean): void {
  for (const g of graphemes(text)) {
    if (INVISIBLE.test(g) || found.includes(g)) continue;
    if (!drawable(g, face, uppercase)) found.push(g);
  }
}

/** The distinct characters (graphemes) of `text` the image may not draw with
 *  `face`, in order of first appearance. */
export function unrenderableCharacters(
  text: string | null | undefined,
  face: GlyphFace,
  { uppercase = false }: { uppercase?: boolean } = {},
): string[] {
  if (!text) return [];
  const found: string[] = [];
  if (face === "rules") {
    for (const paragraph of tokenizeRulesText(text)) {
      for (const item of paragraph) {
        if (item.t === "w") collect(found, item.v, item.em ? "italic" : "rules", uppercase);
      }
    }
  } else {
    collect(found, text, face, uppercase);
  }
  return found;
}

/** Warn-only: the labelled fields that hold characters the image may not draw. */
export function findUnrenderableText(fields: readonly GlyphCheckField[]): UnrenderableField[] {
  const out: UnrenderableField[] = [];
  for (const field of fields) {
    const characters = unrenderableCharacters(field.value, field.face, { uppercase: field.uppercase });
    if (characters.length) out.push({ label: field.label, characters });
  }
  return out;
}

/** The creator form values the check reads (a structural slice of
 *  lib/creator/form-types.ts `FormValues`). */
export type GlyphCheckValues = {
  title: string;
  /** The mana cost — read by the symbol check only (its pips are drawn by
   *  the mana font, never by a text face). */
  cost?: string;
  supertype: string;
  subtypes_text: string;
  rules_text: string;
  flavor_text: string;
  power: string;
  toughness: string;
  loyalty: string;
  defense: string;
  artist_credit: string;
  footer_text: string;
  loyalty_abilities?: ReadonlyArray<{ text: string }>;
  saga_intro: string;
  saga_chapters?: ReadonlyArray<{ text: string; numerals?: readonly number[] }>;
  /** The frame style's template and collector switch (TODO 4.9b): on a
   *  collector card the footer mark prints in the body face, as typed. */
  frame_style?: { template?: string | null; collector?: unknown } | null;
  has_back_face: boolean;
  back_face: {
    title: string;
    cost?: string;
    supertype: string;
    subtypes_text: string;
    rules_text: string;
    flavor_text: string;
    power: string;
    toughness: string;
    loyalty: string;
    defense: string;
  };
};

/** True when the card draws the collector line (TODO 4.9b): its switch
 *  names a style and its template has the slot (COLLECTOR_TEMPLATES — the
 *  same templates lib/cards/template-layout.ts declares it on). */
export function drawsCollectorLine(frameStyle: GlyphCheckValues["frame_style"]): boolean {
  if (!frameStyle || !collectorStyleOf(frameStyle.collector)) return false;
  return (COLLECTOR_TEMPLATES as readonly string[]).includes(normalizeFrameTemplate(frameStyle.template ?? undefined));
}

/** Every text field the card image draws, labelled as the creator labels it.
 *  On a collector card (4.9b) the artist is drawn in the display face as
 *  capitals still (its synthesized small caps), and the footer mark in the
 *  body face as typed — MPlantin in the © slot of a clean download. */
export function cardGlyphFields(v: GlyphCheckValues): GlyphCheckField[] {
  // The row arrays are always filled by the form's defaults, but the notice
  // renders on every step — a partial reset must not take the form down.
  const abilities = v.loyalty_abilities ?? [];
  const chapters = v.saga_chapters ?? [];
  const collector = drawsCollectorLine(v.frame_style);
  // The face each single-line field is DRAWN in is its frame's (TODO 4.8.0,
  // lib/cards/type-faces.ts): the display face on every profile today, so
  // nothing changed — and the body face's coverage where a profile sets a
  // slot in MPlantin.
  const profile = getFrameProfile(normalizeFrameTemplate(v.frame_style?.template ?? undefined));
  const glyphFace = (role: FaceRole): GlyphFace => (faceOf(profile, role).id === "body" ? "body" : "display");
  // (A profile without a footer draws no artist line; the check keeps the
  // display face it always used.)
  const footer: GlyphFace = profile.footer ? glyphFace("footer") : "display";
  // The check has always judged the artist and the footer mark as capitals
  // too (most footers upper-case their line); only a centred two-line footer
  // that sets mixed case (the 1997 frame's `Illus.` line, TODO 4.10a) is
  // judged as typed.
  const footerUpper = !(profile.copyrightSlot && !profile.footer?.uppercase);
  const fields: GlyphCheckField[] = [
    { label: "Name", face: glyphFace("name"), value: v.title },
    { label: "Type line", face: glyphFace("typeLine"), value: `${v.supertype} ${v.subtypes_text}` },
    { label: "Rules text", face: "rules", value: v.rules_text },
    ...abilities.map((row, i) => ({ label: `Loyalty ability ${i + 1}`, face: "rules" as const, value: row.text })),
    { label: "Saga intro", face: "rules", value: v.saga_intro },
    ...chapters.map((row, i) => ({ label: `Chapter ${i + 1}`, face: "rules" as const, value: row.text })),
    { label: "Flavor text", face: "italic", value: v.flavor_text },
    { label: "Stats", face: glyphFace("stat"), value: `${v.power} ${v.toughness} ${v.loyalty} ${v.defense}` },
    // (On a collector card the artist is the collector line's own display
    // small caps, whatever the footer slot says.)
    // The footer upper-cases its line only where its slot says so (the 1997
    // frame's `Illus.` line is mixed case, TODO 4.10a) — a collector card's
    // artist is capitals whatever the slot says.
    { label: "Artist", face: collector ? "display" : footer, value: v.artist_credit, uppercase: collector || footerUpper },
    collector
      ? { label: "Footer mark", face: "body", value: v.footer_text }
      : profile.copyrightSlot
        ? // A centred footer's © slot (4.10a): as typed, in the slot's face.
          { label: "Footer mark", face: copyrightFace(profile.copyrightSlot).id === "body" ? "body" : "display", value: v.footer_text }
        : { label: "Footer mark", face: footer, value: v.footer_text, uppercase: footerUpper },
  ];
  if (v.has_back_face) {
    const b = v.back_face;
    fields.push(
      { label: "Back face name", face: "display", value: b.title },
      { label: "Back face type line", face: "display", value: `${b.supertype} ${b.subtypes_text}` },
      { label: "Back face rules text", face: "rules", value: b.rules_text },
      { label: "Back face flavor text", face: "italic", value: b.flavor_text },
      { label: "Back face stats", face: "display", value: `${b.power} ${b.toughness} ${b.loyalty} ${b.defense}` },
    );
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Symbols the card may not draw — the same kind of warning, for `{…}` tokens.
//
// A `{…}` token in a mana cost or in rules text is a PIP, and a pip the mana
// font has no glyph for is left out of the preview and of the stored image
// alike: no disc, no room (lib/cards/mana-gem.ts — {21}, {C/P}, {1/2},
// {3/W}, the hybrid Phyrexian {W/U/P}, {A}, {CHAOS}…). The character check
// above skips those tokens, so this one names them. WHICH symbols draw is
// never listed here: every token is read by the renderers' own tokenizer
// (tokenize / tokenSuffix) and asked of their own gate (drawsManaGem), after
// the owner's custom pip image, which both renderers draw first
// (pipOverrideForToken — today only on {W}…{C}, which the font has anyway,
// so an override changes no answer yet).
//
// Flavor text is not read: neither renderer parses symbols there — a `{…}`
// in it prints as the characters typed.
// ---------------------------------------------------------------------------

export type SymbolCheckOptions = {
  /** The frame's symbol style (its own {T}); the modern one by default. */
  symbols?: SymbolStyleSpec;
  /** The card owner's custom pip images. */
  overrides?: PipOverrides | null;
};

const BRACE_TOKEN = /\{[^}]+\}/g;

/** The distinct `{…}` tokens of a mana cost or a rules-style text that the
 *  card leaves out, written as the tokenizer reads them (upper case), in
 *  order of first appearance. */
export function undrawableSymbols(
  text: string | null | undefined,
  { symbols = symbolStyle(undefined), overrides = null }: SymbolCheckOptions = {},
): string[] {
  if (!text) return [];
  const found: string[] = [];
  for (const match of text.matchAll(BRACE_TOKEN)) {
    for (const token of tokenize(match[0])) {
      if (pipOverrideForToken(token, overrides)) continue;
      const suffix = tokenSuffix(token);
      if (suffix == null || drawsManaGem(suffix, symbols)) continue;
      const written = `{${match[0].slice(1, -1).trim().toUpperCase()}}`;
      if (!found.includes(written)) found.push(written);
    }
  }
  return found;
}

export type SymbolCheckField = { label: string; value: string | null | undefined };

export type UndrawableSymbolField = { label: string; symbols: string[] };

/** Warn-only: the labelled fields that hold symbols the card leaves out. */
export function findUndrawableSymbols(
  fields: readonly SymbolCheckField[],
  options?: SymbolCheckOptions,
): UndrawableSymbolField[] {
  const out: UndrawableSymbolField[] = [];
  for (const field of fields) {
    const symbols = undrawableSymbols(field.value, options);
    if (symbols.length) out.push({ label: field.label, symbols });
  }
  return out;
}

/** Every field of the card whose `{…}` tokens are drawn as pips, labelled as
 *  the creator labels it: the costs and the rules-style texts (rules,
 *  loyalty rows, the saga's intro and chapters, the second face).
 *
 *  Only what the card DRAWS: a planeswalker frame with a filled loyalty row
 *  and a saga frame with a filled chapter draw their rows, never
 *  `rules_text` (both renderers) — and the form still holds one there, with
 *  no field to edit it in: the serialized copy an import or a saved card
 *  came with. Reading it would name a symbol twice, and keep naming it once
 *  the maker has taken it out of the row. With no filled row the renderers
 *  parse `rules_text` instead, so it is read. */
export function cardSymbolFields(v: GlyphCheckValues): SymbolCheckField[] {
  const profile = getFrameProfile(normalizeFrameTemplate(v.frame_style?.template ?? undefined));
  const abilities = v.loyalty_abilities ?? [];
  const chapters = v.saga_chapters ?? [];
  const rowsDrawn =
    (Boolean(profile.loyaltyRows) && abilities.some((row) => row.text.trim())) ||
    (Boolean(profile.chapters) &&
      chapters.some((row) => row.text.trim() && (row.numerals === undefined || row.numerals.length > 0)));
  const fields: SymbolCheckField[] = [
    { label: "Mana cost", value: v.cost },
    ...(rowsDrawn ? [] : [{ label: "Rules text", value: v.rules_text }]),
    ...abilities.map((row, i) => ({ label: `Loyalty ability ${i + 1}`, value: row.text })),
    { label: "Saga intro", value: v.saga_intro },
    ...chapters.map((row, i) => ({ label: `Chapter ${i + 1}`, value: row.text })),
  ];
  if (v.has_back_face) {
    fields.push(
      { label: "Back face mana cost", value: v.back_face.cost },
      { label: "Back face rules text", value: v.back_face.rules_text },
    );
  }
  return fields;
}

/** The symbol style of the frame the form is on (its {T}). */
export function cardSymbolStyle(v: Pick<GlyphCheckValues, "frame_style">): SymbolStyleSpec {
  return symbolStyleOf(getFrameProfile(normalizeFrameTemplate(v.frame_style?.template ?? undefined)));
}

const MAX_SYMBOLS_NAMED = 6;

/** "{21}", "{21} and {W/U/P}", "{21}, {C/P} and {1/2}" — at most six named,
 *  then "and 2 more". */
export function listSymbols(symbols: readonly string[]): string {
  const named = symbols.slice(0, MAX_SYMBOLS_NAMED);
  const more = symbols.length - named.length;
  if (more > 0) return `${named.join(", ")} and ${more} more`;
  if (named.length <= 1) return named.join("");
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/** The warning's one sentence: "{21} and {W/U/P} can't be drawn and will be
 *  left off the card". */
export function undrawableSymbolsMessage(symbols: readonly string[]): string {
  return `${listSymbols(symbols)} can't be drawn and will be left off the card`;
}
