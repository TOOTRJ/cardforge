import { KEYRUNE_CODEPOINTS } from "@/lib/cards/keyrune-metrics";

// ---------------------------------------------------------------------------
// How big each set's symbol PRINTS on the M15-era frames (TODO 4.46, layout
// v36; owner round 8, 2026-09-28: "a per-set table of printed symbol
// heights"). Measured, not derived: Keyrune draws every set's glyph in a
// 1 em box, so a font fitted to CC's symbol box (v32's ink fit) drew compact
// glyphs near the print and wide ones at half of it — M20 41 px tall against
// the print's 86, NEO / DSK 47 against 73 — and some compact ones small too
// (FDN 78 against 89).
//
// Each entry is the symbol's KEYLINE-INCLUSIVE ink box on the prints, in HD
// px of a 1500 px wide card — [height, width] — the mean of a rare (or
// mythic) and an uncommon regular M15-frame print of the set (Scryfall PNGs
// at 745 px scaled × 1500/745; the silhouette's half-darkness edge from the
// bar to the keyline; a common's white keyline is not counted, so commons
// were only a cross-check). The planeswalker, saga and token prints set the
// symbol at the same size as the set's regular cards (7 walkers — BFZ #29,
// DOM #1, WAR #1, DMU #1, M19 #3, M20 #2, M21 #1 — 0.99–1.01 of the regular
// print's height; the DOM #18 / #21 and DMU #50 sagas 0.99–1.01; the TFDN #23
// Treasure ≈ 0.98), so one table serves every frame with the ink fit
// (lib/cards/set-symbol-size.ts) — the full-art basics excepted, whose
// glyph size 4.39 print-checked in their own pill ("ink-box").
//
// A glyph is drawn to fit INSIDE its set's printed box — font = min(height ÷
// its ink height, width ÷ its ink width) — so where Keyrune's proportions
// differ from the print's (EOE, OTJ, GRN, WOE, SNC 5–13 % wider in
// proportion; MID 11 % narrower) it never draws bigger than the print in
// either direction, and
// never wider than CC's 0.12 W symbol box (the three core-set pills, M19 /
// M20 / M21, print 187–189 px wide: they draw 180 × 75). The boxes are
// keyline-INCLUSIVE, so a bar that draws a keyline round the glyph (the
// borderless bars' white SET_SYMBOL_KEYLINE, 0.05 em out) fits the ink AND
// its ring to them (DMU 91 × 83, the core-set pills 85 × 180 with the ring);
// our M15 glyph has no keyline, so its flat ink fills the whole silhouette.
//
// Three measured sets are left out: v32's ink fit already draws them at the
// print's size, to the same whole px at both bakes — BFZ 86.0 × 65.0 (v32
// 86.1 × 59.5), WAR 86.0 × 74.5 (86.1 × 72.3), ZNR 85.5 × 77.0 (86.1 ×
// 76.7; #22 / #18, #12 / #4, #2 / #1) — so listing them would only move the
// type line's room by a fraction of a px. (On the planeswalker and saga bars
// they keep v32's 80 px box, where their prints set ~86.)
//
// A set not listed here keeps v32's ink fit. Adding a set (or re-measuring
// one) changes its cards' bakes: a layout bump whose scope lists the set.
// ---------------------------------------------------------------------------

/** Printed set-symbol boxes, keyline included: set code → [height, width] in
 *  HD px (a 1500 px wide card). The prints each row was measured on are in
 *  its comment (rare / mythic, uncommon). */
export const SET_SYMBOL_PRINTED_PX: Readonly<Record<string, readonly [height: number, width: number]>> = {
  afr: [89.5, 80.5], // AFR #8, #3
  blb: [93, 86.5], // BLB #9, #4
  dmu: [91.5, 83], // DMU #2, #12
  dom: [88.5, 70], // DOM #6, #8
  dsk: [73, 151.5], // DSK #13, #7
  eld: [83.5, 68.5], // ELD #1, #2
  eoe: [86.5, 110], // EOE #4, #3
  fdn: [88.5, 94], // FDN #11, #4
  fin: [89, 103.5], // FIN #20, #8
  grn: [83, 122], // GRN #2, #6
  iko: [86.5, 111.5], // IKO #11, #12
  khm: [90.5, 83.5], // KHM #9, #2
  ktk: [88, 76.5], // KTK #8, #1
  ltr: [88.5, 136], // LTR #2, #22
  m19: [85.5, 188], // M19 #4, #1
  m20: [86, 187.5], // M20 #8, #3
  m21: [85.5, 189], // M21 #6, #3
  mh3: [91.5, 143], // MH3 #26, #21
  mid: [87.5, 95.5], // MID #15, #6
  mkm: [90.5, 108.5], // MKM #3, #2
  neo: [73.5, 148], // NEO #7, #3
  one: [91, 91], // ONE #24, #1
  otj: [90.5, 151.5], // OTJ #1, #5
  snc: [81.5, 132.5], // SNC #10, #1
  spm: [87.5, 88.5], // SPM #32, #5
  stx: [91, 112], // STX #14, #10
  tdm: [88, 98], // TDM #5, #7
  thb: [83.5, 78.5], // THB #3, #2
  tla: [89.5, 78.5], // TLA #12, #15
  woe: [87.5, 149], // WOE #1, #9
};

/** The same boxes by the Keyrune glyph a set code draws (keyrune-metrics.ts):
 *  the printed size belongs to the symbol, so a code that shares a listed
 *  set's glyph shares its size. */
const PRINTED_BY_CODEPOINT: ReadonlyMap<number, readonly [number, number]> = new Map(
  Object.entries(SET_SYMBOL_PRINTED_PX).map(([code, box]) => [KEYRUNE_CODEPOINTS[code], box]),
);

/** A glyph's printed box ([height, width], HD px on a 1500 px card), or null
 *  when its set was not measured. */
export function printedSetSymbolPx(codepoint: number): readonly [number, number] | null {
  return PRINTED_BY_CODEPOINT.get(codepoint) ?? null;
}
