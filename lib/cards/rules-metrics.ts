// MPlantin's metrics — the body face both renderers set rules text in
// (public/fonts/mplantin.ttf + mplantin-italic.ttf, the committed masters:
// the bake loads them through lib/render/card-fonts.ts, the preview their
// same-metric web copies through globals.css). Plain tables, so the client
// preview and the server bake measure with the SAME numbers and no font is
// parsed at runtime. tests/unit/cards/rules-metrics.test.ts re-reads both
// TTFs and keeps every table in step with them.
//
// MPlantin has no kerning (no `kern` table, no GPOS), so a word's width is
// the sum of its advances in the browser and in Satori alike.
//
// Layout v33 (TODO 3.29): lib/cards/rules-layout.ts lays EVERY rules and
// flavor line out from these advances (and the ink extents below), and both
// renderers draw its lines. (The per-renderer wrap models this file used to
// hold — the planeswalker rows' shield check — went with it: the rows now
// read the layout's own lines, lib/cards/loyalty-rows.ts.)

/** Advances of printable ASCII (U+0020–U+007E, in code-point order), in
 *  thousandths of an em (both masters have 1000 units per em). */
const REGULAR_ASCII = [
  278, 292, 408, 668, 552, 906, 750, 180, 385, 385, 500, 667, 292, 365, 292, 278, // space … /
  552, 552, 552, 552, 552, 552, 552, 552, 552, 552, 292, 292, 667, 667, 667, 385, // 0 … ?
  921, 719, 688, 781, 844, 677, 656, 833, 854, 375, 354, 802, 677, 1010, 844, 813, // @ … O
  635, 813, 719, 594, 760, 833, 708, 1000, 781, 719, 677, 375, 278, 375, 469, 500, // P … _
  333, 479, 561, 469, 573, 469, 311, 500, 561, 271, 260, 510, 271, 865, 573, 542, // ` … o
  561, 561, 375, 396, 333, 573, 479, 729, 500, 479, 436, 480, 527, 480, 469, //      p … ~
] as const;

const ITALIC_ASCII = [
  238, 311, 420, 668, 490, 875, 948, 214, 448, 436, 521, 667, 311, 365, 311, 278, // space … /
  521, 521, 521, 521, 521, 521, 521, 521, 521, 521, 311, 311, 667, 667, 667, 406, // 0 … ?
  920, 729, 698, 708, 781, 656, 635, 792, 823, 375, 479, 771, 646, 979, 813, 792, // @ … O
  615, 792, 698, 604, 667, 771, 719, 979, 781, 719, 625, 375, 278, 375, 422, 500, // P … _
  333, 521, 469, 385, 500, 385, 281, 448, 521, 271, 240, 521, 240, 771, 531, 448, // ` … o
  490, 448, 344, 333, 292, 531, 521, 688, 490, 479, 490, 400, 527, 400, 429, //      p … ~
] as const;

/** The typographic punctuation rules text uses, in thousandths of an em. */
const REGULAR_EXTRA: Readonly<Record<string, number>> = {
  "‘": 292, "’": 292, "“": 510, "”": 510, "–": 500, "—": 1000, "•": 350, "…": 1000,
};
const ITALIC_EXTRA: Readonly<Record<string, number>> = {
  "‘": 311, "’": 311, "“": 542, "”": 542, "–": 500, "—": 1000, "•": 350, "…": 1031,
};

/** Advances of Latin-1 and Latin Extended-A (U+00A0–U+017F, in code-point
 *  order — the no-break space, «», ¿, °, ß, æ, ø, Œ, œ and every accented
 *  letter), each face's OWN glyph: an accented letter is not its base's
 *  width (the italic ě is 0.423 em against e's 0.385, Œ 1.031 against the
 *  1 em a fallback was budgeted), and where the regular master maps a letter
 *  to an empty glyph (its Ò, Ý, ý and most of Extended-A — lib/validation/
 *  card-glyphs.ts warns the creator) that glyph's 0.278 em is what both
 *  renderers advance. -1: the face has no glyph there (the regular master
 *  lacks 67 Extended-A letters the italic has) — a fallback face draws it. */
const REGULAR_LATIN = [
  278, 292, 552, 677, 667, 663, 278, 427, 332, 760, 313, 344, 278, 500, 760, 278, // U+00A0–U+00AF
  278, 667, 278, 278, 333, 500, 453, 278, 333, 278, 354, 344, 278, 906, 278, 385, // U+00B0–U+00BF
  719, 719, 719, 719, 719, 719, 1000, 781, 677, 677, 677, 677, 375, 375, 375, 375, // U+00C0–U+00CF
  844, 844, 278, 813, 813, 813, 813, 278, 813, 833, 833, 833, 833, 278, 635, 573, // U+00D0–U+00DF
  479, 479, 479, 479, 479, 479, 686, 469, 469, 469, 469, 469, 271, 271, 271, 271, // U+00E0–U+00EF
  514, 573, 542, 542, 542, 542, 542, 278, 542, 573, 573, 573, 573, 278, 561, 479, // U+00F0–U+00FF
  -1, -1, 278, 278, 278, 278, 278, 278, -1, -1, -1, -1, 278, 278, 278, 278, // U+0100–U+010F
  278, 278, -1, -1, -1, -1, -1, -1, 278, 278, 278, 278, -1, -1, 278, 278, // U+0110–U+011F
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // U+0120–U+012F
  278, 271, -1, -1, -1, -1, -1, -1, -1, 278, 278, -1, -1, 278, 278, 278, // U+0130–U+013F
  278, 677, 271, 278, 278, -1, -1, 278, 278, -1, -1, -1, -1, -1, -1, -1, // U+0140–U+014F
  278, 278, 1031, 760, 278, 278, -1, -1, 278, 278, 278, 278, -1, -1, 278, 278, // U+0150–U+015F
  594, 396, 278, 278, 278, 278, -1, -1, -1, -1, -1, -1, -1, -1, 278, 278, // U+0160–U+016F
  278, 278, -1, -1, -1, -1, -1, -1, 719, 278, 278, 278, 278, 278, 278, -1, // U+0170–U+017F
] as const;

const ITALIC_LATIN = [
  238, 311, 385, 646, 667, 648, 278, 458, 333, 760, 344, 396, 627, 351, 760, 420, // U+00A0–U+00AF
  369, 667, 345, 345, 333, 500, 453, 252, 333, 345, 292, 396, 802, 875, 785, 406, // U+00B0–U+00BF
  729, 729, 729, 729, 729, 729, 927, 708, 656, 656, 656, 656, 375, 375, 375, 375, // U+00C0–U+00CF
  781, 813, 746, 792, 792, 792, 792, 627, 792, 771, 771, 771, 771, 645, 615, 531, // U+00D0–U+00DF
  521, 521, 521, 521, 521, 521, 677, 385, 385, 385, 385, 385, 271, 271, 271, 271, // U+00E0–U+00EF
  500, 531, 448, 448, 448, 448, 448, 627, 448, 531, 531, 531, 531, 469, 490, 479, // U+00F0–U+00FF
  698, 520, 698, 520, 698, 519, 669, 404, 669, 404, 669, 404, 669, 404, 747, 538, // U+0100–U+010F
  759, 538, 589, 423, 589, 423, 589, 423, 589, 423, 589, 423, 718, 446, 718, 446, // U+0110–U+011F
  718, 446, 718, 446, 783, 540, 783, 540, 358, 291, 358, 291, 358, 291, 357, 289, // U+0120–U+012F
  358, 271, 700, 568, 343, 284, 690, 496, 532, 561, 266, 561, 266, 561, 266, 561, // U+0130–U+013F
  298, 646, 240, 740, 561, 740, 561, 740, 561, 563, 740, 544, 746, 497, 746, 497, // U+0140–U+014F
  746, 497, 1021, 677, 635, 388, 635, 388, 635, 388, 495, 357, 495, 357, 495, 354, // U+0150–U+015F
  604, 333, 636, 325, 636, 325, 631, 329, 742, 561, 742, 561, 742, 561, 742, 561, // U+0160–U+016F
  742, 561, 742, 561, 997, 705, 645, 469, 719, 620, 437, 620, 437, 620, 437, 244, // U+0170–U+017F
] as const;

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
  regular: { ascent: 0.774, descent: 0.225 },
  italic: { ascent: 0.772, descent: 0.227 },
} as const;

/** How far a glyph's ink reaches above its baseline (`ascent`) and below it
 *  (`descent`), in em. Every letter and digit of both faces stays within
 *  0.70 / 0.20 (capitals and ascenders 0.699 and 0.693, descenders 0.192 and
 *  0.190). */
const DEFAULT_INK = { ascent: 0.7, descent: 0.2 } as const;

/** The characters both faces draw past DEFAULT_INK — the larger of the two
 *  faces' glyph bounds, per mille: accented capitals (Å 0.904), the few
 *  tall or deep ASCII marks, cedillas and ogoneks. */
const INK_PER_MILLE: Readonly<Record<string, readonly [number, number]>> = {
  "%": [706, 200], "*": [748, 200], "@": [700, 216], "_": [700, 266], "{": [700, 216],
  "|": [814, 200], "}": [700, 216], "²": [793, 200], "³": [793, 200], "µ": [700, 216],
  "¶": [700, 216], "¸": [700, 201], "¹": [793, 200], "½": [706, 200], "À": [901, 200],
  "Á": [901, 200], "Â": [883, 200], "Ã": [868, 200], "Ä": [837, 200], "Å": [904, 200],
  "Ç": [700, 201], "È": [901, 200], "É": [901, 200], "Ê": [883, 200], "Ë": [837, 200],
  "Ì": [901, 200], "Í": [901, 200], "Î": [883, 200], "Ï": [837, 200], "Ñ": [868, 200],
  "Ò": [865, 200], "Ó": [901, 200], "Ô": [883, 200], "Õ": [868, 200], "Ö": [837, 200],
  "Ø": [709, 200], "Ù": [901, 200], "Ú": [901, 200], "Û": [883, 200], "Ü": [837, 200],
  "Ý": [854, 200], "ç": [700, 201], "ý": [709, 267], "Ă": [850, 200], "Ą": [700, 254],
  "ą": [700, 251], "Ć": [870, 200], "ć": [709, 200], "Č": [873, 200], "č": [708, 200],
  "Ď": [858, 200], "ď": [746, 200], "đ": [746, 200], "Ę": [700, 253], "ę": [700, 251],
  "Ě": [856, 200], "ě": [708, 200], "Ğ": [863, 200], "ğ": [700, 267], "İ": [848, 200],
  "Ĺ": [855, 200], "ĺ": [907, 200], "ľ": [746, 200], "ŀ": [746, 200], "Ń": [854, 200],
  "ń": [709, 200], "Ň": [840, 200], "ň": [708, 200], "Ő": [878, 200], "Ŕ": [854, 200],
  "ŕ": [709, 200], "Ř": [856, 200], "ř": [708, 200], "Ś": [870, 200], "ś": [709, 200],
  "Ş": [700, 242], "ş": [700, 238], "Š": [892, 200], "Ţ": [708, 235], "ţ": [700, 235],
  "Ť": [856, 200], "ť": [711, 200], "Ů": [886, 200], "Ű": [867, 200], "Ÿ": [837, 200],
  "Ź": [854, 200], "ź": [708, 200], "Ż": [846, 200], "Ž": [858, 200], "ž": [707, 200],
};

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
const GLYPH_INK: readonly (readonly [string, number, number])[] = [
  ["¦", 0, 0], ["_", 0, 27], ["¸", 2, 21], [".…", 12, 2], [",", 17, 16], ["­", 27, 0],
  ["-–—", 28, 0], ["·", 31, 0], ["¬", 39, 0], ["x", 45, 1], ["uvw", 45, 2], ["y", 45, 20],
  ["µ", 45, 22], ["•", 46, 0], [":aceosæœ", 46, 2], [";", 46, 16], ["g", 46, 20], ["ç", 46, 21],
  ["r", 47, 0], ["mnı", 47, 1], ["z", 47, 2], ["ø", 47, 3], ["q", 47, 20], ["=«»÷", 48, 0],
  ["ş", 48, 24], ["ąę", 48, 26], ["×", 51, 0], ["~", 52, 0], ["p¡¿", 52, 20], ["t", 53, 2],
  ["¤", 57, 0], ["<>", 58, 0], ["+", 59, 0], ["¢", 60, 14], ["ţ", 62, 24], ["¨¯", 63, 0],
  ["ï", 63, 1], ["äëöü", 63, 2], ["ÿ", 63, 20], ["ñ", 64, 1], ["ãõ", 64, 2], ["12ªº", 67, 0],
  ["î", 67, 1], ["0346789âêôû", 67, 2], ["ż", 67, 3], ["¶", 67, 22], ["\"'^`´", 68, 0],
  ["ìí", 68, 1], ["©®àáèéòóùúăš", 68, 2], ["#±", 68, 3], ["ğ", 68, 27],
  ["EFHIKLMPRTXYZ¥ÆÞĐĽĿŁŒ", 69, 0], ["BDNÐ", 69, 1], ["5UVWå", 69, 2], ["¼¾", 69, 3],
  ["Ę", 69, 26], ["A‘’“”°", 70, 0], ["hiklðł", 70, 1], ["!&/?CGOS\\bdőůű", 70, 2], ["$", 70, 12],
  ["()J[]fß", 70, 19], ["Qj£§þ", 70, 20], ["Ç", 70, 21], ["@{}", 70, 22], ["Ş", 70, 25],
  ["Ą", 70, 26], ["ćčěńňŕřś", 71, 2], ["½Øźž", 71, 3], ["%", 71, 4], ["Ţ", 71, 24], ["ý", 71, 27],
  ["ť", 72, 2], ["*", 75, 0], ["ďđľŀ", 75, 2], ["²³¹", 80, 0], ["|", 82, 2], ["ÄËÏŸ", 84, 0],
  ["Ň", 84, 1], ["ÖÜ", 84, 2], ["ĂİŻ", 85, 0], ["ÝĎĚĹŤŹŽ", 86, 0], ["ŃŔŘ", 86, 1], ["Ã", 87, 0],
  ["Ñ", 87, 1], ["ÒÕĆĞŚŰ", 87, 2], ["ČŐ", 88, 2], ["ÂÊÎ", 89, 0], ["ÔÛŮ", 89, 2], ["Š", 90, 2],
  ["ÀÁÅÈÉÌÍ", 91, 0], ["ÓÙÚĺ", 91, 2],
];

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

const SIDE_INK_REGULAR: Readonly<Record<string, readonly [number, number]>> = {
  "/": [15, 15], J: [34, 1], K: [0, 15], L: [0, 22], R: [0, 23], "\\": [15, 15], _: [8, 8],
  f: [0, 98], k: [0, 2], r: [0, 4], "–": [6, 6], "—": [6, 6], "¶": [3, 4], Æ: [18, 0], î: [2, 2],
  ï: [2, 4], Ł: [0, 22],
};

const SIDE_INK_ITALIC: Readonly<Record<string, readonly [number, number]>> = {
  "0": [0, 15], "4": [0, 3], "5": [0, 9], "6": [0, 26], "7": [0, 60], "8": [0, 22], "9": [0, 6],
  "!": [0, 36], '"': [0, 117], $: [0, 25], "&": [0, 30], "'": [0, 68], "(": [0, 113], ")": [108, 0],
  "*": [0, 65], ",": [6, 0], "/": [50, 117], ";": [29, 0], A: [53, 0], C: [0, 27], E: [0, 48],
  F: [0, 71], G: [0, 13], H: [0, 79], I: [0, 77], J: [82, 64], K: [3, 102], L: [0, 3],
  M: [19, 37], N: [3, 80], P: [0, 75], S: [0, 32], T: [0, 105], U: [0, 94], V: [0, 133],
  W: [0, 144], X: [15, 89], Y: [0, 106], Z: [8, 67], "[": [0, 129], "]": [105, 1], "^": [5, 5],
  _: [67, 0], "`": [0, 15], d: [0, 52], f: [127, 157], g: [25, 42], i: [0, 38], j: [131, 53],
  l: [0, 54], p: [70, 0], r: [0, 46], t: [0, 37], y: [94, 0], "~": [0, 20], "‘": [0, 63],
  "’": [0, 42], "“": [0, 67], "”": [0, 35], "–": [6, 6], "—": [6, 6], "¡": [9, 0], "¢": [0, 31],
  "£": [93, 94], "¥": [0, 105], "§": [70, 85], "¨": [0, 77], "«": [0, 9], "°": [0, 19], "²": [0, 8],
  "´": [0, 44], µ: [59, 0], "¶": [3, 4], "¸": [48, 0], À: [53, 0], Á: [53, 0], Â: [53, 7],
  Ã: [53, 47], Ä: [53, 32], Å: [53, 0], Æ: [60, 61], Ç: [0, 27], È: [0, 48], É: [0, 48],
  Ê: [0, 48], Ë: [0, 48], Ì: [0, 77], Í: [0, 82], Î: [0, 90], Ï: [0, 115], Ñ: [3, 80],
  Ù: [0, 94], Ú: [0, 94], Û: [0, 94], Ü: [0, 94], Ý: [0, 79], Þ: [0, 40], ß: [144, 11],
  ç: [22, 0], é: [0, 18], ê: [0, 26], ë: [0, 51], ì: [0, 46], í: [0, 75], î: [0, 83],
  ï: [0, 108], õ: [0, 35], ö: [0, 20], ý: [62, 7], þ: [70, 0], ÿ: [94, 4], Ă: [20, 0],
  Ą: [20, 0], Ć: [0, 19], ć: [0, 38], Č: [0, 19], č: [0, 36], ď: [0, 159], đ: [0, 68],
  Ę: [0, 4], Ě: [0, 4], ě: [0, 18], ğ: [48, 61], İ: [0, 48], ĺ: [0, 107], ľ: [0, 157],
  ŀ: [0, 60], Ł: [0, 3], ł: [2, 79], Ń: [0, 65], Ň: [0, 65], Œ: [0, 63], ŕ: [0, 33],
  ř: [0, 29], Ś: [0, 1], ś: [0, 47], Š: [0, 32], š: [0, 105], Ţ: [0, 58], ţ: [0, 35],
  Ť: [0, 58], ť: [0, 116], Ů: [0, 73], Ű: [0, 73], Ÿ: [0, 106], Ź: [0, 31], ź: [0, 29],
  Ż: [0, 31], ż: [0, 29], Ž: [0, 31], ž: [0, 29],
};

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
