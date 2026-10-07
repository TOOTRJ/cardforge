// Single-line text metrics — the faces both renderers draw names, type
// lines, footers and stats in (lib/cards/type-faces.ts): the CardDisplay face
// (Beleren Bold, public/fonts/Beleren-Bold.ttf — the bake loads it through
// lib/render/card-fonts.ts, the preview its same-metric .woff2 through
// globals.css) and, for a slot a profile sets in it, the body face
// (MPlantin). Plain tables, so the client preview and the server bake
// measure a line with the SAME numbers and no font is parsed at runtime.
//
// The tables are GENERATED from the committed TTFs (TODO 3.20 / 4.8.0:
// lib/cards/font-metrics.ts, written by scripts/generate-font-metrics.mjs;
// they were kept by hand here until then). tests/unit/cards/
// display-metrics.test.ts re-reads the TTFs and holds every entry to them,
// and tests/unit/cards/font-metrics.test.ts fails while the generated module
// is stale — so replacing a font file fails both until it is regenerated.
// Every function takes the FACE to measure in (default: the display face);
// the fits pass their slot's (lib/cards/type-faces.ts slotFace).
//
// The single-line fit (fitSingleLineSizePct) otherwise counts every
// character at one average advance, 0.56 em. That errs wide on purpose for
// type lines, but it is off by -20 % ("Second Half Title") to +60 %
// ("WWWW…") on a short bar, and a name that only just reaches the pips would
// shrink ~13 % when it needed under 1 % (Miner the Miner, Damned Delver).
// Two fits measure here instead, each with its own policy:
//
//   * displayTextWidthEm — the name: next to a detached cost (modern), and
//     every name on a measured slot (the M15-era family, layout v32;
//     fitTitleBand in lib/cards/title-band.ts). The advances alone, each to
//     the nearest thousandth of an em — the box the bake lays a name out in.
//     Kerning is left out: Beleren's pairs mostly tighten (a public title's
//     kerned width is 97.5 % of this sum at the median, 101.2 % at the
//     worst), and the title fit keeps its own headroom (TITLE_FIT_HEADROOM)
//     for the rest.
//   * displayTextEm — a second face's name and type bars (aftermath, flip;
//     secondFaceLineSizes in lib/cards/render-tiers.ts) and a measured type
//     line (fitTypeLine). The advances rounded UP, plus every pair the
//     browser kerns APART (the face's kernWidening), so a measured line is
//     an upper bound for both renderers.
//
// Both read ONE advance table per face, in the font's own units.

import { BODY_FACE_METRICS, LINE_FACE_METRICS, type LineFaceId, type LineFaceMetrics } from "@/lib/cards/font-metrics";

export type { LineFaceId };

/** The face a line is measured in when the caller names none. */
const DEFAULT_FACE: LineFaceId = "display";

/** A face's own Latin-1 / Latin Extended-A advances (U+00A0–U+017F, per
 *  mille), where the generator has them: the body masters, whose accented
 *  letters are NOT their base letter's width (and which map some to an
 *  empty glyph — lib/cards/rules-metrics.ts). The display face has none and
 *  measures an accented letter as its base, as it always did. */
const LATIN_PER_MILLE: Partial<Record<LineFaceId, readonly number[]>> = {
  body: BODY_FACE_METRICS.regular.latinAdvancePerMille,
  bodyItalic: BODY_FACE_METRICS.italic.latinAdvancePerMille,
};
const LATIN_START = 0xa0;

/** A listed character's advance in font units; undefined for any other. */
function advanceUnits(ch: string, face: LineFaceMetrics, id: LineFaceId): number | undefined {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return face.asciiAdvanceUnits[code - 0x20];
  const extra = face.extraAdvanceUnits[ch];
  if (extra !== undefined) return extra;
  const latin = LATIN_PER_MILLE[id]?.[code - LATIN_START];
  return latin !== undefined && latin >= 0 ? (latin * face.unitsPerEm) / 1000 : undefined;
}

// ---------------------------------------------------------------------------
// displayTextWidthEm — the name before a detached cost.
// ---------------------------------------------------------------------------

/** A character the table does not know (another script, an emoji): counted
 *  at a full em, wider than any Latin capital here, so a name set in a
 *  fallback face shrinks early rather than ellipsizing. */
const UNKNOWN_ADVANCE_EM = 1;

/** A listed advance to the nearest thousandth of an em. */
function nearestEm(units: number, unitsPerEm: number): number {
  return Math.round((units * 1000) / unitsPerEm) / 1000;
}

/** One character's advance in em. Accented Latin letters measure as their
 *  base letter: Beleren draws them on the same advance (ñ = n, é = e) or a
 *  little narrower (ō by 0.034 em), so they are never under-counted. */
function advanceEm(ch: string, id: LineFaceId): number {
  if (/\p{M}/u.test(ch)) return 0; // a combining accent rides on its letter
  const face = LINE_FACE_METRICS[id];
  const units = advanceUnits(ch, face, id) ?? advanceUnits(ch.normalize("NFD").charAt(0), face, id);
  return units === undefined ? UNKNOWN_ADVANCE_EM : nearestEm(units, face.unitsPerEm);
}

/**
 * Width of one line of single-line text at a 1 em font size (multiply by the
 * font size for the drawn width): the sum of its advances plus the letter
 * spacing after every character, as both renderers set it — in `face`
 * (the display face when the caller names none).
 */
export function displayTextWidthEm(
  text: string,
  {
    letterSpacingEm = 0,
    uppercase = false,
    face = DEFAULT_FACE,
  }: { letterSpacingEm?: number; uppercase?: boolean; face?: LineFaceId } = {},
): number {
  const chars = Array.from(uppercase ? text.toUpperCase() : text);
  return chars.reduce((w, ch) => w + advanceEm(ch, face) + letterSpacingEm, 0);
}

// ---------------------------------------------------------------------------
// displayTextEm — aftermath's sideways bars.
// ---------------------------------------------------------------------------

// Anything else (after dropping accents: é → e): a little over a capital's
// average, so an unknown glyph shrinks a line early rather than late.
const FALLBACK_PER_MILLE = 700;

// A face's POSITIVE kerning pairs (ASCII), in thousandths of an em: left
// character → "<right><amount>" entries (the generated kernWidening). The
// browser applies them ("Ry" sets 0.31 em wider than its letters in
// Beleren, a run of W's 9%); the bake doesn't, and the negative pairs only
// tighten a line, so counting just these keeps a measured line an upper
// bound for both renderers. MPlantin kerns nothing.
const KERN_PAIRS = new Map<LineFaceId, Map<string, number>>();

function kernPairs(id: LineFaceId): Map<string, number> {
  let pairs = KERN_PAIRS.get(id);
  if (!pairs) {
    pairs = new Map();
    for (const [left, entries] of Object.entries(LINE_FACE_METRICS[id].kernWidening)) {
      for (const entry of entries.split(" ")) pairs.set(left + entry[0], Number(entry.slice(1)));
    }
    KERN_PAIRS.set(id, pairs);
  }
  return pairs;
}

/** The amount (thousandths of an em) the browser kerns `pair` apart in
 *  `face`; 0 for a pair it sets tighter or as is. */
export function kernWidening(pair: string, face: LineFaceId = DEFAULT_FACE): number {
  return kernPairs(face).get(pair) ?? 0;
}

/** One character's advance in thousandths of an em, rounded UP. */
function perMille(ch: string, id: LineFaceId): number {
  const face = LINE_FACE_METRICS[id];
  const units = advanceUnits(ch, face, id);
  if (units !== undefined) return Math.ceil((units * 1000) / face.unitsPerEm);
  const base = ch.normalize("NFD").replace(/\p{M}/gu, "");
  if (base.length === 1 && base !== ch) return perMille(base, id);
  return FALLBACK_PER_MILLE;
}

/** The width of `text` set in `face` (Beleren Bold when the caller names
 *  none), in ems: the letters' advances plus every pair the browser kerns
 *  apart (never the pairs it tightens), so a line measured with it fits in
 *  the preview and the bake alike. */
export function displayTextEm(text: string | null | undefined, face: LineFaceId = DEFAULT_FACE): number {
  const chars = [...(text ?? "")];
  let total = 0;
  for (let i = 0; i < chars.length; i += 1) {
    total += perMille(chars[i], face);
    if (i > 0) total += kernWidening(chars[i - 1] + chars[i], face);
  }
  return total / 1000;
}

// ---------------------------------------------------------------------------
// truncateDisplayLine — the one "…" cut for a line past its fit's floor.
// ---------------------------------------------------------------------------

const ELLIPSIS = "…";

/** A word cut by the "…" keeps at least this many characters; a shorter
 *  fragment ("Skeptic — K…") goes, back to the last whole word
 *  ("Skeptic…"). */
const MIN_CUT_FRAGMENT = 3;

/**
 * `text` cut to at most `maxEm` including its "…", measured with `measure`
 * (a line's width at 1 em — displayTextWidthEm for a name, the type line's
 * own upper bound for a type line), at a character boundary, with trailing
 * spaces and separators (, ; : and dashes) dropped before the "…"
 * ("Skeptic…", not "Skeptic,…"). A word cut to fewer than MIN_CUT_FRAGMENT
 * characters is dropped when a whole word comes before it. The whole text
 * when it fits.
 *
 * Both renderers draw the string this returns (lib/cards/title-band.ts
 * fitTitleBand, lib/cards/render-tiers.ts fitTypeLineBand and
 * secondFaceLineSizes), so a line too long even at its 5 pt floor is cut at
 * ONE place in the preview and the bake — never by each renderer's
 * text-overflow, which cut at different letters (the bake draws a whole
 * pixel's size, the preview a fraction).
 */
export function truncateDisplayLine(text: string, maxEm: number, measure: (s: string) => number): string {
  // (A line fitted exactly measures maxEm give or take rounding error.)
  if (measure(text) <= maxEm * (1 + 1e-9)) return text;
  const chars = Array.from(text);
  let kept = 0;
  while (kept < chars.length && measure(chars.slice(0, kept + 1).join("") + ELLIPSIS) <= maxEm) kept += 1;
  let head = chars.slice(0, kept).join("");
  if (kept < chars.length && !/\s/u.test(chars[kept])) {
    // Cut inside a word.
    const fragment = /\S*$/u.exec(head)?.[0] ?? "";
    if (Array.from(fragment).length < MIN_CUT_FRAGMENT && fragment.length < head.length) {
      head = head.slice(0, head.length - fragment.length);
    }
  }
  const cut = head.replace(/[\s,;:\-–—]+$/u, "");
  return (cut || chars[0]) + ELLIPSIS;
}
