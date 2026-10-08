// Display-line sizing shared by the live preview (card-preview.tsx, client)
// and the Satori bake (card-image.tsx, server-only): the title / type-line
// fits, the second faces' bars and the cost rows. Lives in a plain module so
// both sides import the SAME math.
//
// Rules text is NOT sized here since layout v33 (TODO 3.29): every rules
// consumer — the main box, the planeswalker rows, the saga rail, the
// adventure page and the second faces — draws the measured lines of
// lib/cards/rules-layout.ts, and the old average-width estimate is gone.

import { tokenSuffix, tokenize } from "@/components/cards/mana-cost-glyphs";
import { pipScale } from "@/lib/cards/mana-gem";
import { displayTextEm, truncateDisplayLine } from "@/lib/cards/display-metrics";
import { setSymbolBoxPct } from "@/lib/cards/set-symbol-size";
import { costPipGap, costPipGapPx, DEFAULT_COST_GAP_DISCS, symbolStyle, type SymbolStyle, type SymbolStyleSpec } from "@/lib/cards/symbol-style";
import type { FrameProfile, Rect, TextSlot } from "@/lib/cards/template-layout";
import { slotFace, type SlotFace } from "@/lib/cards/type-faces";
import { RULES_TEXT, ptToPct, type CardOrientation } from "@/lib/cards/typography";

// Display-font (CardDisplay) average advance width as a fraction of the font
// size. Caps ≈ 0.62em, lowercase ≈ 0.5em; 0.56 errs wide so a fitted line
// shrinks slightly early rather than ellipsizing.
const DISPLAY_CHAR_W = 0.56;

export type LineFitInput = {
  text: string | null | undefined;
  /** The slot rect (card-relative percents) from the frame profile. */
  rect: Rect;
  /** The profile's authentic base size (fraction of card width). */
  baseSizePct: number;
  /** Width reserved for trailing slot content (set symbol / cost pips), as a
   *  fraction of card width. */
  reservedPct?: number;
  /** The text's measured width at a 1 em font size, when the caller has one
   *  (lib/cards/display-metrics.ts) — it replaces the average-advance
   *  estimate. */
  textWidthEm?: number;
};

/**
 * Single-line fit for title/type bands: the profile's base size, shrunk only
 * as far as needed for the text to fit the slot on one line (real cards do
 * the same for long type lines). Deterministic and shared by preview + bake,
 * like the rules layout. Never below the hard floor (5 pt, the smallest
 * rules text a card prints); past it `overflow: hidden` + ellipsis are the
 * backstop.
 */
export function fitSingleLineSizePct({
  text,
  rect,
  baseSizePct,
  reservedPct = 0,
  textWidthEm,
}: LineFitInput): number {
  const chars = (text ?? "").trim().length;
  if (chars === 0) return baseSizePct;
  const availableW = Math.max(0.05, rect.widthPct / 100 - reservedPct);
  const fitted = availableW / (textWidthEm ?? chars * DISPLAY_CHAR_W);
  return Math.max(ptToPct(RULES_TEXT.hardFloorPt), Math.min(baseSizePct, fitted));
}

/**
 * One size for both halves of a split type line (TextSlot.split, TODO 3.24):
 * each half's single-line fit in its own box, and the smaller of the two, so
 * "Basic Snow Land" and "Forest" print at one size like the printed card.
 * Shared by preview + bake.
 */
export function fitSplitTypeSizePct({
  left,
  right,
  leftRect,
  rightRect,
  baseSizePct,
}: {
  left: string;
  right: string;
  leftRect: Rect;
  rightRect: Rect;
  baseSizePct: number;
}): number {
  return Math.min(
    fitSingleLineSizePct({ text: left, rect: leftRect, baseSizePct }),
    fitSingleLineSizePct({ text: right, rect: rightRect, baseSizePct }),
  );
}

// ---------------------------------------------------------------------------
// The measured fit (TextSlot.fit "measured", TODO 4.20, layout v32) — the
// M15-era family's names and type lines. A line prints at its slot's size
// unless its MEASURED width (Beleren's own advances, lib/cards/display-metrics)
// is more than the room its band really leaves it, and then shrinks only as
// far as that room needs, never below the 5 pt floor of the CARD's own
// orientation (the old fit floors a landscape card at the portrait 5 pt,
// ≈ 7 pt there). A slot without the flag keeps the old estimate, byte for
// byte: every frame outside lib/cards/m15-family.ts, the full-art basics,
// split and battle.
// ---------------------------------------------------------------------------

/** The gap both renderers draw between the two things sharing a band — a
 *  name and its cost, a type line and its set symbol (the preview's
 *  `gap: 2cqw`, the bake's `gap: fpx(0.02)`), as a fraction of card width.
 *  The bake's empty filler span after a start-aligned line with nothing
 *  beside it takes this gap too, so the line's room ends there as well. */
export const BAND_GAP_PCT = 0.02;

/** How close a measured type line's box may come to the set symbol's INK
 *  (fraction of card width): 20 px at HD, the gap the prints leave before
 *  the symbol on a type line they set at full size (ONE #196 "Legendary
 *  Creature — Phyrexian Angel", DSK #113; 4.20 print review). The line's
 *  kerned ink ends further left still (Beleren tightens a line ≈ 2.5 %). A
 *  start-aligned band's inline symbol is pulled left over the band gap by
 *  inlineSymbolPullPct, so both renderers give the line exactly this room. */
export const TYPE_SYMBOL_GAP_PCT = 0.013;

/** Headroom a measured front-face type line keeps over its measured width
 *  (slotLineEm — already an upper bound for both renderers: advances
 *  rounded up plus every pair the browser kerns apart): the bake's whole-px
 *  sizes and the browser's sub-pixel layout, ≈ the worst public line's
 *  +1.2 % (4.20 review). Second faces keep LINE_FIT_SAFETY. */
export const MEASURED_LINE_FIT_SAFETY = 1.015;

/** The smallest size a measured line shrinks to: the 5 pt hard floor on the
 *  card's own orientation. */
export function measuredLineFloorPct(orientation: CardOrientation = "portrait"): number {
  return ptToPct(RULES_TEXT.hardFloorPt, orientation);
}

/** A measured line's size: the slot's own, shrunk to `fittedPct` when that
 *  is smaller, but never below the floor — and never above the slot's size
 *  (a slot set below the floor keeps its own size; the old fit clamped it
 *  UP to the portrait floor). */
export function measuredLineSizePct(
  baseSizePct: number,
  fittedPct: number,
  orientation: CardOrientation = "portrait",
): number {
  return Math.min(baseSizePct, Math.max(measuredLineFloorPct(orientation), fittedPct));
}

/** A display slot's line width at a 1 em font size, as the browser sets it
 *  (an upper bound for both renderers — displayTextEm): its letters, every
 *  pair its face kerns apart, its case and its tracking — measured in the
 *  slot's own face (TextSlot.font, TODO 4.8.0). */
export function slotLineEm(
  text: string,
  slot: Pick<TextSlot, "uppercase" | "letterSpacingEm" | "font">,
): number {
  const line = slot.uppercase ? text.toUpperCase() : text;
  return displayTextEm(line, slotFace(slot).metricsId) + (slot.letterSpacingEm ?? 0) * Array.from(line).length;
}

type TypeLineLayout = Pick<FrameProfile, "type" | "symbolRect" | "symbolSizePct">;

/** A start-aligned band with the set symbol inline at its end (not a
 *  symbolRect, not a centred token band). */
function inlineAtEnd(layout: TypeLineLayout, symbolWidthPct: number | null): boolean {
  const { align } = layout.type;
  return !layout.symbolRect && symbolWidthPct !== null && align !== "center" && align !== "end";
}

/**
 * How far a measured type band's inline set symbol is pulled left over the
 * band gap (fraction of card width; both renderers' negative margin-left on
 * the symbol, which stays right-aligned where it was): the gap's excess over
 * TYPE_SYMBOL_GAP_PCT plus the glyph's side bearing, so the type line's flex
 * room ends TYPE_SYMBOL_GAP_PCT before the symbol's ink — the room
 * typeLineRoomPct fits it to. 0 for any other band (the old fit, a
 * symbolRect, a centred token band).
 */
export function inlineSymbolPullPct(
  layout: TypeLineLayout,
  symbol: { drawnWidthPct: number; inkLeftPct: number } | null,
): number {
  if (layout.type.fit !== "measured" || !inlineAtEnd(layout, symbol?.drawnWidthPct ?? null)) return 0;
  return BAND_GAP_PCT - TYPE_SYMBOL_GAP_PCT + (symbol?.inkLeftPct ?? 0);
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.leftPct < b.leftPct + b.widthPct &&
    b.leftPct < a.leftPct + a.widthPct &&
    a.topPct < b.topPct + b.heightPct &&
    b.topPct < a.topPct + a.heightPct
  );
}

/**
 * The width (fraction of card width) a measured type line may take in its
 * band: up to TYPE_SYMBOL_GAP_PCT before the set symbol's INK as it is DRAWN
 * — inline at the band's right end (inlineSymbolPullPct gives the line that
 * room in both renderers), or right-aligned in a `symbolRect` that overlaps
 * the band (the planeswalker's, devoid's; the old fit reserved nothing for
 * it, so a long line could run under the symbol) — or up to the bake's
 * filler span. A centred band (tokens) keeps the band gap to the symbol it
 * centres with. `symbolWidthPct` (the symbol's drawn width) is null when
 * none is drawn beside the line (the adventure panel); `symbolInkLeftPct` is
 * how far into that width its ink starts (setSymbolSize's inkLeftPct).
 */
export function typeLineRoomPct(
  layout: TypeLineLayout,
  symbolWidthPct: number | null,
  symbolInkLeftPct = 0,
): number {
  const { rect, align } = layout.type;
  const aligned = align === "center" || align === "end";
  const band = rect.widthPct / 100;
  const inkReserve = symbolWidthPct === null ? 0 : symbolWidthPct - symbolInkLeftPct;
  let room: number;
  if (inlineAtEnd(layout, symbolWidthPct)) room = band - TYPE_SYMBOL_GAP_PCT - inkReserve;
  else if (!layout.symbolRect && symbolWidthPct !== null) room = band - BAND_GAP_PCT - symbolWidthPct;
  else room = band - (aligned ? 0 : BAND_GAP_PCT);
  const box = layout.symbolRect;
  if (box && symbolWidthPct !== null && rectsOverlap(box, rect)) {
    const inkLeft = (box.leftPct + box.widthPct) / 100 - inkReserve;
    room = Math.min(room, inkLeft - TYPE_SYMBOL_GAP_PCT - rect.leftPct / 100);
  }
  return Math.max(0, room);
}

/** A measured band line as both renderers draw it. */
export type FittedLine = {
  /** The font size (fraction of card width). */
  sizePct: number;
  /** The line as drawn: whole, or — only past the 5 pt floor — cut with a
   *  "…" (truncateDisplayLine), the same in both renderers. */
  text: string;
  /** The span's max-width (fraction of card width): the room the fit
   *  measured against, so a line the estimate got wrong still ends there —
   *  before the set symbol — at the renderers' CSS ellipsis. null on the old
   *  path (no cap). */
  widthPct: number | null;
};

type TypeLineFitInput = {
  layout: TypeLineLayout;
  text: string | null | undefined;
  /** The set symbol's drawn width — setSymbolSize(layout, source)
   *  .drawnWidthPct (lib/cards/set-symbol-size.ts), the width both renderers
   *  draw it at; null when none is drawn beside the line. Read by the
   *  measured fit only. */
  symbolWidthPct: number | null;
  /** Where its ink starts in that width (setSymbolSize's inkLeftPct); 0 if
   *  unknown (an icon, the mark). Read by the measured fit only. */
  symbolInkLeftPct?: number;
  orientation?: CardOrientation;
};

/**
 * The type line's size, text and width, for both renderers. A slot with
 * `fit: "measured"` (the M15-era family) measures the line (slotLineEm ×
 * MEASURED_LINE_FIT_SAFETY) against the room its band leaves before the
 * drawn set symbol's ink (typeLineRoomPct), and shrinks only as far as that
 * needs, down to the 5 pt floor of the card's orientation; a line too long
 * even there is cut with a "…" here (truncateDisplayLine), measured at the
 * floor plus the half pixel the bake may round it up by (measuredLinePx), so
 * both renderers draw the same letters and it never runs under the symbol.
 * Any other slot keeps the old estimate exactly: fitSingleLineSizePct with
 * the symbol's box × 1.3 reserved, the whole line, no width cap.
 */
export function fitTypeLineBand({
  layout,
  text,
  symbolWidthPct,
  symbolInkLeftPct = 0,
  orientation = "portrait",
}: TypeLineFitInput): FittedLine {
  const slot = layout.type;
  if (slot.fit !== "measured") {
    const sizePct = fitSingleLineSizePct({
      text,
      rect: slot.rect,
      baseSizePct: slot.sizePct,
      reservedPct: layout.symbolRect ? 0 : setSymbolBoxPct(layout) * 1.3,
    });
    return { sizePct, text: text ?? "", widthPct: null };
  }
  const room = typeLineRoomPct(layout, symbolWidthPct, symbolInkLeftPct);
  const line = (text ?? "").trim();
  if (!line) return { sizePct: slot.sizePct, text: text ?? "", widthPct: room };
  const measure = (s: string) => slotLineEm(s, slot) * MEASURED_LINE_FIT_SAFETY;
  const sizePct = measuredLineSizePct(slot.sizePct, room / measure(line), orientation);
  return { sizePct, text: pastFloorText(line, room, sizePct, orientation, measure), widthPct: room };
}

/** The measured type line's size (fitTypeLineBand's). */
export function fitTypeLine(input: TypeLineFitInput): number {
  return fitTypeLineBand(input).sizePct;
}

/** A measured line at `sizePct` in `room` (both fractions of card width,
 *  `measure` its width at 1 em with its headroom): the whole line while it
 *  fits, otherwise — at the floor — cut with a "…" to fit at the floor plus
 *  the half pixel the bake may round it up by (measuredLinePx). */
export function pastFloorText(
  line: string,
  room: number,
  sizePct: number,
  orientation: CardOrientation,
  measure: (s: string) => number,
): string {
  if (measure(line) * sizePct <= room * (1 + 1e-9)) return line;
  const drawn = Math.max(sizePct, measuredLineFloorPct(orientation)) + HALF_PX_PCT;
  return truncateDisplayLine(line, room / drawn, measure);
}

/**
 * The whole-px font size the bake draws a measured line at (TextSlot.fit
 * "measured": a front name or type line, the adventure panel's, a `fitLines`
 * second face's): the slot's size rounded, as every slot, while the line
 * fits; a shrunk line at the whole pixel BELOW its fit (rounding up could
 * push it past its room) — but never below the 5 pt floor's own rounded
 * pixel (42 px at HD, 21 at 750), which the fit's "…" is measured with
 * (pastFloorText).
 */
export function measuredLinePx(
  fitPct: number,
  basePct: number,
  cardWidth: number,
  orientation: CardOrientation = "portrait",
): number {
  const base = Math.round(basePct * cardWidth);
  if (fitPct >= basePct) return base;
  const floorPx = Math.round(measuredLineFloorPct(orientation) * cardWidth);
  return Math.min(base, Math.max(Math.floor(fitPct * cardWidth), floorPx));
}

/** The stored bake's width (RENDER_PRESETS.hd, the HD PNG every display
 *  surface serves), per orientation. */
const STORED_BAKE_WIDTH: Readonly<Record<CardOrientation, number>> = { portrait: 1500, landscape: 2100 };

/**
 * A measured line's size as the PREVIEW draws it: when the fit shrank it,
 * the stored HD bake's own whole px (measuredLinePx at 1500 — 2100
 * landscape), so the editor shows exactly the size the stored PNG prints;
 * otherwise the slot's size. The 750 px bake floors the same fit to its own
 * whole px (≤ 1 px of 750 apart). Only for a line the bake sets with
 * measuredLinePx; the old path keeps its continuous size.
 */
export function measuredLinePreviewPct(
  fitPct: number,
  basePct: number,
  orientation: CardOrientation = "portrait",
): number {
  if (!(fitPct < basePct)) return fitPct;
  const width = STORED_BAKE_WIDTH[orientation];
  return measuredLinePx(fitPct, basePct, width, orientation) / width;
}

/** The gap between cost pips, as a fraction of the disc: the bake's
 *  CostGlyphs draws exactly this, and the preview draws the stored bake's
 *  (costRowHdPx). */
export const COST_PIP_GAP = DEFAULT_COST_GAP_DISCS;

/** A cost row's disc and the gap between its pips in the stored HD bake's
 *  whole px — what CostGlyphs draws at that width (the disc at fpx of its
 *  size, the gap at COST_PIP_GAP of that disc, at least 1 px). The preview
 *  draws these px in cqw, so its row is the stored PNG's at every size. */
export function costRowHdPx(
  discPct: number,
  orientation: CardOrientation = "portrait",
  /** The frame's symbol style (its pip gap); "modern" when omitted. */
  symbols: SymbolStyleSpec = symbolStyle(undefined),
): { discPx: number; gapPx: number; cardWidthPx: number } {
  const cardWidthPx = STORED_BAKE_WIDTH[orientation];
  const discPx = Math.round(discPct * cardWidthPx);
  return { discPx, gapPx: costPipGapPx(symbols, discPx), cardWidthPx };
}
/** The gap between a second face's name and its cost, as a fraction of the
 *  card's width (the preview's 2cqw; the bake draws it for `fitLines` faces
 *  that print a cost) — the band gap. */
export const NAME_COST_GAP_PCT = BAND_GAP_PCT;
/** Headroom on a measured line (displayTextEm already counts the kerning
 *  that widens it): the bake rounding a font size to whole pixels (+0.5 px
 *  of a 21 px 5 pt name at 750) and the browser's sub-pixel text layout. */
export const LINE_FIT_SAFETY = 1.05;
/** Half a pixel of the smaller bake (750 px wide), as a fraction of the
 *  card's width: the bake rounds each disc, gap and floor-size font to whole
 *  pixels. */
export const HALF_PX_PCT = 0.5 / 750;
// The discs' hard shadow reaches ≈ 0.07 disc past either end of the row:
// the symbol style's costRowShadowDiscs (0.1 on "modern" —
// lib/cards/symbol-style.ts, TODO 4.8.0).
/** Past the floor a long name ellipsizes, but the cost still leaves it at
 *  least this much of the bar (≈ 4 letters), or all of it if it is shorter. */
export const MIN_NAME_EM = 2;

/** A cost row's length as a line `perDisc × disc + fixedPct` (fractions of
 *  the card's width), as the bake draws it. */
function costRowTerms(
  cost: string | null | undefined,
  symbols: SymbolStyleSpec = symbolStyle(undefined),
): { perDisc: number; fixedPct: number } {
  const tokens = tokenize((cost ?? "").trim());
  if (tokens.length === 0) return { perDisc: 0, fixedPct: 0 };
  let perDisc = (tokens.length - 1) * costPipGap(symbols) + symbols.costRowShadowDiscs;
  let fixedPct = (2 * tokens.length - 1) * HALF_PX_PCT;
  for (const token of tokens) {
    if (token.kind === "text") {
      // A cost typed without braces ("2BB"): the bake's 0.6 × disc caps,
      // 1 px of tracking and half a pixel of font rounding per letter.
      perDisc += displayTextEm(token.value.toUpperCase()) * 0.6;
      fixedPct += token.value.length * 3 * HALF_PX_PCT;
    } else {
      // A pip's own disc: 1, or a Phyrexian symbol's larger one (v49).
      perDisc += pipScale(tokenSuffix(token) ?? "");
    }
  }
  return { perDisc, fixedPct };
}

/**
 * The length a cost takes on its bar at a given disc size (both fractions of
 * the card's width), as the bake draws it — one disc per pip, COST_PIP_GAP
 * between tokens, the hard shadow and pixel rounding included — so the room
 * it leaves is room the preview's narrower row leaves too. 0 when empty.
 * `symbols` is the frame's symbol style (its shadow's reach); "modern" when
 * the caller names none.
 */
export function costRowWidthPct(
  cost: string | null | undefined,
  discPct: number,
  symbols: SymbolStyleSpec = symbolStyle(undefined),
): number {
  const { perDisc, fixedPct } = costRowTerms(cost, symbols);
  return perDisc * discPct + fixedPct;
}

export type SecondFaceLineSizes = {
  titleSizePct: number;
  typeSizePct: number;
  /** The cost's disc diameter (fraction of card width). */
  costSizePct: number;
  /** The name and the type line as drawn: whole, or — a `fitLines` face's
   *  line too long even at the floor — cut with a "…" here (pastFloorText),
   *  so both renderers cut at the same letter. */
  titleText: string;
  typeText: string;
};

/**
 * A second face's name, type-line and cost sizes (flip / split / aftermath),
 * shared by SecondFacePanel (preview) and SecondFaceBake so both draw the same
 * bar. The profile's sizes as they are — unless the face opts in with
 * `fitLines` (aftermath: the top half's sizes on bars a third of the card
 * long). Then, measured in Beleren's own widths (displayTextEm):
 *
 * - the name bar — name, gap, cost — keeps the top half's sizes while it
 *   fits, and otherwise shrinks AS ONE, name and pips together, like a
 *   smaller copy of the top half's bar, only as far as the words need. Below
 *   the 5 pt floor the name stops shrinking and ellipsizes, and the pips are
 *   capped so they always stay on the bar with a few letters of name beside
 *   them (up to the 64-character cost cap);
 * - the type line shrinks alone to fit its bar, down to the same floor.
 *
 * The floor is 5 pt on the card's own orientation (TODO 4.20): a landscape
 * card's second face (split) floors where its front does, not at the
 * portrait 5 pt (≈ 7 pt there). Past it a `fitLines` face's name and type
 * line are cut with a "…" here (titleText / typeText), not by each
 * renderer's text-overflow; the bake draws a shrunk line at measuredLinePx.
 */
export function secondFaceLineSizes({
  slot,
  name,
  typeLine,
  cost,
  orientation = "portrait",
  symbols,
}: {
  slot: {
    title: { rect: Rect; sizePct: number; font?: SlotFace };
    type: { rect: Rect; sizePct: number; font?: SlotFace };
    costSizePct?: number;
    fitLines?: boolean;
  };
  name: string;
  typeLine: string;
  /** The face's cost (e.g. "{X}{B}{B}"); null/empty when it has none. */
  cost: string | null | undefined;
  /** The card's orientation (orientationFromAspect) — picks the floor. */
  orientation?: CardOrientation;
  /** The profile's symbol style (the cost row's shadow); "modern" unset. */
  symbols?: SymbolStyle;
}): SecondFaceLineSizes {
  const baseCost = slot.costSizePct ?? slot.title.sizePct;
  if (!slot.fitLines) {
    return {
      titleSizePct: slot.title.sizePct,
      typeSizePct: slot.type.sizePct,
      costSizePct: baseCost,
      titleText: name,
      typeText: typeLine,
    };
  }
  const floor = measuredLineFloorPct(orientation);
  // Each bar is measured in its own slot's face (TODO 4.8.0).
  const titleFace = slotFace(slot.title).metricsId;
  const typeFace = slotFace(slot.type).metricsId;
  const nameEm = displayTextEm(name, titleFace) * LINE_FIT_SAFETY;
  const row = slot.costSizePct ? costRowTerms(cost, symbolStyle(symbols)) : { perDisc: 0, fixedPct: 0 };
  // The bar's length left for the name and the discs' scalable part.
  const room = slot.title.rect.widthPct / 100 - (row.perDisc ? NAME_COST_GAP_PCT + row.fixedPct : 0);
  // Disc per unit of name size, as on the top half's bar.
  const ratio = baseCost / slot.title.sizePct;
  const scale = Math.min(slot.title.sizePct, room / (nameEm + row.perDisc * ratio));
  const titleSizePct = Math.max(floor, scale);
  const costSizePct = row.perDisc
    ? Math.min(
        ratio * titleSizePct,
        // At the floor, the name's few letters are kept at the floor's whole
        // px in the bake (the half pixel it may round up by, measuredLinePx).
        (room - Math.min(nameEm, MIN_NAME_EM) * (titleSizePct > floor ? titleSizePct : titleSizePct + HALF_PX_PCT)) /
          row.perDisc,
      )
    : baseCost;
  const typeEm = displayTextEm(typeLine, typeFace) * LINE_FIT_SAFETY;
  const typeRoom = slot.type.rect.widthPct / 100;
  const typeFit = typeEm > 0 ? typeRoom / typeEm : slot.type.sizePct;
  const typeSizePct = Math.max(floor, Math.min(slot.type.sizePct, typeFit));
  const measure = (s: string) => displayTextEm(s, titleFace) * LINE_FIT_SAFETY;
  const measureType = (s: string) => displayTextEm(s, typeFace) * LINE_FIT_SAFETY;
  // What the cost leaves the name on its bar, as drawn.
  const nameRoom = room - (row.perDisc ? row.perDisc * costSizePct : 0);
  return {
    titleSizePct,
    typeSizePct,
    costSizePct,
    titleText: pastFloorText(name, nameRoom, titleSizePct, orientation, measure),
    typeText: pastFloorText(typeLine, typeRoom, typeSizePct, orientation, measureType),
  };
}
