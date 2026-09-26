import {
  CARD_BODY_COVERAGE,
  CARD_DISPLAY_COVERAGE,
  type CodepointRanges,
} from "@/lib/render/glyph-coverage";

// ---------------------------------------------------------------------------
// Characters the card IMAGE can't draw — a warning, never a validation error
// (TODO 6.16a). The bake draws with the card's printed fonts plus a bundled
// Noto Sans fallback and never fetches a font or emoji at render time, so:
//   * emoji are left out of the image (a blank space where they were);
//   * scripts no bundled font covers (CJK, Arabic, Hebrew, Thai, Indic…) and
//     symbols outside the card fonts (★, ⇒, ✗…) draw as missing-glyph boxes;
//   * titles, type lines, the artist line and stats use CardDisplay (Beleren
//     Bold) alone, so there anything Beleren lacks shows as a box.
// The preview in the browser uses system fonts and shows all of them, which
// is exactly why the creator says so. Shared client + server; pure.
// ---------------------------------------------------------------------------

/** Which bake face a field is drawn with (see lib/cards/template-layout.ts
 *  `font`: title/type/footer/stats are "display", rules/flavor "body"). */
export type GlyphFace = "display" | "body";

export type GlyphCheckField = { label: string; face: GlyphFace; value: string | null | undefined };

export type UnrenderableField = { label: string; characters: string[] };

const COVERAGE: Record<GlyphFace, CodepointRanges> = {
  display: CARD_DISPLAY_COVERAGE,
  body: CARD_BODY_COVERAGE,
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

/** The distinct characters (graphemes) of `text` the image can't draw with
 *  `face`, in order of first appearance. Whitespace never counts. */
export function unrenderableCharacters(text: string | null | undefined, face: GlyphFace): string[] {
  if (!text) return [];
  const ranges = COVERAGE[face];
  const found: string[] = [];
  for (const g of graphemes(text)) {
    if (/^[\s\p{Cc}]+$/u.test(g) || found.includes(g)) continue;
    const drawable = Array.from(g).every((c) => covered(ranges, c.codePointAt(0) as number));
    if (!drawable) found.push(g);
  }
  return found;
}

/** Warn-only: the labelled fields that hold characters the image can't draw. */
export function findUnrenderableText(fields: readonly GlyphCheckField[]): UnrenderableField[] {
  const out: UnrenderableField[] = [];
  for (const field of fields) {
    const characters = unrenderableCharacters(field.value, field.face);
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
  loyalty_abilities: ReadonlyArray<{ text: string }>;
  saga_intro: string;
  saga_chapters: ReadonlyArray<{ text: string }>;
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
  const fields: GlyphCheckField[] = [
    { label: "Name", face: "display", value: v.title },
    { label: "Type line", face: "display", value: `${v.supertype} ${v.subtypes_text}` },
    { label: "Rules text", face: "body", value: v.rules_text },
    ...v.loyalty_abilities.map((row, i) => ({ label: `Loyalty ability ${i + 1}`, face: "body" as const, value: row.text })),
    { label: "Saga intro", face: "body", value: v.saga_intro },
    ...v.saga_chapters.map((row, i) => ({ label: `Chapter ${i + 1}`, face: "body" as const, value: row.text })),
    { label: "Flavor text", face: "body", value: v.flavor_text },
    { label: "Stats", face: "display", value: `${v.power} ${v.toughness} ${v.loyalty} ${v.defense}` },
    { label: "Artist", face: "display", value: v.artist_credit },
    { label: "Footer mark", face: "display", value: v.footer_text },
  ];
  if (v.has_back_face) {
    const b = v.back_face;
    fields.push(
      { label: "Back face name", face: "display", value: b.title },
      { label: "Back face type line", face: "display", value: `${b.supertype} ${b.subtypes_text}` },
      { label: "Back face rules text", face: "body", value: b.rules_text },
      { label: "Back face flavor text", face: "body", value: b.flavor_text },
      { label: "Back face stats", face: "display", value: `${b.power} ${b.toughness} ${b.loyalty} ${b.defense}` },
    );
  }
  return fields;
}
