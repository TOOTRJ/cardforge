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
//     lib/cards/render-tiers.ts estimateRulesHeightW, capitals counted at
//     their own width) or one badge height, whichever is taller, plus its
//     padding;
//   * the text size is the largest step on the rules ladder at which all
//     rows together fit the box (the whole box still shrinks its text when
//     they don't);
//   * whatever height is left over is shared equally, so walkers whose
//     abilities are all the same length keep equal stripes.
//
// The starting-loyalty shield covers the box's bottom-right corner, and the
// last row always reaches the box's bottom. When the last ability's text,
// set at the row's full width, would reach the shield, its column stops
// short of it (lastRowInsetPct), the way a printed walker's last ability
// wraps before the loyalty box, and the row is sized for that narrower
// column (TODO 4.19; owner decision 2026-09-25). Otherwise the last row
// keeps the full width, so a text that never came near the shield wraps
// exactly as before instead of leaving a word on a line of its own (owner
// decision 2026-09-26). Before either, a long last ability could run on
// under the shield in both renderers.
//
// "Would reach" is decided from where the lines really break — MPlantin's
// own advances (lib/cards/rules-metrics.ts), wrapped the way each renderer
// wraps them — not from the rows' height estimate: that estimate averages
// the letters and over-counts lines on purpose, and puts every last row's
// text bottom below the shield's top (all 84 walkers measured in round 5),
// so it can't tell a last line that stops short of the shield from one that
// runs under it.
//
// Each badge stays vertically centred on its own row (both renderers use
// `align-items: center`).

import type { LoyaltyAbility } from "@/lib/cards/card-display";
import {
  RULES_FIT_SAFETY,
  estimateRulesHeightW,
  rulesSizeLadder,
} from "@/lib/cards/render-tiers";
import {
  BAKE_WRAP,
  BAKE_WRAP_WIDE,
  PREVIEW_WRAP,
  type RulesWrapRule,
  wrapRulesText,
} from "@/lib/cards/rules-metrics";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";
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
  /** How much narrower the LAST row's text column is (fraction of card
   *  width, off its right side) so its lines wrap before the loyalty shield.
   *  0 when the last row keeps the full width: no shield in the box, or a
   *  text that stays clear of it at the full width. */
  lastRowInsetPct: number;
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
  /** The starting-loyalty shield's box (loyaltyShieldRect) — the last row's
   *  text wraps before it. */
  shield?: Rect | null;
};

/** The box the frame's starting-loyalty shield is drawn in: its plate's
 *  (plateRect), else the value's own rect. null for a frame without one. */
export function loyaltyShieldRect(layout: Pick<FrameProfile, "loyalty">): Rect | null {
  return layout.loyalty ? (layout.loyalty.plateRect ?? layout.loyalty.rect) : null;
}

/** How far a shield reaches into the rules box from its right edge, as a
 *  fraction of card width. The last row's text column ends there, less the
 *  row's own right padding, so the text keeps the same room from the shield
 *  as from the stripe's edge. 0 when the shield misses the box; never more
 *  than half the box. */
function shieldInsetPct(rect: Rect, shield: Rect | null | undefined): number {
  if (!shield) return 0;
  const overlapsBox =
    shield.topPct < rect.topPct + rect.heightPct && shield.topPct + shield.heightPct > rect.topPct;
  const inset = (rect.leftPct + rect.widthPct - shield.leftPct) / 100;
  return overlapsBox && inset > 0 ? Math.min(inset, rect.widthPct / 200) : 0;
}

/** Width of a row's text column at `sizePct`, in card-width units. */
function textColumnW(boxWidthW: number, sizePct: number): number {
  const r = LOYALTY_ROW;
  return boxWidthW - sizePct * (2 * r.padXEm + r.badgeWidthEm + r.badgeGapEm);
}

/** Each row's minimum height at `sizePct`, in card-width units — the last
 *  row's text in its column less `lastInsetW`. */
function naturalRowHeights(
  abilities: readonly LoyaltyAbility[],
  sizePct: number,
  lineHeight: number,
  boxWidthW: number,
  lastInsetW: number,
): number[] {
  const r = LOYALTY_ROW;
  const columnW = textColumnW(boxWidthW, sizePct);
  const last = abilities.length - 1;
  return abilities.map(
    (ab, i) =>
      Math.max(
        estimateRulesHeightW(ab.text, sizePct, lineHeight, i === last ? columnW - lastInsetW : columnW),
        r.badgeHeightEm * sizePct,
      ) +
      2 * r.padYEm * sizePct,
  );
}

// The wraps a last ability is checked in: the preview's, and the bake's at
// the advances and a hair wider (lib/cards/rules-metrics.ts). Its text
// reaches the shield if it does in ANY of them, so neither renderer draws a
// word under the shield on a row that kept the full width.
const SHIELD_CHECK_WRAPS: readonly RulesWrapRule[] = [PREVIEW_WRAP, BAKE_WRAP, BAKE_WRAP_WIDE];
// A line whose box ends this close above the shield's top (em) still counts
// as beside it: descenders reach ≈0.07 em below the line box, and the bake
// puts the box on whole pixels.
const BESIDE_SHIELD_EM = 0.15;

/**
 * Whether the last ability's text, set at the row's FULL width and centred in
 * its row (both renderers use `align-items: center`), would reach the
 * shield: a line of it sits beside the shield — its box comes down to the
 * shield box's top — and runs past the edge the narrower column would end at
 * (the shield's box less the row's padding). Lengths are in card-width
 * units; `rowTop` and `shieldTop` are measured from the rules box's top.
 */
function lastTextReachesShield({
  text,
  sizePct,
  lineHeight,
  columnW,
  insetW,
  rowTop,
  rowHeight,
  shieldTop,
}: {
  text: string;
  sizePct: number;
  lineHeight: number;
  columnW: number;
  insetW: number;
  rowTop: number;
  rowHeight: number;
  shieldTop: number;
}): boolean {
  const columnEm = columnW / sizePct;
  const narrowEm = (columnW - insetW) / sizePct;
  // The shield's top, from the row's top, in em of the ability text.
  const shieldTopEm = (shieldTop - rowTop) / sizePct;
  const pitch = lineHeight + RULES_TEXT.wrapGapEm;
  return SHIELD_CHECK_WRAPS.some((rule) => {
    const paragraphs = wrapRulesText(text, columnEm, rule);
    // The block's height as RulesBody / RulesBodyBake stack it: each line a
    // line box plus the wrap gap (the bake's run margin, under every line;
    // the preview's row gap, between lines), blank lines, paragraph gaps.
    const blockEm = paragraphs.reduce(
      (h, lines, i) =>
        h +
        (i > 0 ? RULES_TEXT.paragraphGapEm : 0) +
        (lines.length === 0
          ? RULES_TEXT.blankLineEm
          : lines.length * pitch - (rule.gapAfterEveryRun ? 0 : RULES_TEXT.wrapGapEm)),
      0,
    );
    let y = (rowHeight / sizePct - blockEm) / 2;
    for (const [i, lines] of paragraphs.entries()) {
      if (i > 0) y += RULES_TEXT.paragraphGapEm;
      if (lines.length === 0) y += RULES_TEXT.blankLineEm;
      for (const widthEm of lines) {
        if (y + lineHeight + BESIDE_SHIELD_EM > shieldTopEm && widthEm > narrowEm) return true;
        y += pitch;
      }
    }
    return false;
  });
}

/**
 * Text size + row heights for a planeswalker's ability rows. Deterministic,
 * so the preview and the bake draw the same row boxes by construction.
 *
 * Down the size ladder, the first step whose rows fit: at the full width
 * while the last ability's text stays clear of the shield there, else with
 * the last row's column short of the shield (lastRowInsetPct) and that row
 * sized for it.
 */
export function layoutLoyaltyRows({
  abilities,
  rect,
  baseSizePct,
  lineHeight = RULES_TEXT.lineHeight,
  aspect,
  shield = null,
}: LoyaltyRowsInput): LoyaltyRowsLayout {
  const count = abilities.length;
  if (count === 0) return { sizePct: baseSizePct, rowFractions: [], lastRowInsetPct: 0 };
  const insetPct = shieldInsetPct(rect, shield);
  const boxWidthW = rect.widthPct / 100;
  const boxHeightW = (rect.heightPct / 100) * aspect;
  const total = (heights: number[]) => heights.reduce((a, b) => a + b, 0);

  // Share the slack equally; past the hard floor (nothing fits) scale every
  // row down alike instead of letting the last ones fall out of the box.
  const rowsFor = (heights: number[]) => {
    const sum = total(heights);
    return sum <= boxHeightW
      ? heights.map((h) => h + (boxHeightW - sum) / count)
      : heights.map((h) => (h * boxHeightW) / sum);
  };
  const result = (sizePct: number, heights: number[], lastRowInsetPct: number): LoyaltyRowsLayout => ({
    sizePct,
    rowFractions: rowsFor(heights).map((h) => h / boxHeightW),
    lastRowInsetPct,
  });
  // Full-width rows keep the whole width unless the last ability's text
  // would reach the shield in them.
  const clearOfShield = (sizePct: number, heights: number[]) => {
    if (insetPct === 0 || !shield) return true;
    const rows = rowsFor(heights);
    return !lastTextReachesShield({
      text: abilities[count - 1].text,
      sizePct,
      lineHeight,
      columnW: textColumnW(boxWidthW, sizePct),
      insetW: insetPct,
      rowTop: total(rows.slice(0, -1)),
      rowHeight: rows[count - 1],
      shieldTop: ((shield.topPct - rect.topPct) / 100) * aspect,
    });
  };

  const ladder = rulesSizeLadder(baseSizePct, aspect);
  const fits = (heights: number[]) => total(heights) <= boxHeightW * RULES_FIT_SAFETY;
  for (const size of ladder) {
    const full = naturalRowHeights(abilities, size, lineHeight, boxWidthW, 0);
    if (fits(full) && clearOfShield(size, full)) return result(size, full, 0);
    if (insetPct > 0) {
      const narrow = naturalRowHeights(abilities, size, lineHeight, boxWidthW, insetPct);
      if (fits(narrow)) return result(size, narrow, insetPct);
    }
  }
  // Nothing fits even at the hard floor: the floor's rows, scaled into the box.
  const floor = ladder[ladder.length - 1];
  const full = naturalRowHeights(abilities, floor, lineHeight, boxWidthW, 0);
  if (clearOfShield(floor, full)) return result(floor, full, 0);
  return result(floor, naturalRowHeights(abilities, floor, lineHeight, boxWidthW, insetPct), insetPct);
}

/**
 * layoutLoyaltyRows for a frame profile: its rules box, base size, leading
 * and loyalty shield. The one call both renderers make (and the tests that
 * check what they draw).
 */
export function layoutProfileLoyaltyRows(
  layout: Pick<FrameProfile, "rules" | "loyalty">,
  abilities: readonly LoyaltyAbility[],
  aspect: number,
): LoyaltyRowsLayout {
  return layoutLoyaltyRows({
    abilities,
    rect: layout.rules.rect,
    baseSizePct: layout.rules.sizePct,
    lineHeight: layout.rules.lineHeight ?? RULES_TEXT.lineHeight,
    aspect,
    shield: loyaltyShieldRect(layout),
  });
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
