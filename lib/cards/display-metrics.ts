// Beleren Bold's metrics — the CardDisplay face both renderers draw names and
// type lines in (public/fonts/Beleren-Bold.ttf, the committed master: the
// bake loads it through lib/render/card-fonts.ts, the preview its
// same-metric .woff2 through globals.css). Plain tables, so the client
// preview and the server bake measure a line with the SAME numbers and no
// font is parsed at runtime. tests/unit/cards/display-metrics.test.ts
// re-reads the TTF and keeps every table in step with it; if the font is
// ever replaced (TODO 4.8's Beleren2016), it fails until they are
// re-measured.
//
// The single-line fit (fitSingleLineSizePct) otherwise counts every
// character at one average advance, 0.56 em. That errs wide on purpose for
// type lines, but it is off by -20 % ("Second Half Title") to +60 %
// ("WWWW…") on a short bar, and a name that only just reaches the pips would
// shrink ~13 % when it needed under 1 % (Miner the Miner, Damned Delver).
// Two fits measure here instead, each with its own policy:
//
//   * displayTextWidthEm — the name next to a detached cost (m15pw, modern;
//     lib/cards/title-band.ts). The advances alone, each to the nearest
//     thousandth of an em. Kerning is left out: Beleren's pairs mostly
//     tighten (a public title's kerned width is 97.5 % of this sum at the
//     median, 101.2 % at the worst), and the title fit keeps its own
//     headroom (TITLE_FIT_HEADROOM) for the rest.
//   * displayTextEm — aftermath's sideways name and type bars
//     (secondFaceLineSizes in lib/cards/render-tiers.ts). The advances
//     rounded UP, plus every pair the browser kerns APART (KERN_WIDENING),
//     so a measured line is an upper bound for both renderers.
//
// Both read ONE advance table, in the font's own units.

/** Beleren Bold's units per em. */
const UNITS_PER_EM = 2048;

/** Advances of printable ASCII (U+0020–U+007E, in code-point order), in font
 *  units (UNITS_PER_EM to the em). */
const ASCII_ADVANCE_UNITS = [
  491, 606, 829, 1269, 927, 1761, 1290, 440, 710, 710, 1113, 1269, 565, 1071, 565, 847, // space … /
  1269, 921, 1073, 1013, 1165, 1073, 1204, 1011, 1220, 1204, 565, 565, 1269, 1269, 1269, 1097, // 0 … ?
  1597, 1308, 1230, 1212, 1427, 1112, 1003, 1411, 1443, 716, 727, 1351, 1034, 1720, 1382, 1470, // @ … O
  1208, 1470, 1300, 1042, 1126, 1320, 1228, 1843, 1327, 1228, 1079, 710, 727, 710, 1269, 1024, // P … _
  819, 1046, 1208, 1007, 1198, 1044, 757, 1024, 1218, 604, 604, 1128, 604, 1712, 1220, 1159, // ` … o
  1208, 1187, 870, 829, 768, 1208, 1044, 1515, 1116, 1044, 937, 710, 614, 710, 1269, //         p … ~
] as const;

/** The typographic punctuation card names and type lines use (curly quotes,
 *  dashes, the ellipsis, a bullet, the minus sign), in font units. */
const EXTRA_ADVANCE_UNITS: Readonly<Record<string, number>> = {
  "‘": 565, // left single quote
  "’": 565, // right single quote / apostrophe
  "“": 1028, // left double quote
  "”": 1028, // right double quote
  "–": 1374, // en dash
  "—": 1701, // em dash
  "•": 749, // bullet
  "…": 1781, // ellipsis
  "−": 1311, // minus sign
};

/** A listed character's advance in font units; undefined for any other. */
function advanceUnits(ch: string): number | undefined {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return ASCII_ADVANCE_UNITS[code - 0x20];
  return EXTRA_ADVANCE_UNITS[ch];
}

// ---------------------------------------------------------------------------
// displayTextWidthEm — the name before a detached cost.
// ---------------------------------------------------------------------------

/** A character the table does not know (another script, an emoji): counted
 *  at a full em, wider than any Latin capital here, so a name set in a
 *  fallback face shrinks early rather than ellipsizing. */
const UNKNOWN_ADVANCE_EM = 1;

/** A listed advance to the nearest thousandth of an em. */
function nearestEm(units: number): number {
  return Math.round((units * 1000) / UNITS_PER_EM) / 1000;
}

/** One character's advance in em. Accented Latin letters measure as their
 *  base letter: Beleren draws them on the same advance (ñ = n, é = e) or a
 *  little narrower (ō by 0.034 em), so they are never under-counted. */
function advanceEm(ch: string): number {
  if (/\p{M}/u.test(ch)) return 0; // a combining accent rides on its letter
  const units = advanceUnits(ch) ?? advanceUnits(ch.normalize("NFD").charAt(0));
  return units === undefined ? UNKNOWN_ADVANCE_EM : nearestEm(units);
}

/**
 * Width of one line of display-face text at a 1 em font size (multiply by the
 * font size for the drawn width): the sum of its advances plus the letter
 * spacing after every character, as both renderers set it.
 */
export function displayTextWidthEm(
  text: string,
  { letterSpacingEm = 0, uppercase = false }: { letterSpacingEm?: number; uppercase?: boolean } = {},
): number {
  const chars = Array.from(uppercase ? text.toUpperCase() : text);
  return chars.reduce((w, ch) => w + advanceEm(ch) + letterSpacingEm, 0);
}

// ---------------------------------------------------------------------------
// displayTextEm — aftermath's sideways bars.
// ---------------------------------------------------------------------------

// Anything else (after dropping accents: é → e): a little over a capital's
// average, so an unknown glyph shrinks a line early rather than late.
const FALLBACK_PER_MILLE = 700;

// Beleren's POSITIVE kerning pairs (ASCII, ≥ 0.01 em), in thousandths of an
// em: left character → "<right><amount>" entries. The browser applies them
// ("Ry" sets 0.31 em wider than its letters, a run of W's 9%); the bake
// doesn't, and the negative pairs only tighten a line, so counting just
// these keeps a measured line an upper bound for both renderers.
const KERN_WIDENING: Record<string, string> = {
  "*": "T88 v44 w44 y44 z22",
  "/": "778",
  "1": "/44",
  "3": "434",
  "5": "434",
  "7": "7110",
  A: "A99 X99 Z55 m11 n11 r11 x66 z44",
  C: "A22",
  F: "*110 J88 S22 T110 V66 W66 X22 Y66 v44 w44 y44",
  G: "j22",
  K: ")330 ,154 :154 ;154 A110 J188 T34 V66 W66 Y66 Z44 [265 ]309 g110 j286 p154 x22 y254 }330",
  L: "&22 A66 S11 X44 x22",
  P: "T55 v22 w22 y22",
  Q: ")330 ,154 :154 ;154 J210 [265 ]330 g110 j286 p166 y242 }330",
  R: ")375 ,177 :177 ;177 A144 J254 X99 Z55 [330 ]375 g166 j330 m44 n44 p210 r44 s22 x78 y309 z55 }375",
  T: "*88 ?22 J66 S66 T110 V44 W44 Y44 Z22 v34 w34 y34",
  V: "J110 T44 V88 W88 X44 Y78",
  W: "J110 T44 V88 W88 X44 Y78",
  X: "A78 J66 V44 W44 Y44 g44",
  Y: "J110 N22 T44 V78 W78 X44 Y78",
  Z: "A11 J34",
  b: "c11 d11 e11 o11 q11",
  f: "!110 \"154 '154 )166 *198 ?154 B44 D44 E44 F44 H44 I44 J210 K44 L44 M44 N88 P44 R44 S99 T188 U55 V166 W166 X133 Z88 ]166 b144 h144 i88 j88 k144 l144 m34 n34 p34 r34 u34 x66 }166",
  g: "A44 S44 T44 X22 Z11 v44 w44 x34 y44 z22",
  k: "*44 A88 T66 X66 Z22 g78 h34 i22 j22 k34 l34 m34 n34 r34 v55 w55 x99 y55 z88",
  o: "c11 d11 e11 o11 q11",
  p: "c11 d11 e11 o11 q11",
  r: "T55 g11 v55 w55 x22 y55",
  u: "A55",
  v: "*44 S22 T34 v55 w55 x22 y55",
  w: "*44 S22 T34 v55 w55 x22 y55",
  x: "A66 v11 w11 y11",
  y: "*44 S22 T34 v55 w55 x22 y55",
  z: "*44 S11 v11 w11 y11",
};

const KERN_PAIRS = new Map<string, number>();
for (const [left, entries] of Object.entries(KERN_WIDENING)) {
  for (const entry of entries.split(" ")) KERN_PAIRS.set(left + entry[0], Number(entry.slice(1)));
}

/** The amount (thousandths of an em) the browser kerns `pair` apart; 0 for
 *  a pair it sets tighter or as is. */
export function kernWidening(pair: string): number {
  return KERN_PAIRS.get(pair) ?? 0;
}

/** One character's advance in thousandths of an em, rounded UP. */
function perMille(ch: string): number {
  const units = advanceUnits(ch);
  if (units !== undefined) return Math.ceil((units * 1000) / UNITS_PER_EM);
  const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
  if (base.length === 1 && base !== ch) return perMille(base);
  return FALLBACK_PER_MILLE;
}

/** The width of `text` set in Beleren Bold, in ems: the letters' advances
 *  plus every pair the browser kerns apart (never the pairs it tightens), so
 *  a line measured with it fits in the preview and the bake alike. */
export function displayTextEm(text: string | null | undefined): number {
  const chars = [...(text ?? "")];
  let total = 0;
  for (let i = 0; i < chars.length; i += 1) {
    total += perMille(chars[i]);
    if (i > 0) total += kernWidening(chars[i - 1] + chars[i]);
  }
  return total / 1000;
}
