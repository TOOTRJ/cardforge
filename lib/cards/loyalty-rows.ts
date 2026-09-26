// Planeswalker ability rows — ONE layout for the live preview
// (components/cards/card-preview.tsx LoyaltyRows) and the Satori bake
// (lib/render/card-image.tsx LoyaltyRowsBake), plus the foil stripe sheens
// that follow the rows (lib/cards/foil-finish.tsx loyaltyStripeRects).
//
// Both renderers used to stack equal `flex: 1` rows. The browser grows a row
// whose text needs more than its share (flex items default to
// min-height: auto) and Yoga never does, so a walker with one long ability
// looked right in the editor while the stored PNG, gallery tile and OG image
// clipped that ability under its neighbours (TODO 3.13; Chrollo's long
// static ability lost its first lines at the top of the box). Now the row
// heights are computed here from the text and handed to both renderers as
// fractions of the rules box:
//
//   * each row needs its estimated text height (the rules-fit wrap model,
//     lib/cards/render-tiers.ts) or one badge height, whichever is taller,
//     plus its padding;
//   * the text size is the largest step on the rules ladder at which all
//     rows together fit the box (the whole box still shrinks its text when
//     they don't);
//   * whatever height is left over is shared equally, so walkers whose
//     abilities are all the same length keep equal stripes.
//
// Each badge stays vertically centred on its own row (both renderers use
// `align-items: center`).

import type { LoyaltyAbility } from "@/lib/cards/card-display";
import {
  RULES_FIT_SAFETY,
  estimateRulesHeightW,
  rulesSizeLadder,
} from "@/lib/cards/render-tiers";
import type { Rect } from "@/lib/cards/template-layout";
import { RULES_TEXT } from "@/lib/cards/typography";

/** Row anatomy, in em of the ability text size — the single copy both
 *  renderers draw from (the preview's badge was 1.6 em tall against the
 *  bake's 1.5, TODO 3.3). */
export const LOYALTY_ROW = {
  /** The loyalty-cost badge box. Static abilities keep the (empty) box so
   *  every ability's text starts on the same margin. */
  badgeWidthEm: 2.3,
  badgeHeightEm: 1.5,
  /** Space between the badge box and the ability text. */
  badgeGapEm: 0.5,
  /** The badge numeral, and its optical nudge into the shield's flat part
   *  (down for a peaked "+", up for a pointed "−"). */
  badgeTextEm: 0.88,
  badgeNudgeEm: 0.18,
  /** Row padding: vertical, horizontal. */
  padYEm: 0.22,
  padXEm: 0.4,
} as const;

export type LoyaltyRowsLayout = {
  /** Ability text size, as a fraction of card width. */
  sizePct: number;
  /** Each row's share of the rules box height, top to bottom; sums to 1. */
  rowFractions: number[];
};

export type LoyaltyRowsInput = {
  abilities: readonly LoyaltyAbility[];
  /** The rules slot rect the rows fill (card-relative percents). */
  rect: Rect;
  /** The profile's base rules size — the ladder's first step. */
  baseSizePct: number;
  lineHeight?: number;
  /** Card height ÷ card width (7/5 portrait, 5/7 landscape). */
  aspect: number;
};

/** Width of a row's text column at `sizePct`, in card-width units. */
function textColumnW(boxWidthW: number, sizePct: number): number {
  const r = LOYALTY_ROW;
  return boxWidthW - sizePct * (2 * r.padXEm + r.badgeWidthEm + r.badgeGapEm);
}

/** Each row's minimum height at `sizePct`, in card-width units. */
function naturalRowHeights(
  abilities: readonly LoyaltyAbility[],
  sizePct: number,
  lineHeight: number,
  boxWidthW: number,
): number[] {
  const r = LOYALTY_ROW;
  const columnW = textColumnW(boxWidthW, sizePct);
  return abilities.map(
    (ab) =>
      Math.max(estimateRulesHeightW(ab.text, sizePct, lineHeight, columnW), r.badgeHeightEm * sizePct) +
      2 * r.padYEm * sizePct,
  );
}

/**
 * Text size + row heights for a planeswalker's ability rows. Deterministic,
 * so the preview and the bake draw the same row boxes by construction.
 */
export function layoutLoyaltyRows({
  abilities,
  rect,
  baseSizePct,
  lineHeight = RULES_TEXT.lineHeight,
  aspect,
}: LoyaltyRowsInput): LoyaltyRowsLayout {
  const count = abilities.length;
  if (count === 0) return { sizePct: baseSizePct, rowFractions: [] };
  const boxWidthW = rect.widthPct / 100;
  const boxHeightW = (rect.heightPct / 100) * aspect;

  const ladder = rulesSizeLadder(baseSizePct, aspect);
  let sizePct = ladder[ladder.length - 1];
  let heights = naturalRowHeights(abilities, sizePct, lineHeight, boxWidthW);
  for (const size of ladder) {
    const natural = naturalRowHeights(abilities, size, lineHeight, boxWidthW);
    if (natural.reduce((a, b) => a + b, 0) <= boxHeightW * RULES_FIT_SAFETY) {
      sizePct = size;
      heights = natural;
      break;
    }
  }

  const total = heights.reduce((a, b) => a + b, 0);
  // Share the slack equally; past the hard floor (nothing fits) scale every
  // row down alike instead of letting the last ones fall out of the box.
  const rows =
    total <= boxHeightW
      ? heights.map((h) => h + (boxHeightW - total) / count)
      : heights.map((h) => (h * boxHeightW) / total);
  return { sizePct, rowFractions: rows.map((h) => h / boxHeightW) };
}

/**
 * The rows' boundaries in whole pixels for a box `boxHeightPx` tall: row i
 * spans [edges[i], edges[i + 1]). Rounded from the cumulative fractions, so
 * the seams stay shared (no 1 px gap or overlap between stripes) and the
 * last edge is the box's own height.
 */
export function loyaltyRowEdgesPx(rowFractions: readonly number[], boxHeightPx: number): number[] {
  const edges = [0];
  let acc = 0;
  rowFractions.forEach((f, i) => {
    acc += f;
    edges.push(i === rowFractions.length - 1 ? Math.round(boxHeightPx) : Math.round(acc * boxHeightPx));
  });
  return edges;
}
