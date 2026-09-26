// Rules-box font sizing, shared by the live preview (card-preview.tsx, client)
// and the Satori bake (card-image.tsx, server-only). Lives in a plain module so
// both sides import the SAME math — the editor preview and the exported PNG
// pick the same size for the same text by construction.
//
// Real cards start the rules box at the printed standard — 9 pt MPlantin on a
// full text box (lib/cards/typography.ts) — and an editor shrinks it in
// half-point steps ONLY as far as needed for the text to fit, down to the
// 7.5 pt floor WotC works to; past that we keep stepping down to a hard floor
// rather than clip, since a custom card can carry far more text than a
// printed one.
//
// `fitRulesSizePct` estimates, per candidate size on that ladder, how many
// wrapped lines the text needs and returns the largest size that fits the
// slot rect. The estimate is deliberately conservative (SAFETY) — the box keeps
// `overflow: hidden` as a backstop — and fully deterministic, so preview and
// bake always agree.

import { tokenize } from "@/components/cards/mana-cost-glyphs";
import { displayTextEm } from "@/lib/cards/display-metrics";
import type { Rect } from "@/lib/cards/template-layout";
import {
  RULES_LINE_PITCH_EM,
  RULES_TEXT,
  orientationFromAspect,
  ptToPct,
} from "@/lib/cards/typography";

// Average MPlantin advance width as a fraction of the font size
// (public/fonts/mplantin.ttf: lowercase latin ≈ 0.49em, the space 0.28em,
// capitals ≈ 0.74em); 0.5 errs wide for mixed-case text so the estimate
// over-counts lines rather than under-counting them.
const CHAR_W = 0.5;
// A capital's advance, for the estimates that must not under-count ALL-CAPS
// text (estimateRulesHeightW): 0.5 per capital left an all-caps ability two
// lines short of what it drew.
const CAPS_CHAR_W = 0.74;
// An inline mana pip occupies the disc + its word gap ≈ 1.1em ≈ 2.2 CHAR_W.
const MANA_CHARS = (RULES_TEXT.pipDiscEm + RULES_TEXT.wordGapEm) / CHAR_W;
// Headroom for estimate error: accept a size only if the estimated height
// stays under this fraction of the box.
export const RULES_FIT_SAFETY = 0.96;
const SAFETY = RULES_FIT_SAFETY;

export type RulesFitInput = {
  rulesText: string | null | undefined;
  flavorText: string | null | undefined;
  /** The rules slot rect (card-relative percents) from the frame profile. */
  rect: Rect;
  /** The profile's base size (fraction of card width) — normally
   *  ptToPct(RULES_TEXT.standardPt) or the compact size. */
  baseSizePct: number;
  /** Line box height as a multiple of the size. Wrapped lines add the
   *  standard wrap gap on top (RULES_TEXT.wrapGapEm), like both renderers. */
  lineHeight?: number;
  /** Card height ÷ card width — 7/5 portrait, 5/7 landscape. Converts the
   *  rect's height-percent into card-width units so all math shares a unit,
   *  and picks the physical width the point ladder is measured against. */
  aspect: number;
};

/** Effective character count of one source line: each `{...}` mana token
 *  counts as a pip, words contribute their length plus a separating space.
 *  `wideCaps` counts every capital at its own (wider) advance. */
function lineCharCount(line: string, wideCaps = false): number {
  const manaTokens = line.match(/\{[^}]+\}/g)?.length ?? 0;
  const stripped = line.replace(/\{[^}]+\}/g, " ");
  const words = stripped.split(/\s+/).filter(Boolean);
  const wordChars = words.reduce((sum, w) => sum + w.length + 1, 0);
  const capsExtra = wideCaps
    ? (stripped.match(/\p{Lu}/gu)?.length ?? 0) * (CAPS_CHAR_W / CHAR_W - 1)
    : 0;
  return wordChars + capsExtra + manaTokens * MANA_CHARS;
}

function estimateHeight(
  rulesLines: string[],
  flavorLines: string[],
  sizePct: number,
  lineHeight: number,
  boxWidthW: number,
  wideCaps = false,
): number {
  // Characters that fit on one wrapped line at this size.
  const lineCapacity = Math.max(4, boxWidthW / (sizePct * CHAR_W));
  const pitch = lineHeight + RULES_TEXT.wrapGapEm;
  let lines = 0;
  let paragraphs = 0;
  let blanks = 0;
  for (const line of rulesLines) {
    const chars = lineCharCount(line, wideCaps);
    if (chars === 0) {
      blanks += 1; // blank source line → paragraph spacer
      continue;
    }
    lines += Math.ceil(chars / lineCapacity);
    paragraphs += 1;
  }
  let height =
    lines * pitch * sizePct +
    blanks * RULES_TEXT.blankLineEm * sizePct +
    Math.max(0, paragraphs + blanks - 1) * RULES_TEXT.paragraphGapEm * sizePct;
  if (flavorLines.length > 0) {
    let flavorLineCount = 0;
    for (const line of flavorLines) {
      flavorLineCount += Math.max(1, Math.ceil(lineCharCount(line) / lineCapacity));
    }
    // the gap/hairline above the flavor block + the italic lines
    height +=
      (rulesLines.length > 0 ? 2 * RULES_TEXT.flavorGapEm * sizePct : 0) +
      flavorLineCount * pitch * sizePct;
  }
  return height;
}

/**
 * Estimated height of one rules block (no flavor) at `sizePct` in a column
 * `boxWidthW` wide, in card-width units — the wrap model fitRulesSizePct
 * uses, for layouts that fit several blocks side by side in one box (the
 * planeswalker ability rows, lib/cards/loyalty-rows.ts). Empty text → 0.
 *
 * Capitals count at their own width here. Each block gets a box of exactly
 * its estimate plus a share of the slack, so an under-count spills into the
 * next block; fitRulesSizePct keeps the plain count (one box, one estimate —
 * changing it would move the fitted size of text that fits today on every
 * frame).
 */
export function estimateRulesHeightW(
  text: string,
  sizePct: number,
  lineHeight: number,
  boxWidthW: number,
): number {
  const rules = text.trim();
  if (!rules) return 0;
  return estimateHeight(rules.split(/\n/), [], sizePct, lineHeight, boxWidthW, true);
}

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
 * mirroring fitRulesSizePct. Never below the hard floor (5 pt, the smallest
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

/** The gap between cost pips, as a fraction of the disc: the bake's
 *  CostGlyphs draws exactly this; the preview's 0.12em of disc ÷ 1.3 is
 *  narrower, so a row measured with it fits both. */
export const COST_PIP_GAP = 0.12;
/** The gap between a second face's name and its cost, as a fraction of the
 *  card's width (the preview's 2cqw; the bake draws it for `fitLines` faces). */
export const NAME_COST_GAP_PCT = 0.02;
// Headroom on a measured line (displayTextEm already counts the kerning that
// widens it): the bake rounding a font size to whole pixels (+0.5 px of a
// 21 px 5 pt name at 750) and the browser's sub-pixel text layout.
const LINE_FIT_SAFETY = 1.05;
// Half a pixel of the smaller bake (750 px wide), as a fraction of the card's
// width: the bake rounds each disc and each gap to whole pixels.
const HALF_PX_PCT = 0.5 / 750;
// The discs' hard shadow reaches ≈ 0.07 disc past either end of the row.
const COST_SHADOW_DISCS = 0.1;
// Past the floor a long name ellipsizes, but the cost still leaves it at
// least this much of the bar (≈ 4 letters), or all of it if it is shorter.
const MIN_NAME_EM = 2;

/** A cost row's length as a line `perDisc × disc + fixedPct` (fractions of
 *  the card's width), as the bake draws it. */
function costRowTerms(cost: string | null | undefined): { perDisc: number; fixedPct: number } {
  const tokens = tokenize((cost ?? "").trim());
  if (tokens.length === 0) return { perDisc: 0, fixedPct: 0 };
  let perDisc = (tokens.length - 1) * COST_PIP_GAP + COST_SHADOW_DISCS;
  let fixedPct = (2 * tokens.length - 1) * HALF_PX_PCT;
  for (const token of tokens) {
    if (token.kind === "text") {
      // A cost typed without braces ("2BB"): the bake's 0.6 × disc caps,
      // 1 px of tracking and half a pixel of font rounding per letter.
      perDisc += displayTextEm(token.value.toUpperCase()) * 0.6;
      fixedPct += token.value.length * 3 * HALF_PX_PCT;
    } else {
      perDisc += 1;
    }
  }
  return { perDisc, fixedPct };
}

/**
 * The length a cost takes on its bar at a given disc size (both fractions of
 * the card's width), as the bake draws it — one disc per pip, COST_PIP_GAP
 * between tokens, the hard shadow and pixel rounding included — so the room
 * it leaves is room the preview's narrower row leaves too. 0 when empty.
 */
export function costRowWidthPct(cost: string | null | undefined, discPct: number): number {
  const { perDisc, fixedPct } = costRowTerms(cost);
  return perDisc * discPct + fixedPct;
}

export type SecondFaceLineSizes = {
  titleSizePct: number;
  typeSizePct: number;
  /** The cost's disc diameter (fraction of card width). */
  costSizePct: number;
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
 */
export function secondFaceLineSizes({
  slot,
  name,
  typeLine,
  cost,
}: {
  slot: {
    title: { rect: Rect; sizePct: number };
    type: { rect: Rect; sizePct: number };
    costSizePct?: number;
    fitLines?: boolean;
  };
  name: string;
  typeLine: string;
  /** The face's cost (e.g. "{X}{B}{B}"); null/empty when it has none. */
  cost: string | null | undefined;
}): SecondFaceLineSizes {
  const baseCost = slot.costSizePct ?? slot.title.sizePct;
  if (!slot.fitLines) {
    return { titleSizePct: slot.title.sizePct, typeSizePct: slot.type.sizePct, costSizePct: baseCost };
  }
  const floor = ptToPct(RULES_TEXT.hardFloorPt);
  const nameEm = displayTextEm(name) * LINE_FIT_SAFETY;
  const row = slot.costSizePct ? costRowTerms(cost) : { perDisc: 0, fixedPct: 0 };
  // The bar's length left for the name and the discs' scalable part.
  const room = slot.title.rect.widthPct / 100 - (row.perDisc ? NAME_COST_GAP_PCT + row.fixedPct : 0);
  // Disc per unit of name size, as on the top half's bar.
  const ratio = baseCost / slot.title.sizePct;
  const scale = Math.min(slot.title.sizePct, room / (nameEm + row.perDisc * ratio));
  const titleSizePct = Math.max(floor, scale);
  const costSizePct = row.perDisc
    ? Math.min(ratio * titleSizePct, (room - Math.min(nameEm, MIN_NAME_EM) * titleSizePct) / row.perDisc)
    : baseCost;
  const typeEm = displayTextEm(typeLine) * LINE_FIT_SAFETY;
  const typeFit = typeEm > 0 ? slot.type.rect.widthPct / 100 / typeEm : slot.type.sizePct;
  return {
    titleSizePct,
    typeSizePct: Math.max(floor, Math.min(slot.type.sizePct, typeFit)),
    costSizePct,
  };
}

/**
 * The shrink ladder for a base size: the base, then every half-point step
 * below it down to the hard floor — with the printed floor (7.5 pt) as a
 * plain step on the way, since a custom card may need to go further.
 */
export function rulesSizeLadder(baseSizePct: number, aspect: number): number[] {
  const orientation = orientationFromAspect(aspect);
  const step = ptToPct(RULES_TEXT.stepPt, orientation);
  const floor = ptToPct(RULES_TEXT.hardFloorPt, orientation);
  const ladder = [baseSizePct];
  let size = baseSizePct - step;
  while (size >= floor - 1e-9) {
    ladder.push(size);
    size -= step;
  }
  if (ladder[ladder.length - 1] > floor + 1e-9) ladder.push(floor);
  return ladder;
}

/** Largest ladder size (≤ baseSizePct) whose estimated height fits the slot. */
export function fitRulesSizePct(input: RulesFitInput): number {
  const rules = input.rulesText?.trim() ?? "";
  const flavor = input.flavorText?.trim() ?? "";
  if (!rules && !flavor) return input.baseSizePct;

  const rulesLines = rules ? rules.split(/\n/) : [];
  const flavorLines = flavor ? flavor.split(/\n/) : [];

  // Box interior in card-width units (padding mirrors both renderers' 1.2% /
  // 0.6% rules-box padding).
  const boxWidthW = input.rect.widthPct / 100 - 0.012;
  const boxHeightW = (input.rect.heightPct / 100) * input.aspect - 0.024;
  const lineHeight = input.lineHeight ?? RULES_TEXT.lineHeight;

  const ladder = rulesSizeLadder(input.baseSizePct, input.aspect);
  for (const size of ladder) {
    const height = estimateHeight(rulesLines, flavorLines, size, lineHeight, boxWidthW);
    if (height <= boxHeightW * SAFETY) return size;
  }
  return ladder[ladder.length - 1];
}

/** Re-exported so callers can size the whole line pitch without importing
 *  the typography module directly. */
export { RULES_LINE_PITCH_EM };
