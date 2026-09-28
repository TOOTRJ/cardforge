// ---------------------------------------------------------------------------
// Card typography standard — the printed-card numbers both renderers and every
// frame profile derive their rules-text sizing from. Kept in POINTS so the
// intent reads like a print spec; `ptToPct` converts to the fraction-of-card-
// width unit the profiles, the live preview (cqw) and the Satori bake (px)
// all share.
//
// Sources (2026-09 research pass):
//   • Rules text is MPlantin at 9 pt, shrinking as the text grows; WotC's
//     editing floor is about 7.5 pt ("Magic card text runs between 7.5 and 9
//     points"). Flavor text is the italic cut at the same size, reminder
//     text and ability words italic in-line.
//   • Titles / type line / P&T are the display face (Beleren on M15-era
//     frames). Their SLOTS (rects, alignment, ink) are scan-measured per
//     frame in template-layout.ts. Since layout v32 (TODO 4.20) the M15-era
//     family's display SIZES come from the named constants below — Card
//     Conjurer's, which match the prints (name 0.0381 H, type line
//     0.0324 H) — so every frame in lib/cards/m15-family.ts prints one name
//     size and one type size instead of per-frame literals. Frames outside
//     that family keep their own measured sizes.
//   • Inline mana symbols print a touch taller than the capitals of the line
//     they sit in and are centred on the x-height, with a hairline between
//     adjacent symbols ("{G}{G}") and none between a symbol and its
//     punctuation ("{T}:").
//   • Leading is tight (≈1.15 × size); abilities are separated by roughly
//     half a line; M15-family frames draw a hairline before flavor text,
//     pre-M15 frames leave a gap only.
//
// A physical card is 2.5 in wide (portrait) — 3.5 in when a landscape frame
// (Battle) is the reference box — so 9 pt = 9/72 in = 5 % of a portrait
// card's width.
// ---------------------------------------------------------------------------

/** Physical card width in inches for the two frame orientations. */
const CARD_WIDTH_IN = { portrait: 2.5, landscape: 3.5 } as const;

export type CardOrientation = keyof typeof CARD_WIDTH_IN;

/** A point size as a fraction of the card's width. */
export function ptToPct(pt: number, orientation: CardOrientation = "portrait"): number {
  return pt / 72 / CARD_WIDTH_IN[orientation];
}

/** Inverse of ptToPct — for labels and tests. */
export function pctToPt(pct: number, orientation: CardOrientation = "portrait"): number {
  return pct * 72 * CARD_WIDTH_IN[orientation];
}

/** Orientation from the card's height ÷ width ratio (7/5 portrait, 5/7 landscape). */
export function orientationFromAspect(aspect: number): CardOrientation {
  return aspect < 1 ? "landscape" : "portrait";
}

// ---------------------------------------------------------------------------
// M15-era display sizes (TODO 4.20, layout v32). Every value is a fraction of
// a PORTRAIT card's width — the profile unit — measured against Card
// Conjurer's M15 packs, which match the prints (name ink width 1.007 of the
// print's at 0.0533, n = 30; type line 0.995 at 0.0453). HD px = × 1500.
// A landscape slot takes displayPct(constant, "landscape"): the same
// absolute size on the physical card.
// ---------------------------------------------------------------------------

/** Card name (title) — CC 0.0381 H, 80 px at HD. */
export const TITLE_SIZE_PCT = 0.0533;

/** Type line — CC 0.0324 H, 68 px at HD. */
export const TYPE_SIZE_PCT = 0.0453;

/** Mana-cost pip DISC diameter (FrameProfile.costSizePct) — M15's measured
 *  disc (a DOM scan; CC mana 71/1638, prints ≈ 70 px), 72.75 px at HD.
 *  Planeswalker, saga and flip use it too (owner decision 2026-09-28). */
export const COST_DISC_PCT = 0.0485;

/** Set-symbol BOX height (FrameProfile.symbolSizePct on the family) — CC's
 *  symbol box, 0.041 H = 86 px at HD. An uploaded icon or the default mark
 *  is drawn contained in a square of this size; a Keyrune glyph's font size
 *  is derived from it (KEYRUNE_EM_PER_BOX). */
export const SET_SYMBOL_BOX_PCT = 0.0574;

/** Keyrune font size per unit of set-symbol box: box × this = 0.065 W on
 *  M15, the full-art basics' print-checked glyph size (4.39). A glyph whose
 *  ink is taller than the box at that size is fitted by its ink instead
 *  (font = min(box × KEYRUNE_EM_PER_BOX, box ÷ inkHeightEm)). */
export const KEYRUNE_EM_PER_BOX = 0.065 / SET_SYMBOL_BOX_PCT;

/** The planeswalker's and saga's set-symbol box — CC's 0.0381 H on their
 *  thinner type bars (packPlaneswalkerRegular / packSagaRegular), 80 px at
 *  HD. Every other M15-era pack (M15, tokens, flip, aftermath, adventure)
 *  uses SET_SYMBOL_BOX_PCT. */
export const SET_SYMBOL_BOX_PCT_THIN_BAR = 0.0533;

/** The widest a fitted Keyrune glyph's ink may draw — CC's symbol box
 *  width, 0.12 W. No keyrune 3.19 glyph comes near it (the widest ink is
 *  1.004 em, 98 px at 0.065 W); it guards a wider glyph a later keyrune
 *  might add. */
export const SET_SYMBOL_MAX_WIDTH_PCT = 0.12;

/** Adventure panel name and type line — CC name2 / type2, 0.0296 H = 62 px
 *  at HD. */
export const ADVENTURE_PANEL_PCT = 0.0414;

/** Adventure panel pip disc — CC mana2, 60 px at HD. */
export const ADVENTURE_PANEL_COST_PCT = 0.04;

/** A display size given as a fraction of a PORTRAIT card's width, as a
 *  fraction of the width of a card in `orientation`: the same absolute size
 *  on the physical card (× 5/7 on a landscape card, whose width is the
 *  portrait card's height). */
export function displayPct(pct: number, orientation: CardOrientation = "portrait"): number {
  return (pct * CARD_WIDTH_IN.portrait) / CARD_WIDTH_IN[orientation];
}

export const RULES_TEXT = {
  /** Default rules-text size on a full text box (creature, instant, …). */
  standardPt: 9,
  /** Half-box frames — split / flip / adventure halves, saga chapters,
   *  tokens, planeswalker ability rows print smaller from the start. */
  compactPt: 7.5,
  /** The editing floor real cards shrink to before the box is redesigned. */
  floorPt: 7.5,
  /** Last-resort floor so pathological text still fits instead of clipping. */
  hardFloorPt: 5,
  /** Shrink in half-point steps, like an editor would. */
  stepPt: 0.5,
  /** Line box height, as a multiple of the font size. */
  lineHeight: 1.06,
  /** Extra space between WRAPPED lines of one paragraph (em). Together with
   *  lineHeight this is the printed ≈1.15 em leading. */
  wrapGapEm: 0.09,
  /** Space between abilities / paragraphs (em) — about half a line. */
  paragraphGapEm: 0.45,
  /** Height a blank source line contributes (em). */
  blankLineEm: 0.6,
  /** Word gap (em) — MPlantin's space width. */
  wordGapEm: 0.26,
  /** Inline pip disc diameter as a fraction of the font size. */
  pipDiscEm: 0.86,
  /** Gap between two adjacent pips (em). */
  pipGapEm: 0.1,
  /** Flavor block: space above the hairline / gap, and below it (em). */
  flavorGapEm: 0.55,
} as const;

/** Effective leading (line pitch) of wrapped rules text, in em. */
export const RULES_LINE_PITCH_EM = RULES_TEXT.lineHeight + RULES_TEXT.wrapGapEm;

/** Editor-only sample shown in the live preview of a card with no rules text
 *  yet — real pips, a keyword line and a flavor line, so a fresh card reads
 *  like a card from the first second. Never baked or shown in the gallery. */
export const PLACEHOLDER_RULES_TEXT = "Add text and rules here.";
export const PLACEHOLDER_FLAVOR_TEXT = "Flavor text goes here.";
