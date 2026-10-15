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
// ---------------------------------------------------------------------------

import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import type { LineFaceId } from "@/lib/cards/font-metrics";

/** One run of a small-caps line: its text as DRAWN (upper case, no spaces),
 *  whether it is set at the small size, the word gap before it and its own
 *  box's width (em of the capital size: the spaces' advances and tracking;
 *  the run's advances at its size and the tracking after each character). */
export type SmallCapsRun = { text: string; small: boolean; gapBeforeEm: number; widthEm: number };

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
  const runs: Omit<SmallCapsRun, "widthEm">[] = [];
  let gap = 0;
  for (const ch of line.trim()) {
    if (isSpace(ch)) {
      gap += spaceEm;
      continue;
    }
    const small = isSmall(ch);
    const text = ch.toUpperCase();
    const last = runs[runs.length - 1];
    if (last && last.small === small && gap === 0) last.text += text;
    else runs.push({ text, small, gapBeforeEm: gap });
    gap = 0;
  }
  return runs.map((run) => ({
    ...run,
    widthEm: displayTextWidthEm(run.text, { face }) * (run.small ? smallCapEm : 1) + Array.from(run.text).length * letterSpacingEm,
  }));
}

/** The width of `text` in synthesized small caps, in em of the CAPITAL
 *  size: the runs' boxes (their advances — a small run's at `smallCapEm` —
 *  and the tracking after every character, of the capital size on every
 *  run) and the word gaps: exactly the row both renderers lay out. */
export function smallCapsWidthEm(text: string, options: Options): number {
  return smallCapsRuns(text, options).reduce((em, run) => em + run.gapBeforeEm + run.widthEm, 0);
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
