// The card name next to a DETACHED mana cost (FrameProfile.costRect — m15pw
// and modern). Both renderers draw those pips in their own right-aligned box,
// so the name's span used to run the whole title band and a long name slid
// under the pips ("Miner the Miner, Damned Delver"). The name now ends one
// band gap before the cost's left edge, measured from the cost it actually
// draws, and a name too long for that width shrinks to fit it, the way a
// printed name is set (owner decision 2026-09-25, TODO 3.10 for these
// frames). Only past the fit's 5 pt floor is it cut, with a "…". Both
// renderers take the name's text, width and size from fitDetachedCostTitle.

import { tokenize } from "@/components/cards/mana-cost-glyphs";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import { fitSingleLineSizePct } from "@/lib/cards/render-tiers";
import type { FrameProfile } from "@/lib/cards/template-layout";

/** The title band's name ↔ cost gap, as a fraction of card width (preview
 *  `gap: 2cqw`, bake `gap: fpx(0.02)`). */
export const TITLE_COST_GAP_PCT = 0.02;

/** Space between two cost pips as a fraction of the disc — the bake's
 *  CostGlyphs gap, the wider of the two renderers' (the preview's
 *  0.12 em is of the disc ÷ 1.3), so the estimate never runs short. */
const PIP_GAP_DISC = 0.12;
/** A text token in a cost ("or") draws at 0.6 × the disc in caps; ≈0.7 em
 *  per character errs wide. */
const TEXT_TOKEN_CHAR_DISC = 0.6 * 0.7;

/** Drawn width of a mana cost, as a fraction of card width, for pips
 *  `discPct` across (FrameProfile.costSizePct semantics). */
export function manaCostWidthPct(cost: string, discPct: number): number {
  const tokens = tokenize(cost.trim());
  if (tokens.length === 0) return 0;
  const glyphs = tokens.reduce(
    (w, t) => w + (t.kind === "text" ? t.value.length * TEXT_TOKEN_CHAR_DISC * discPct : discPct),
    0,
  );
  return glyphs + (tokens.length - 1) * PIP_GAP_DISC * discPct;
}

/**
 * The width (fraction of card width) the name may take when the frame draws
 * `cost` in a detached costRect: up to the pips' left edge less the band
 * gap, and never more than the band less that gap (all the bake's band ever
 * left it). null when the cost is inline in the band or there is none.
 */
export function detachedCostTitleWidthPct(
  layout: Pick<FrameProfile, "title" | "costRect" | "costSizePct">,
  cost: string | null | undefined,
): number | null {
  if (!layout.costRect || !cost?.trim()) return null;
  const disc = layout.costSizePct ?? layout.title.sizePct;
  const pipsLeft = (layout.costRect.leftPct + layout.costRect.widthPct) / 100 - manaCostWidthPct(cost, disc);
  const band = layout.title.rect;
  return Math.max(0, Math.min(band.widthPct / 100, pipsLeft - band.leftPct / 100) - TITLE_COST_GAP_PCT);
}

/** Headroom the fitted name keeps inside its width: Beleren's kerning can
 *  widen a name past its advance sum (by 1.2 % at the worst public title,
 *  "Belfry Spirit"), and the bake sets its type in whole pixels. */
export const TITLE_FIT_HEADROOM = 1.02;

const ELLIPSIS = "\u2026";

export type DetachedCostTitle = {
  /** The name as drawn: the whole name, or — only when it is too long even
   *  at the size floor — as much of it as fits, then "…". */
  text: string;
  /** The width the name may take (fraction of card width) — its span's
   *  max-width. */
  widthPct: number;
  /** The name's font size (fraction of card width): the title slot's own
   *  size, shrunk only as far as the name needs to fit `widthPct`, never
   *  below the single-line fit's 5 pt floor. */
  sizePct: number;
};

type Metrics = Parameters<typeof displayTextWidthEm>[1];

/** `name` cut to at most `maxEm` including its "…", at a character
 *  boundary, with trailing spaces and separators (, ; : and dashes) dropped
 *  before the "…" ("Skeptic…", not "Skeptic,…"). The whole name when it
 *  fits. */
function truncateToEm(name: string, maxEm: number, metrics: Metrics): string {
  // (A name fitted exactly measures maxEm give or take rounding error.)
  if (displayTextWidthEm(name, metrics) <= maxEm * (1 + 1e-9)) return name;
  const room = maxEm - displayTextWidthEm(ELLIPSIS, metrics);
  const chars = Array.from(name);
  let kept = 0;
  let width = 0;
  for (const ch of chars) {
    const w = displayTextWidthEm(ch, metrics);
    if (width + w > room) break;
    width += w;
    kept += 1;
  }
  const cut = chars.slice(0, kept).join("").replace(/[\s,;:\-\u2013\u2014]+$/u, "");
  return (cut || chars[0]) + ELLIPSIS;
}

/**
 * The name's text, width and size next to a detached cost, for both
 * renderers. null when the frame draws the cost inline in the band, or there
 * is none (the name keeps the slot's size and the band's width).
 *
 * Past the floor the "…" is placed HERE, from the same measurements, not
 * left to each renderer's text-overflow: when the cut fell in the word after
 * the last whole one, Satori set its ellipsis a word space too far right and
 * the span clipped it to two dots (the 2003 Modern frame). The CSS ellipsis
 * stays as a backstop.
 */
export function fitDetachedCostTitle(
  layout: Pick<FrameProfile, "title" | "costRect" | "costSizePct">,
  title: string,
  cost: string | null | undefined,
): DetachedCostTitle | null {
  const widthPct = detachedCostTitleWidthPct(layout, cost);
  if (widthPct === null) return null;
  const slot = layout.title;
  const name = title.trim();
  const metrics: Metrics = { letterSpacingEm: slot.letterSpacingEm, uppercase: slot.uppercase };
  const sizePct = fitSingleLineSizePct({
    text: name,
    rect: { ...slot.rect, widthPct: widthPct * 100 },
    baseSizePct: slot.sizePct,
    textWidthEm: displayTextWidthEm(name, metrics) * TITLE_FIT_HEADROOM,
  });
  const text = truncateToEm(name, widthPct / (sizePct * TITLE_FIT_HEADROOM), metrics);
  return { text, widthPct, sizePct };
}
