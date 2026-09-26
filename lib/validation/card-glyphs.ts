import { tokenizeRulesText } from "@/lib/cards/rules-text";
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
//   * italic runs (flavor text, reminder text, a saga's intro) never reach
//     the Noto fallback, so "Ǵ" draws in rules text but not in flavor text;
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
 *  {mana} tokens, which become pips, are skipped) or "italic" (flavor text,
 *  a saga's intro). */
export type GlyphFace = "display" | "rules" | "italic";

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
  saga_chapters?: ReadonlyArray<{ text: string }>;
  has_back_face: boolean;
  back_face: {
    title: string;
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

/** Every text field the card image draws, labelled as the creator labels it. */
export function cardGlyphFields(v: GlyphCheckValues): GlyphCheckField[] {
  // The row arrays are always filled by the form's defaults, but the notice
  // renders on every step — a partial reset must not take the form down.
  const abilities = v.loyalty_abilities ?? [];
  const chapters = v.saga_chapters ?? [];
  const fields: GlyphCheckField[] = [
    { label: "Name", face: "display", value: v.title },
    { label: "Type line", face: "display", value: `${v.supertype} ${v.subtypes_text}` },
    { label: "Rules text", face: "rules", value: v.rules_text },
    ...abilities.map((row, i) => ({ label: `Loyalty ability ${i + 1}`, face: "rules" as const, value: row.text })),
    { label: "Saga intro", face: "italic", value: v.saga_intro },
    ...chapters.map((row, i) => ({ label: `Chapter ${i + 1}`, face: "rules" as const, value: row.text })),
    { label: "Flavor text", face: "italic", value: v.flavor_text },
    { label: "Stats", face: "display", value: `${v.power} ${v.toughness} ${v.loyalty} ${v.defense}` },
    { label: "Artist", face: "display", value: v.artist_credit, uppercase: true },
    { label: "Footer mark", face: "display", value: v.footer_text, uppercase: true },
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
