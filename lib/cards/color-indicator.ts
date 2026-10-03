// ---------------------------------------------------------------------------
// The colour indicator (TODO 5.1a for the transform backs; design 2026-10-02
// D4, frames.md §3.3; TODO 4.6c reuses it as a per-card switch on ordinary
// cards): the dot before the type line that names the colour of a face with
// no mana cost — every coloured transform back prints one (INR #60 Insectile
// Aberration: the dot's outline at x 114–180 × y 1211–1267 on the 1500 × 2100
// card, a blue fill; MOM #43 Burnished Dunestomper, a green-white back: GREEN
// top-left, white bottom-right — the printed pair order {G}{W}, not WUBRG),
// an artifact or colourless back none.
//
// ONE module for both renderers and the type line's indent: the geometry
// (4.6c's measurement, held within the scans' blur — Ø 3.5 %W, centre 9.3 /
// 59.0 %, the type ink from 13.4 %W where the prints' starts at 200–204 px),
// the fills (the standard mana-symbol colours: INR #60's print reads
// 0 / 119 / 178 for blue), and the wedge geometry — one disc, two colours
// split on the diagonal (the first colour top-left, as MOM #43 prints), three
// or more in equal wedges from the top, clockwise. The colours run in the
// order a mana cost prints them (`canonicalColorSequence`: the guild pairs
// {G}{W} / {R}{W} / {G}{U}…, the shards and wedges), which is the order the
// printed dot splits in. The outline is a dark ring outside the fill, as
// printed.
//
// Pure and client-safe (its one import is the pure mana-order module): the
// client preview and the server bake share it.
// ---------------------------------------------------------------------------

import { canonicalColorSequence } from "@/lib/cards/mana-order";

/** The dot's geometry in card percent (W for the diameter and the x's, H
 *  for the y). */
export const COLOR_INDICATOR = Object.freeze({
  /** The fill's diameter, % of the card's WIDTH (52.5 px at HD). */
  diameterPct: 3.5,
  /** The centre, % of the card's width / height. */
  centre: Object.freeze({ xPct: 9.3, yPct: 59.0 }),
  /** The outline's width outside the fill, % of the card's width (4.5 px at
   *  HD: the prints' outline reads ≈ 60 px over a ≈ 52 px fill). */
  outlinePct: 0.3,
  /** Where the type line starts while the dot draws, % of the card's width
   *  (M15's band starts at 8.5). */
  typeLeftPct: 13.4,
  /** The outline's ink. */
  outlineHex: "#1d1812",
});

/** The fills, in printed order. */
export const COLOR_INDICATOR_FILLS: Readonly<Record<"white" | "blue" | "black" | "red" | "green", string>> = Object.freeze({
  white: "#f9faf4",
  blue: "#0e68ab",
  black: "#150b00",
  red: "#d3202a",
  green: "#00733e",
});

const LETTER_OF = { white: "W", blue: "U", black: "B", red: "R", green: "G" } as const;
const WORD_OF: Readonly<Record<string, keyof typeof COLOR_INDICATOR_FILLS>> = { W: "white", U: "blue", B: "black", R: "red", G: "green" };

/** The fills a colour identity prints, in the order its mana cost would
 *  print them ({G}{W}: green first) — empty for a colourless or word-less
 *  ("multicolor" alone) identity, which draws no dot. */
export function colorIndicatorFills(colors: readonly string[] | null | undefined): string[] {
  const letters = (colors ?? []).map((c) => LETTER_OF[c as keyof typeof LETTER_OF]).filter(Boolean);
  return [...canonicalColorSequence(letters)].map((l) => COLOR_INDICATOR_FILLS[WORD_OF[l]!]);
}

/** True when a body with `indicator: "coloured"` draws the dot for this
 *  identity. */
export function drawsColorIndicator(
  indicator: "coloured" | undefined,
  colors: readonly string[] | null | undefined,
): boolean {
  return indicator === "coloured" && colorIndicatorFills(colors).length > 0;
}

/** The box the dot's SVG is drawn in (outline included), card percent. */
export function colorIndicatorBox(): { topPct: number; leftPct: number; widthPct: number; heightPct: number } {
  // The box is square in card WIDTH units; its height in %H follows the
  // 5:7 card (× 5 / 7).
  const sidePct = COLOR_INDICATOR.diameterPct + COLOR_INDICATOR.outlinePct * 2;
  const heightPct = sidePct * (5 / 7);
  return {
    leftPct: COLOR_INDICATOR.centre.xPct - sidePct / 2,
    topPct: COLOR_INDICATOR.centre.yPct - heightPct / 2,
    widthPct: sidePct,
    heightPct,
  };
}

/** The SVG's unit viewBox: 0 0 VIEW VIEW, the outline's outer circle
 *  inscribed. */
export const COLOR_INDICATOR_VIEW = 200;

type Wedge = { d: string; fill: string };

/** The fill shapes as SVG path data in the COLOR_INDICATOR_VIEW box:
 *  one disc, two half-discs split on the top-right → bottom-left diagonal
 *  (the first colour top-left), else equal wedges from the top, clockwise.
 *  Each is a closed path a renderer fills; the outline is drawn under them
 *  as a full disc of the outline's ink (colorIndicatorOutlineRadius). */
export function colorIndicatorWedges(fills: readonly string[]): Wedge[] {
  const c = COLOR_INDICATOR_VIEW / 2;
  const r = colorIndicatorFillRadius();
  if (fills.length === 0) return [];
  if (fills.length === 1) {
    return [{ d: `M ${c - r} ${c} A ${r} ${r} 0 1 0 ${c + r} ${c} A ${r} ${r} 0 1 0 ${c - r} ${c} Z`, fill: fills[0]! }];
  }
  if (fills.length === 2) {
    // The diagonal from the top-right to the bottom-left of the disc: the
    // first colour's half above it (top-left), the second's below.
    const k = r * Math.SQRT1_2;
    const tr = `${c + k} ${c - k}`;
    const bl = `${c - k} ${c + k}`;
    return [
      { d: `M ${tr} A ${r} ${r} 0 0 0 ${bl} Z`, fill: fills[0]! },
      { d: `M ${bl} A ${r} ${r} 0 0 0 ${tr} Z`, fill: fills[1]! },
    ];
  }
  const n = fills.length;
  return fills.map((fill, i) => {
    const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const a1 = a0 + (2 * Math.PI) / n;
    const p = (a: number) => `${(c + r * Math.cos(a)).toFixed(3)} ${(c + r * Math.sin(a)).toFixed(3)}`;
    const large = 2 * Math.PI / n > Math.PI ? 1 : 0;
    return { d: `M ${c} ${c} L ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)} Z`, fill };
  });
}

/** The fill's radius in the view box. */
export function colorIndicatorFillRadius(): number {
  const side = COLOR_INDICATOR.diameterPct + COLOR_INDICATOR.outlinePct * 2;
  return (COLOR_INDICATOR.diameterPct / side) * (COLOR_INDICATOR_VIEW / 2);
}

/** The outline disc's radius in the view box (the box's inscribed circle). */
export function colorIndicatorOutlineRadius(): number {
  return COLOR_INDICATOR_VIEW / 2;
}

/** A type-line rect indented past the dot (the right edge kept). */
export function typeRectWithIndicator<R extends { leftPct: number; widthPct: number }>(rect: R): R {
  const right = rect.leftPct + rect.widthPct;
  return { ...rect, leftPct: COLOR_INDICATOR.typeLeftPct, widthPct: right - COLOR_INDICATOR.typeLeftPct };
}
