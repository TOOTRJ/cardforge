// Rules-box font sizing, shared by the live preview (card-preview.tsx, client)
// and the Satori bake (card-image.tsx, server-only). Lives in a plain module so
// both sides import the SAME math — the editor preview and the exported PNG
// pick the same size for the same text by construction.
//
// Real cards (and the MSE styles these frames derive from) start the rules box
// at a fixed size — 14px on a 375px-wide card, i.e. 3.73% of card width — and
// shrink ONLY as far as needed for the text to fit the box (MSE: "scale down
// to: 6"). The old implementation here used four discrete tiers keyed on raw
// character count, which both undersized short text (max tier was 3.2%) and
// silently clipped long text (no relationship to the box at all).
//
// `fitRulesSizePct` estimates, per candidate size on a discrete ladder, how
// many wrapped lines the text needs and returns the largest size that fits the
// slot rect. The estimate is deliberately conservative (SAFETY) — the box keeps
// `overflow: hidden` as a backstop — and fully deterministic, so preview and
// bake always agree.

import type { Rect } from "@/lib/cards/template-layout";

// Average MPlantin advance width as a fraction of the font size. Measured
// loosely (lowercase latin ≈ 0.46em, capitals ≈ 0.62em); 0.5 errs wide so the
// estimate over-counts lines rather than under-counting them.
const CHAR_W = 0.5;
// An inline mana pip occupies ~0.92em disc + run gap ≈ 1.1em ≈ 2.2 CHAR_W.
const MANA_CHARS = 2.2;
// Headroom for estimate error: accept a size only if the estimated height
// stays under this fraction of the box.
const SAFETY = 0.96;
// The shrink ladder: each step is 8% smaller than the last. ~12 steps takes a
// 3.7% base down to the ~1.5% floor (MSE's "scale down to 6" ≈ 1.6%).
const LADDER_STEP = 0.92;
const MIN_SIZE_PCT = 0.015;

export type RulesFitInput = {
  rulesText: string | null | undefined;
  flavorText: string | null | undefined;
  /** The rules slot rect (card-relative percents) from the frame profile. */
  rect: Rect;
  /** The profile's authentic base size (fraction of card width). */
  baseSizePct: number;
  lineHeight: number;
  /** Card height ÷ card width — 7/5 portrait, 5/7 landscape. Converts the
   *  rect's height-percent into card-width units so all math shares a unit. */
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
  let lines = 0;
  let paragraphs = 0;
  for (const line of rulesLines) {
    const chars = lineCharCount(line);
    if (chars === 0) {
      lines += 0.7; // blank source line → paragraph spacer
      continue;
    }
    lines += Math.ceil(chars / lineCapacity);
    paragraphs += 1;
  }
  let height =
    lines * lineHeight * sizePct +
    Math.max(0, paragraphs - 1) * 0.5 * sizePct; // inter-paragraph row gap
  if (flavorLines.length > 0) {
    let flavorLineCount = 0;
    for (const line of flavorLines) {
      flavorLineCount += Math.max(1, Math.ceil(lineCharCount(line) / lineCapacity));
    }
    // divider margin + padding (≈0.024 card widths) + the italic lines
    height += 0.024 + flavorLineCount * lineHeight * sizePct;
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
  return Math.max(MIN_SIZE_PCT, Math.min(baseSizePct, fitted));
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

  let size = input.baseSizePct;
  while (size > MIN_SIZE_PCT) {
    const height = estimateHeight(
      rulesLines,
      flavorLines,
      size,
      input.lineHeight,
      boxWidthW,
    );
    if (height <= boxHeightW * SAFETY) return size;
    size *= LADDER_STEP;
  }
  return MIN_SIZE_PCT;
}
