// The card name next to a DETACHED mana cost (FrameProfile.costRect — m15pw
// and modern). Both renderers draw those pips in their own right-aligned box,
// so the name's span used to run the whole title band and a long name slid
// under the pips ("Miner the Miner, Damned Delver"): its ellipsis never knew
// where the cost began. The width here ends the name one band gap before the
// cost's left edge, measured from the cost it actually draws, and both
// renderers cap the name with it so they ellipsize at the same point.

import { tokenize } from "@/components/cards/mana-cost-glyphs";
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
