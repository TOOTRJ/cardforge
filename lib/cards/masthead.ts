// ---------------------------------------------------------------------------
// A masthead that makes room for the cost row (the OTJ Breaking News
// showcase, template `breakingnews`; TODO 4.11 wave 2, owner decision on
// #624: FOLLOW PRINT). The newspaper's masthead — the icon box, "THE
// PROSPERITY POST" and the grey ">>" chevron — is painted in the master, and
// the cost row sits on its right end. Print moves the masthead out of a long
// cost's way (OTP #1–65 at 1500 × 2100, measured 2026-10-28):
//
//   ≤ 3 pips   the row ends on 1411, everything shows (#7: discs from 1185,
//              the chevron's tip on 1184);
//   4 pips     the chevron goes, nothing moves (#25, #51, #58: 1108–1411);
//   5 pips     the row slides right to the masthead's end and still clears
//              the wordmark (#22: discs 1080–1461, the Y's arm on 1062);
//   7 pips     the wordmark slides LEFT, cutting the icon box short (#40: the
//              P 427 → 271, the box's right border 382 → 233).
//
// ONE rule from the row's DRAWN width (manaCostWidthPct — the pips' own
// discs through pipScale, the gaps, a text token's letters: the answer the
// name's room reads, so a Phyrexian or a hybrid pip counts as wide as it is
// drawn), never a count of pips:
//
//   left0 = the row's left end where it sits today (costRect's right − width)
//   left0 ≥ chevronClearPx   → nothing changes (the master as it is);
//   else the chevron goes; if left0 < wordmarkClearPx the row slides right
//   just enough to clear the wordmark, at most to slideToPx; whatever it
//   still lacks the wordmark (with the box's right end) slides left, in
//   even px. Past anything printed the same rule holds — the cost is never
//   drawn over: a shift past maxShiftPx (the box would lose its colour tab)
//   drops the wordmark and keeps the whole box; a row that would reach the
//   box (left < boxClearPx) drops the box too.
//
// The pieces are cut from each published master (scripts/build-breaking-
// news-masthead.mjs, its numbers scripts/lib/breaking-news-masthead.mjs; a
// unit test holds the two files together): the WORDMARK strip and the PAPER
// strip (the masthead's paper and rules with no ink). Both renderers draw
// them right after the frame, before its overlays, at the boxes this module
// returns — the paper in a window (its image fixed, the window's left end
// moving), the wordmark at its shift — and translate the cost row by
// `costDxPx`. A card whose row fits draws no piece: its bake is unchanged.
//
// Pure: both renderers, the preload list (frameAssetPathsFor) and the tests
// read it.
// ---------------------------------------------------------------------------

import { symbolStyleOf } from "@/lib/cards/symbol-style";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";
import { manaCostWidthPct } from "@/lib/cards/title-band";

/** A masthead's numbers, in HD px of the 1500 × 2100 card. */
export type MastheadSpec = {
  /** The leftmost a row may start while the chevron shows (its tip on 1184;
   *  print's three pips start on 1185, the disc's round edge clear of it). */
  chevronClearPx: number;
  /** The leftmost a row may start while the wordmark stays: the Y's arm at
   *  the row's rows ends on 1062, and print sets the first disc 18 px on
   *  (16 by manaCostWidthPct, which runs ~2 px wide of the drawn row). */
  wordmarkClearPx: number;
  /** The furthest right a row slides to clear the wordmark (print's five
   *  pips end on 1461). */
  slideToPx: number;
  /** The largest shift that leaves the icon box its colour tab (the box's
   *  right border then on 132 px). */
  maxShiftPx: number;
  /** The leftmost a row may start while the whole icon box shows (its right
   *  border ends on 384, plus print's 18 px). */
  boxClearPx: number;
  /** The rows both pieces cover, [top, bottom). */
  rows: readonly [number, number];
  wordmark: {
    x0: number;
    x1: number;
    /** Where its right end starts to fade (on the chevron's rows, the
     *  earliest): the paper's window starts here, shifted with it. */
    fadeFromPx: number;
    /** `{key}` → the master key. */
    assetPathTemplate: string;
  };
  paper: {
    x0: number;
    x1: number;
    /** Where the paper starts when the wordmark is dropped: the box's right
     *  border's outer edge. */
    boxRightPx: number;
    assetPathTemplate: string;
  };
  /** The master keys the pieces are published for. */
  keys: readonly string[];
};

/** One piece: its image's box and the part of it drawn, both in card %. */
export type MastheadPiece = {
  piece: "paper" | "wordmark";
  path: string;
  /** The image's box (it is drawn at this size, never stretched). */
  rect: Rect;
  /** The visible part: the image clipped to it. Equal to `rect` but for
   *  the paper, whose left end follows the wordmark. */
  window: Rect;
};

export type MastheadDrawing = {
  /** How far right the cost row is translated, in HD px (even). */
  costDxPx: number;
  /** What happens to the masthead: the chevron goes (and the wordmark slides
   *  `shiftPx` left), the wordmark is dropped, or the box with it. */
  state: "chevron" | "wordmark" | "box";
  /** How far left the wordmark is drawn, in HD px (even; 0 while it stays). */
  shiftPx: number;
  /** In drawing order: the paper, then the wordmark (when drawn). */
  pieces: MastheadPiece[];
};

const CARD_W = 1500;
const CARD_H = 2100;

const ceilEven = (px: number) => Math.ceil(px / 2 - 1e-9) * 2 + 0; // never -0
const floorEven = (px: number) => Math.floor(px / 2 + 1e-9) * 2 + 0;

function pxRect(x0: number, x1: number, rows: readonly [number, number]): Rect {
  return {
    leftPct: (x0 / CARD_W) * 100,
    topPct: (rows[0] / CARD_H) * 100,
    widthPct: ((x1 - x0) / CARD_W) * 100,
    heightPct: ((rows[1] - rows[0]) / CARD_H) * 100,
  };
}

/** The cost row's drawn width in HD px on `layout` (manaCostWidthPct). */
export function costRowDrawnPx(layout: Pick<FrameProfile, "costSizePct" | "title" | "symbolStyle">, cost: string): number {
  const disc = layout.costSizePct ?? layout.title.sizePct;
  return manaCostWidthPct(cost, disc, symbolStyleOf(layout)) * CARD_W;
}

/**
 * What the masthead draws for a card face showing `cost` (null / blank: no
 * cost drawn) on master `masterKey`, or null — the master as it is: no
 * masthead on the frame, a row that clears the chevron, a key the pieces
 * are not published for.
 */
export function resolveMasthead(
  layout: Pick<FrameProfile, "masthead" | "costRect" | "costSizePct" | "title" | "symbolStyle">,
  cost: string | null | undefined,
  masterKey: string,
): MastheadDrawing | null {
  const spec = layout.masthead;
  const box = layout.costRect;
  if (!spec || !box || !cost?.trim() || !spec.keys.includes(masterKey)) return null;
  const width = costRowDrawnPx(layout, cost);
  const right0 = ((box.leftPct + box.widthPct) / 100) * CARD_W;
  const left0 = right0 - width;
  if (width <= 0 || left0 >= spec.chevronClearPx) return null;
  const slide = left0 < spec.wordmarkClearPx
    ? Math.min(floorEven(spec.slideToPx - right0), ceilEven(spec.wordmarkClearPx - left0))
    : 0;
  const left = left0 + slide;
  const shift = ceilEven(Math.max(0, spec.wordmarkClearPx - left));
  const wordmarkPath = spec.wordmark.assetPathTemplate.replace("{key}", masterKey);
  const paperPath = spec.paper.assetPathTemplate.replace("{key}", masterKey);
  const paperRect = pxRect(spec.paper.x0, spec.paper.x1, spec.rows);
  const paper = (from: number): MastheadPiece => ({
    piece: "paper",
    path: paperPath,
    rect: paperRect,
    window: pxRect(from, spec.paper.x1, spec.rows),
  });
  if (shift <= spec.maxShiftPx) {
    const x0 = spec.wordmark.x0 - shift;
    const x1 = spec.wordmark.x1 - shift;
    const wordmarkRect = pxRect(x0, x1, spec.rows);
    return {
      costDxPx: slide,
      state: "chevron",
      shiftPx: shift,
      pieces: [paper(spec.wordmark.fadeFromPx - shift), { piece: "wordmark", path: wordmarkPath, rect: wordmarkRect, window: wordmarkRect }],
    };
  }
  if (left >= spec.boxClearPx) {
    return { costDxPx: slide, state: "wordmark", shiftPx: 0, pieces: [paper(spec.paper.boxRightPx)] };
  }
  return { costDxPx: slide, state: "box", shiftPx: 0, pieces: [paper(spec.paper.x0)] };
}

/** Every asset a masthead may draw for `keys` (the anatomy tests). */
export function mastheadAssetPaths(spec: MastheadSpec): string[] {
  return spec.keys.flatMap((key) => [
    spec.paper.assetPathTemplate.replace("{key}", key),
    spec.wordmark.assetPathTemplate.replace("{key}", key),
  ]);
}
