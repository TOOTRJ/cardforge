// ---------------------------------------------------------------------------
// A name set in SYNTHESIZED small caps (TextSlot.smallCaps, TODO 4.53): the
// 2014–19 arch token prints its name in gold Beleren Small Caps (TDOM #3,
// TM19 #6, TBFZ #1 …). The repo has no small-caps file (4.8e, parked), so
// the name is set the way the collector line's artist is (4.9b,
// lib/cards/collector-layout.ts): every capital, digit and mark at the
// slot's size, every lower-case letter as its capital at `smallCaps` of it.
//
// ONE answer for the fit and both renderers: the runs a name is drawn in
// and the gaps between its words (smallCapsRuns), its width
// (smallCapsWidthEm, what fitTitleBand measures) and where each run sits
// (smallCapsRunBox). Both renderers set the runs as flex items of ONE row,
// aligned on the row's BOTTOM — never on a baseline: Satori sets inline
// spans of two sizes top-aligned, and a flex baseline is each engine's own
// guess for an item. Each run's line box is its face's own content box
// (line-height = ascent + descent, so the baseline is the ascent below its
// top in a browser and in Satori alike), and a small run stands on a bottom
// margin of the descent it lacks, so every baseline is the full-size line's.
// A word gap is the run's left margin (a space at a run's start is what
// Satori drops in a flex item).
//
// Tracking: `letterSpacingEm` is of the CAPITAL size on every run (each
// renderer sets it in px / cqw on every run, never an em that each run
// would resolve against its own size).
//
// Kerning (owner Round 65): each engine KERNS inside a run, so a run's box
// is its kerned width — every pair of the face, tightening ones included,
// and each glyph's real advance (lib/cards/small-caps-metrics.ts, generated
// from the face: the line tables count only the pairs a face kerns apart and
// guess 1 em for a character they don't list). Between two touching runs —
// a capital and the small letters after it, or back — no engine kerns (they
// are two boxes), so the pair is applied HERE, as the second run's left
// margin (`kernBeforeEm`, negative for W·A), at the small size: the pair's
// own units scaled by the smaller of the two letters. Both renderers set it
// with the word gap (gapBeforeEm + kernBeforeEm) and the fit counts it.
// ---------------------------------------------------------------------------

import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import type { LineFaceId } from "@/lib/cards/font-metrics";
import { SMALL_CAPS_ADVANCE_UNITS, SMALL_CAPS_KERNING, SMALL_CAPS_UNITS_PER_EM } from "@/lib/cards/small-caps-metrics";

/** One run of a small-caps line: its text as DRAWN (upper case, no spaces),
 *  whether it is set at the small size, the word gap before it, the kerning
 *  between it and the run it touches before it, and its own box's width
 *  (em of the capital size: the spaces' advances and tracking; the pair's
 *  kerning at the smaller size; the run's kerned advances at its size and
 *  the tracking after each character). */
export type SmallCapsRun = { text: string; small: boolean; gapBeforeEm: number; kernBeforeEm: number; widthEm: number };

let kerningTable: Map<string, Map<string, number>> | null = null;

/** The display face's kerning, em, between two drawn characters (0 for a
 *  pair it does not kern). Parsed once from the generated table. */
function kernEm(left: string, right: string): number {
  if (!kerningTable) {
    kerningTable = new Map();
    for (const [l, items] of Object.entries(SMALL_CAPS_KERNING)) {
      const row = new Map<string, number>();
      for (const item of items.split(" ")) {
        const [r] = Array.from(item);
        row.set(r, Number(item.slice(r.length)));
      }
      kerningTable.set(l, row);
    }
  }
  return (kerningTable.get(left)?.get(right) ?? 0) / SMALL_CAPS_UNITS_PER_EM;
}

const isMark = (ch: string) => /\p{M}/u.test(ch);

/** A drawn character's advance, em: the display face's own; a character it
 *  lacks (a fallback face draws it) as the line tables measure it. */
function advanceEm(ch: string, face: LineFaceId | undefined): number {
  if (isMark(ch)) return 0;
  const units = SMALL_CAPS_ADVANCE_UNITS[ch];
  return units === undefined ? displayTextWidthEm(ch, { face }) : units / SMALL_CAPS_UNITS_PER_EM;
}

/** A run's kerned advances at 1 em (marks ride on their letter). */
function runAdvanceEm(text: string, face: LineFaceId | undefined): number {
  const chars = Array.from(text);
  if (face && face !== "display") return displayTextWidthEm(text, { face });
  let em = 0;
  let prev: string | null = null;
  for (const ch of chars) {
    em += advanceEm(ch, face);
    if (isMark(ch)) continue;
    if (prev !== null) em += kernEm(prev, ch);
    prev = ch;
  }
  return em;
}

/** The last / first character of a run that kerns (not a mark). */
const lastLetter = (text: string) => Array.from(text).filter((ch) => !isMark(ch)).pop() ?? "";
const firstLetter = (text: string) => Array.from(text).find((ch) => !isMark(ch)) ?? "";

type Options = { smallCapEm: number; letterSpacingEm?: number; face?: LineFaceId };

/** A letter that has an upper-case form of its own is drawn as that form at
 *  the small size. Everything else — capitals, digits, punctuation, "…" — at
 *  the full size. */
function isSmall(ch: string): boolean {
  return ch !== ch.toUpperCase();
}

/** A space as displayLine leaves it (a no-break space) or as typed. */
function isSpace(ch: string): boolean {
  return ch === " " || ch === " ";
}

/** `line` as maximal runs of small and full-size characters, upper-cased,
 *  each word's first run carrying the gap of the spaces before it, each run
 *  its box's width. Both renderers give every run that EXPLICIT width (and
 *  its gap as its left margin), so each run starts at the same x in the
 *  browser and in Satori whatever either engine makes of a run's own box —
 *  Satori sized a small run narrower than it drew it, and the next run
 *  started under its last letter. Inside its box each engine draws the run
 *  kerned, as it draws any line. */
export function smallCapsRuns(line: string, { smallCapEm, letterSpacingEm = 0, face }: Options): SmallCapsRun[] {
  const spaceEm = displayTextWidthEm(" ", { face }) + letterSpacingEm;
  const runs: Omit<SmallCapsRun, "widthEm" | "kernBeforeEm">[] = [];
  let gap = 0;
  // Composed first (a pasted "e" + U+0301 is "é", one small letter), and a
  // combining mark left over rides in its letter's run: drawn in a run of
  // its own it floats over the next letter, at a place each engine picks.
  for (const ch of line.trim().normalize("NFC")) {
    if (isSpace(ch)) {
      gap += spaceEm;
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && gap === 0 && /\p{M}/u.test(ch)) {
      last.text += ch;
      continue;
    }
    const small = isSmall(ch);
    const text = ch.toUpperCase();
    if (last && last.small === small && gap === 0) last.text += text;
    else runs.push({ text, small, gapBeforeEm: gap });
    gap = 0;
  }
  const kerns = face === undefined || face === "display";
  return runs.map((run, i) => {
    const before = runs[i - 1];
    // Touching runs (no word gap) are a capital and small letters, or back:
    // their pair kerned at the small size.
    const kernBeforeEm =
      kerns && before && run.gapBeforeEm === 0 ? kernEm(lastLetter(before.text), firstLetter(run.text)) * smallCapEm : 0;
    return {
      ...run,
      kernBeforeEm,
      widthEm: runAdvanceEm(run.text, face) * (run.small ? smallCapEm : 1) + Array.from(run.text).filter((ch) => !isMark(ch)).length * letterSpacingEm,
    };
  });
}

/** The width of `text` in synthesized small caps, in em of the CAPITAL
 *  size: the runs' boxes (their kerned advances — a small run's at
 *  `smallCapEm` — and the tracking after every character, of the capital
 *  size on every run), the word gaps and the pairs kerned between touching
 *  runs: exactly the row both renderers lay out. */
export function smallCapsWidthEm(text: string, options: Options): number {
  return smallCapsRuns(text, options).reduce((em, run) => em + run.gapBeforeEm + run.kernBeforeEm + run.widthEm, 0);
}

/** Where a run sits, in em of the CAPITAL size: its font size, its line box
 *  (the face's content box at that size: ascent + descent) and the bottom
 *  margin that lifts a small run onto the full-size baseline (the descent it
 *  lacks). The row is the full-size line box tall. */
export function smallCapsRunBox(
  run: Pick<SmallCapsRun, "small">,
  smallCapEm: number,
  face: { ascentEm: number; descentEm: number },
): { sizeEm: number; lineHeightEm: number; liftEm: number } {
  const sizeEm = run.small ? smallCapEm : 1;
  return { sizeEm, lineHeightEm: (face.ascentEm + face.descentEm) * sizeEm, liftEm: face.descentEm * (1 - sizeEm) };
}

/** The row's height, em of the capital size: a full-size line box. */
export function smallCapsRowEm(face: { ascentEm: number; descentEm: number }): number {
  return face.ascentEm + face.descentEm;
}
