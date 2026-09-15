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

import type { Rect } from "@/lib/cards/template-layout";
import {
  RULES_LINE_PITCH_EM,
  RULES_TEXT,
  orientationFromAspect,
  ptToPct,
} from "@/lib/cards/typography";

// Average MPlantin advance width as a fraction of the font size. Measured
// loosely (lowercase latin ≈ 0.46em, capitals ≈ 0.62em); 0.5 errs wide so the
// estimate over-counts lines rather than under-counting them.
const CHAR_W = 0.5;
// An inline mana pip occupies the disc + its word gap ≈ 1.1em ≈ 2.2 CHAR_W.
const MANA_CHARS = (RULES_TEXT.pipDiscEm + RULES_TEXT.wordGapEm) / CHAR_W;
// Headroom for estimate error: accept a size only if the estimated height
// stays under this fraction of the box.
const SAFETY = 0.96;

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
 *  counts as a pip, words contribute their length plus a separating space. */
function lineCharCount(line: string): number {
  const manaTokens = line.match(/\{[^}]+\}/g)?.length ?? 0;
  const stripped = line.replace(/\{[^}]+\}/g, " ");
  const words = stripped.split(/\s+/).filter(Boolean);
  const wordChars = words.reduce((sum, w) => sum + w.length + 1, 0);
  return wordChars + manaTokens * MANA_CHARS;
}

function estimateHeight(
  rulesLines: string[],
  flavorLines: string[],
  sizePct: number,
  lineHeight: number,
  boxWidthW: number,
): number {
  // Characters that fit on one wrapped line at this size.
  const lineCapacity = Math.max(4, boxWidthW / (sizePct * CHAR_W));
  const pitch = lineHeight + RULES_TEXT.wrapGapEm;
  let lines = 0;
  let paragraphs = 0;
  let blanks = 0;
  for (const line of rulesLines) {
    const chars = lineCharCount(line);
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
};

/**
 * Single-line fit for title/type bands: the profile's base size, shrunk only
 * as far as needed for the text to fit the slot on one line (real cards do
 * the same for long type lines). Deterministic and shared by preview + bake,
 * mirroring fitRulesSizePct. `overflow: hidden` + ellipsis stay as backstop.
 */
export function fitSingleLineSizePct({
  text,
  rect,
  baseSizePct,
  reservedPct = 0,
}: LineFitInput): number {
  const chars = (text ?? "").trim().length;
  if (chars === 0) return baseSizePct;
  const availableW = Math.max(0.05, rect.widthPct / 100 - reservedPct);
  const fitted = availableW / (chars * DISPLAY_CHAR_W);
  return Math.max(ptToPct(RULES_TEXT.hardFloorPt), Math.min(baseSizePct, fitted));
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
