// MPlantin's metrics — the body face both renderers set rules text in.
// The bake loads the REGULAR from node_modules/mana-font/fonts/mplantin.ttf
// and the italic from public/fonts/mplantin-italic.ttf (lib/render/
// card-fonts.ts); public/fonts/mplantin.ttf is the same bytes as the
// package's file (sha256 ebfb5d57…2ab5, mana-font 1.18.0), served to the
// browser beside its woff / woff2 copies (globals.css). Plain tables, so the client
// preview and the server bake measure with the SAME numbers and no font is
// parsed at runtime. The tables are GENERATED from both TTFs (TODO 3.20 /
// 4.8.0: lib/cards/font-metrics.ts, scripts/generate-font-metrics.mjs — by
// hand here until then); tests/unit/cards/rules-metrics.test.ts re-reads
// both TTFs and keeps every table in step with them.
//
// MPlantin has no kerning (no `kern` table, no GPOS), so a word's width is
// the sum of its advances in the browser and in Satori alike.
//
// Layout v33 (TODO 3.29): lib/cards/rules-layout.ts lays EVERY rules and
// flavor line out from these advances (and the ink extents below), and both
// renderers draw its lines. (The per-renderer wrap models this file used to
// hold — the planeswalker rows' shield check — went with it: the rows now
// read the layout's own lines, lib/cards/loyalty-rows.ts.)

import { BODY_FACE_METRICS, BODY_GLYPH_INK, BODY_INK_PER_MILLE, LINE_FACE_METRICS } from "@/lib/cards/font-metrics";

/** Advances of printable ASCII (U+0020–U+007E, in code-point order), in
 *  thousandths of an em (both masters have 1000 units per em). */
const REGULAR_ASCII = LINE_FACE_METRICS.body.asciiAdvanceUnits;
const ITALIC_ASCII = LINE_FACE_METRICS.bodyItalic.asciiAdvanceUnits;

/** The typographic punctuation rules text uses, in thousandths of an em. */
const REGULAR_EXTRA = BODY_FACE_METRICS.regular.extraAdvancePerMille;
const ITALIC_EXTRA = BODY_FACE_METRICS.italic.extraAdvancePerMille;

/** Advances of Latin-1 and Latin Extended-A (U+00A0–U+017F, in code-point
 *  order — the no-break space, «», ¿, °, ß, æ, ø, Œ, œ and every accented
 *  letter), each face's OWN glyph: an accented letter is not its base's
 *  width (the italic ě is 0.423 em against e's 0.385, Œ 1.031 against the
 *  1 em a fallback was budgeted), and where the regular master maps a letter
 *  to an empty glyph (its Ò, Ý, ý and most of Extended-A — lib/validation/
 *  card-glyphs.ts warns the creator) that glyph's 0.278 em is what both
 *  renderers advance. -1: the face has no glyph there (the regular master
 *  lacks 67 Extended-A letters the italic has) — a fallback face draws it. */
const REGULAR_LATIN = BODY_FACE_METRICS.regular.latinAdvancePerMille;
const ITALIC_LATIN = BODY_FACE_METRICS.italic.latinAdvancePerMille;

/** The first code point of the Latin tables. */
const LATIN_START = 0xa0;
const LATIN_END = 0x17f;

/** A character neither face draws (another script, an emoji, a precomposed
 *  letter past Latin Extended-A — a fallback face draws it): a full em,
 *  wider than any Latin letter the fallback has. */
const UNKNOWN_ADVANCE_EM = 1;

/** Whether one face draws `ch` itself (the range the tables cover). */
function faceHasChar(code: number, italic: boolean): boolean {
  return code >= LATIN_START && code <= LATIN_END && (italic ? ITALIC_LATIN : REGULAR_LATIN)[code - LATIN_START] >= 0;
}

function advancePerMille(ch: string, italic: boolean): number | undefined {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return (italic ? ITALIC_ASCII : REGULAR_ASCII)[code - 0x20];
  if (faceHasChar(code, italic)) return (italic ? ITALIC_LATIN : REGULAR_LATIN)[code - LATIN_START];
  return (italic ? ITALIC_EXTRA : REGULAR_EXTRA)[ch];
}

/** One character's advance in em, as both renderers set it: the face's own
 *  glyph's (the tables above), a combining accent's nothing, and anything
 *  the face lacks a full em. MPlantin has no U+2212 minus: both renderers
 *  set it as a hyphen (lib/cards/rules-box.ts rulesWordText), so it
 *  measures as one. */
function advanceEm(ch: string, italic: boolean): number {
  if (/\p{M}/u.test(ch)) return 0;
  const units = advancePerMille(ch === "−" ? "-" : ch, italic);
  return units === undefined ? UNKNOWN_ADVANCE_EM : units / 1000;
}

/** The width of `text` set in MPlantin (italic for reminder text and ability
 *  words), in ems of the rules size. */
export function rulesTextWidthEm(text: string, italic = false): number {
  let w = 0;
  for (const ch of text) w += advanceEm(ch, italic);
  return w;
}

// ---------------------------------------------------------------------------
// Vertical metrics — where a line's glyphs put ink (layout v33,
// lib/cards/rules-layout.ts): the first line's ink top against the box's top
// edge (an accented capital rises ≈ 0.1 em above a 0.98 em line box) and
// every line's ink against a keep-out (the P/T plate, the loyalty shield).
// ---------------------------------------------------------------------------

/** Each face's hhea ascender / descender (em): a line box of height L puts
 *  the baseline (L − (ascent + descent) × size) / 2 + ascent × size below its
 *  top, in the browser and in Satori alike. Both faces' content area is
 *  0.999 em; the 150-unit lineGap never applies (every run sets its own
 *  line height). */
export const MPLANTIN_LINE_METRICS = {
  regular: lineMetrics(LINE_FACE_METRICS.body),
  italic: lineMetrics(LINE_FACE_METRICS.bodyItalic),
} as const;

function lineMetrics(face: { ascender: number; descender: number; unitsPerEm: number }): { ascent: number; descent: number } {
  return { ascent: face.ascender / face.unitsPerEm, descent: face.descender / face.unitsPerEm };
}

/** How far a glyph's ink reaches above its baseline (`ascent`) and below it
 *  (`descent`), in em. Every letter and digit of both faces stays within
 *  0.70 / 0.20 (capitals and ascenders 0.699 and 0.693, descenders 0.192 and
 *  0.190). */
const DEFAULT_INK = { ascent: 0.7, descent: 0.2 } as const;

/** The characters both faces draw past DEFAULT_INK — the larger of the two
 *  faces' glyph bounds, per mille: accented capitals (Å 0.904), the few
 *  tall or deep ASCII marks, cedillas and ogoneks. */
const INK_PER_MILLE = BODY_INK_PER_MILLE;

/** A character neither face draws (another script, a decomposed accent, a
 *  symbol), or one of the 67 Extended-A letters the regular master lacks
 *  (a fallback face draws it there): the fallback face's extremes (Noto
 *  Sans 1.067 / 0.38) or MPlantin's stacked Vietnamese capitals (1.057),
 *  whichever is larger. */
const UNKNOWN_INK = { ascent: 1.07, descent: 0.38 } as const;

/** Whether both faces draw `ch` with their own glyph (the range the ink
 *  tables cover). */
function knownInk(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (ch in REGULAR_EXTRA) return true;
  return code >= 0xa1 && faceHasChar(code, false) && faceHasChar(code, true);
}

/** How far `text`'s ink reaches above and below its baseline, in em of the
 *  rules size — the most any of its characters reaches (either face; the
 *  italic's glyphs stay within the same table). U+2212 draws as a hyphen,
 *  like its advance. Empty text reaches nowhere. */
export function rulesTextInkEm(text: string): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  for (const raw of text) {
    const ch = raw === "−" ? "-" : raw;
    const known = knownInk(ch);
    const perMille = known ? INK_PER_MILLE[ch] : undefined;
    const ink = perMille
      ? { ascent: perMille[0] / 1000, descent: perMille[1] / 1000 }
      : known
        ? DEFAULT_INK
        : UNKNOWN_INK;
    if (ink.ascent > ascent) ascent = ink.ascent;
    if (ink.descent > descent) descent = ink.descent;
  }
  return { ascent, descent };
}

/** Each glyph's OWN ink, above and below the baseline, in hundredths of an
 *  em rounded UP (the larger of the two faces' outline bounds) — for the
 *  keep-outs, which judge a line glyph by glyph: an "x" dips 0.01 em below
 *  its baseline where rulesTextInkEm's band gives every letter a 0.20 em
 *  descender, so "tokens." a few px above a P/T plate's ink is clear of it
 *  (layout v33 review). Every character both faces draw is listed (the
 *  space, which draws nothing, is not); tests/unit/cards/rules-metrics
 *  .test.ts holds the table to both TTFs. */
const GLYPH_INK = BODY_GLYPH_INK;

const GLYPH_INK_BY_CHAR: ReadonlyMap<string, { ascent: number; descent: number }> = new Map(
  GLYPH_INK.flatMap(([chars, a, d]) => Array.from(chars, (ch) => [ch, { ascent: a / 100, descent: d / 100 }] as const)),
);

/** One glyph as a renderer sets it: its origin and advance along the word,
 *  and where its ink reaches — above / below the baseline, and left of its
 *  origin / right of its advance — all in em of the rules size. */
export type RulesGlyphEm = { x: number; advance: number; ascent: number; descent: number; left: number; right: number };

/**
 * `text` (a word, italic for any emphasis) glyph by glyph, as both renderers
 * set it — each glyph at the sum of the advances before it (MPlantin
 * doesn't kern) with its OWN ink: GLYPH_INK above and below (never past
 * rulesTextInkEm's band for that character), its overhang past its advance
 * box at the sides. A glyph that draws nothing (a space) is left out; a
 * combining accent, which a fallback face draws over the letter before it,
 * counts as a character neither face has, over that letter's box. What the
 * rules layout judges a keep-out by.
 */
export function rulesTextGlyphsEm(text: string, italic = false): RulesGlyphEm[] {
  const out: RulesGlyphEm[] = [];
  const sideTable = italic ? SIDE_INK_ITALIC : SIDE_INK_REGULAR;
  let x = 0;
  let last = { x: 0, advance: 0 };
  for (const raw of text) {
    const ch = raw === "−" ? "-" : raw;
    const advance = advanceEm(ch, italic);
    const known = knownInk(ch);
    const own = known ? GLYPH_INK_BY_CHAR.get(ch) : UNKNOWN_INK;
    if (own) {
      const band = rulesTextInkEm(ch);
      const side = known ? sideTable[ch] : undefined;
      const at = /\p{M}/u.test(ch) ? last : { x, advance };
      out.push({
        x: at.x,
        advance: at.advance,
        ascent: Math.min(own.ascent, band.ascent),
        descent: Math.min(own.descent, band.descent),
        left: known ? (side?.[0] ?? 0) / 1000 : UNKNOWN_SIDE_INK_EM,
        right: known ? (side?.[1] ?? 0) / 1000 : UNKNOWN_SIDE_INK_EM,
      });
    }
    if (advance > 0) last = { x, advance };
    x += advance;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Side ink — where a glyph draws past its own advance box: its left side
// bearing below zero (`left`) or its outline past its advance (`right`), per
// mille. A word that starts a line puts that much ink left of the line's
// start, one that ends it that much right of its end: an italic "f", "j" or
// "p" (0.13 / 0.13 / 0.07 em left), a roman "f" (0.10 em right), an italic
// "W" or "V" (0.14 em right). lib/cards/rules-layout.ts keeps that ink inside
// the box's clip (layout v33). Only the glyphs that reach past their box are
// listed; tests/unit/cards/rules-side-ink.test.ts holds both tables to the
// TTFs.
// ---------------------------------------------------------------------------

const SIDE_INK_REGULAR = BODY_FACE_METRICS.regular.sideInkPerMille;
const SIDE_INK_ITALIC = BODY_FACE_METRICS.italic.sideInkPerMille;

/** A character neither face draws: the fallback face's, generously. */
const UNKNOWN_SIDE_INK_EM = 0.1;

/** How far `text`'s ink reaches past its advance box: left of its first
 *  character's origin and right of its last character's advance, in em of
 *  the rules size (italic: reminder text, ability words, flavor). Mid-word
 *  overhangs fall on their neighbours. U+2212 is a hyphen, as drawn. */
export function rulesTextSideInkEm(text: string, italic = false): { left: number; right: number } {
  const chars = Array.from(text, (ch) => (ch === "−" ? "-" : ch)).filter((ch) => !/\p{M}/u.test(ch));
  if (chars.length === 0) return { left: 0, right: 0 };
  const table = italic ? SIDE_INK_ITALIC : SIDE_INK_REGULAR;
  const side = (ch: string, i: 0 | 1) => {
    if (!knownInk(ch)) return UNKNOWN_SIDE_INK_EM;
    return (table[ch]?.[i] ?? 0) / 1000;
  };
  return { left: side(chars[0], 0), right: side(chars[chars.length - 1], 1) };
}
