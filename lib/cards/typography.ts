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
//     frames); those slots are scan-measured per frame in template-layout.ts
//     and are NOT derived from this file.
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
export const CARD_WIDTH_IN = { portrait: 2.5, landscape: 3.5 } as const;

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
export const PLACEHOLDER_RULES_TEXT = "{T}: Add {G}.\nWhenever this creature attacks, draw a card.";
export const PLACEHOLDER_FLAVOR_TEXT = "Flavor text goes here.";
