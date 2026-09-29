// Planeswalker ability rows — ONE layout for the live preview
// (components/cards/card-preview.tsx LoyaltyRows) and the Satori bake
// (lib/render/card-image.tsx LoyaltyRowsBake), plus the foil stripe sheens
// that follow the rows (lib/cards/foil-finish.tsx loyaltyStripeRects).
//
// Both renderers used to stack equal `flex: 1` rows. The browser grows a row
// whose text needs more than its share (flex items default to
// min-height: auto) and Yoga never does, so a walker with one long ability
// looked right in the editor while the stored PNG, gallery tile and OG image
// clipped that ability under its neighbours (TODO 3.13). The row heights are
// computed here and handed to both renderers as fractions of the rules box.
//
// Layout v33 (TODO 3.29): each ability's text is laid out by the ONE rules
// layout (lib/cards/rules-layout.ts) — its real lines, broken once and
// checked at BOTH bake targets (HD, and the 750 px bake), set at the rules
// standard's spacing — and both renderers DRAW those lines. So:
//
//   * a row's natural height is its text block as drawn (lines at
//     RULES_TEXT.lineHeight, the fixed paragraph gap between a static
//     ability's paragraphs, the ink headroom an accented capital needs) or
//     one badge, whichever is taller, plus the row's padding above and
//     below — in whole px at each target, no safety factor;
//   * the text size is the largest step of the even HD-px ladder (from the
//     walker's ceiling, rules-box.ts walkerSizePct — M15PW's 64 px — down to
//     the 42 px floor) at which every row holds its text AT BOTH TARGETS, in
//     the whole-px rows the bake draws (loyaltyRowEdgesPx) — never an
//     overlapping row;
//   * the row anatomy (badge, rail, padding) keeps ONE size whatever the
//     text's (LOYALTY_ROW_SIZE_PX): the text column starts where the
//     walker prints start theirs;
//   * whatever height is left over is shared equally, so walkers whose
//     abilities are all the same length keep equal stripes.
//
// The starting-loyalty shield covers the box's bottom-right corner, and the
// last row always reaches the box's bottom. When the last ability's text,
// set at the row's full width, would reach the shield — a line's ink comes
// within the row's padding of the shield's box, where its row really puts
// that line, at either target — its column stops short of the shield
// (lastRowInsetPct), the way a printed walker's last ability wraps before
// the loyalty box, and the row is sized for that narrower column (TODO 4.19;
// owner decision 2026-09-25). Otherwise the last row keeps the full width,
// so a text that never came near the shield wraps exactly as it would
// without one (owner decision 2026-09-26).
//
// Each badge stays vertically centred on its own row (both renderers use
// `align-items: center`), and so does each ability's text block.

import type { LoyaltyAbility } from "@/lib/cards/card-display";
import {
  RULES_TARGETS,
  RULES_TARGET_SCALE,
  blockHeightPx,
  layoutRulesAt,
  linePositions,
  rectPx,
  rulesLadderPx,
  type RulesLayout,
  type RulesLayoutInput,
  type RulesMetrics,
  type RulesPlacement,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import { walkerSizePct } from "@/lib/cards/rules-box";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH, RULES_TEXT, orientationFromAspect, rulesPxToPct } from "@/lib/cards/typography";

/** Row anatomy, in em of LOYALTY_ROW_SIZE_PX — the single copy both
 *  renderers draw from (the preview's badge was 1.6 em tall against the
 *  bake's 1.5, TODO 3.3). Its print re-source is TODO 4.19. */
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

/**
 * The size, HD px, LOYALTY_ROW's ems are drawn at — whatever size the
 * ability text fits at (layout v33 review). A printed walker's badges and
 * text margin don't grow with its text: at 46 px the rail (padding + badge
 * + gap) is 147 px, so the text starts at x 275 of an HD card, where the
 * walker prints set it (BFZ #29, DOM #1, AKH #97: 274–276). Scaled with the
 * v33 text sizes the rail grew to 167–185 px, moving the text 20–40 px
 * right of the prints and orphaning AKH #97's "creatures." on a line of
 * its own. TODO 4.19 re-sources the anatomy from the prints.
 */
export const LOYALTY_ROW_SIZE_PX = 46;

/** A row's anatomy in whole px: LOYALTY_ROW at one target. */
export type LoyaltyRowPx = {
  padY: number;
  padX: number;
  badgeWidth: number;
  badgeHeight: number;
  badgeGap: number;
  badgeText: number;
  badgeNudge: number;
  /** The rail before an ability's text: the padding, the badge box and its
   *  gap — where the text column starts. */
  rail: number;
};

/**
 * LOYALTY_ROW (at LOYALTY_ROW_SIZE_PX) in whole px of `target`: each em
 * value rounded to the HD px, and the 750 px bake's each the half of that,
 * rounded — the rail too (so the column the lines were broken for starts
 * where both bakes draw it: lib/cards/rules-layout.ts rounds a box's HD px
 * padding the same way).
 */
export function loyaltyRowPx(target: RulesTarget = "hd"): LoyaltyRowPx {
  const r = LOYALTY_ROW;
  const hd = (em: number) => Math.round(LOYALTY_ROW_SIZE_PX * em);
  const padX = hd(r.padXEm);
  const badgeWidth = hd(r.badgeWidthEm);
  const badgeGap = hd(r.badgeGapEm);
  const scale = RULES_TARGET_SCALE[target];
  const at = (px: number) => Math.round(px * scale);
  return {
    padY: at(hd(r.padYEm)),
    padX: at(padX),
    badgeWidth: at(badgeWidth),
    badgeHeight: at(hd(r.badgeHeightEm)),
    badgeGap: at(badgeGap),
    badgeText: at(hd(r.badgeTextEm)),
    badgeNudge: at(hd(r.badgeNudgeEm)),
    rail: at(padX + badgeWidth + badgeGap),
  };
}

export type LoyaltyRowsLayout = {
  /** Ability text size, HD px (an even step of the rules ladder). */
  sizePx: number;
  /** The same size as a fraction of card width. */
  sizePct: number;
  /** Each row's share of the rules box height, top to bottom; sums to 1. */
  rowFractions: number[];
  /** How much narrower the LAST row's text column is (fraction of card
   *  width, off its right side) so its lines wrap before the loyalty shield.
   *  0 when the last row keeps the full width: no shield in the box, or a
   *  text that stays clear of it at the full width. */
  lastRowInsetPct: number;
  /** Each ability's text, as the rules layout broke it into lines for its
   *  row's column (both targets' lines are these). */
  text: RulesLayout[];
  /** Nothing fits even at the floor: the floor's rows, scaled into the box
   *  alike (a row may clip its text). */
  clipped: boolean;
};

export type LoyaltyRowsInput = {
  abilities: readonly LoyaltyAbility[];
  /** The rules slot rect the rows fill (card-relative percents). */
  rect: Rect;
  /** The profile's rules size — the ladder's ceiling (snapped down to the
   *  even HD-px grid). */
  baseSizePct: number;
  /** The slot's line height (a profile override); RULES_TEXT's otherwise. */
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

/** One ladder step's rows: each ability's text and natural height at both
 *  targets, the rows' fractions, and whether every row holds its text. */
type RowsAt = {
  sizePx: number;
  insetHd: number;
  text: RulesLayout[];
  rowFractions: number[];
  fits: boolean;
};

/**
 * Text size + row heights for a planeswalker's ability rows. Deterministic,
 * so the preview and the bake draw the same row boxes and lines by
 * construction.
 *
 * Down the size ladder, the first step whose rows fit at both targets: at the
 * full width while the last ability's text stays clear of the shield there,
 * else with the last row's column short of the shield (lastRowInsetPct) and
 * that row sized for it.
 */
export function layoutLoyaltyRows({
  abilities,
  rect,
  baseSizePct,
  lineHeight = RULES_TEXT.lineHeight,
  aspect,
  shield = null,
}: LoyaltyRowsInput): LoyaltyRowsLayout {
  const orientation = orientationFromAspect(aspect);
  const ladder = rulesLadderPx(baseSizePct, orientation);
  const count = abilities.length;
  if (count === 0) {
    return { sizePx: ladder[0], sizePct: baseSizePct, rowFractions: [], lastRowInsetPct: 0, text: [], clipped: false };
  }
  const last = count - 1;
  const insetPct = shieldInsetPct(rect, shield);
  const insetHd = Math.round(insetPct * RULES_HD_WIDTH[orientation]);
  const box = { hd: rectPx(rect, orientation, aspect, "hd"), default: rectPx(rect, orientation, aspect, "default") };

  /** An ability's text in its row at `sizePx`: the box's width less the
   *  badge rail and the row's right padding (and the shield inset on the
   *  narrowed last row), centred between the row's vertical padding. */
  const rowInput = (text: string, sizePx: number, inset: number): RulesLayoutInput => {
    const a = loyaltyRowPx();
    return {
      rulesText: text,
      flavorText: null,
      rect,
      aspect,
      sizePct: baseSizePct,
      lineHeight,
      padPx: { left: a.rail, right: a.padX + inset, top: a.padY, bottom: a.padY },
      vAlign: "center",
    };
  };

  const rowsAt = (sizePx: number, lastInset: number, scaleIntoBox: boolean): RowsAt => {
    const text = abilities.map((ab, i) => layoutRulesAt(rowInput(ab.text, sizePx, i === last ? lastInset : 0), sizePx));
    // Each row's natural height, in whole px of each target.
    const needs = {} as Record<RulesTarget, number[]>;
    for (const t of RULES_TARGETS) {
      const a = loyaltyRowPx(t);
      needs[t] = text.map((l) => Math.max(blockHeightPx(l, t), a.badgeHeight) + 2 * a.padY);
    }
    // A row's share: the larger of its two targets' needs, then an equal
    // share of what is left. Past the floor, every row scales alike.
    const share = text.map((_, i) => Math.max(...RULES_TARGETS.map((t) => needs[t][i] / box[t].height)));
    const total = share.reduce((a, b) => a + b, 0);
    const rowFractions =
      total <= 1 ? share.map((s) => s + (1 - total) / count) : scaleIntoBox ? share.map((s) => s / total) : share;
    const overwide = text.some((l) => l.checks.hd.overwideRun || l.checks.default.overwideRun);
    // Every row holds its text in the whole-px rows the bake draws.
    const holds =
      total <= 1 &&
      RULES_TARGETS.every((t) => {
        const edges = loyaltyRowEdgesPx(rowFractions, box[t].height);
        return needs[t].every((need, i) => edges[i + 1] - edges[i] >= need);
      });
    return { sizePx, insetHd: lastInset, text, rowFractions, fits: holds && !overwide };
  };

  /** Whether any line of any row, where its row puts it at either target,
   *  has ink within the row's padding of the shield's box. */
  const reachesShield = (rows: RowsAt): boolean => {
    if (!shield || insetPct === 0) return false;
    return RULES_TARGETS.some((t) => {
      const s = rectPx(shield, orientation, aspect, t);
      const keepOutLeft = s.left - loyaltyRowPx(t).padX;
      return rows.text.some((_, i) =>
        loyaltyRowLines(rows, i, t).lines.some(
          (l) => l.left + l.width > keepOutLeft && l.left < s.right && l.inkBottom > s.top && l.inkTop < s.bottom,
        ),
      );
    });
  };

  const result = (rows: RowsAt, clipped: boolean): LoyaltyRowsLayout => ({
    sizePx: rows.sizePx,
    sizePct: rulesPxToPct(rows.sizePx, orientation),
    rowFractions: rows.rowFractions,
    lastRowInsetPct: rows.insetHd > 0 ? insetPct : 0,
    text: rows.text,
    clipped,
  });

  for (const sizePx of ladder) {
    const full = rowsAt(sizePx, 0, false);
    if (full.fits && !reachesShield(full)) return result(full, false);
    if (insetHd > 0) {
      const narrow = rowsAt(sizePx, insetHd, false);
      if (narrow.fits && !reachesShield(narrow)) return result(narrow, false);
    }
  }
  // Nothing fits even at the floor: the floor's rows, scaled into the box.
  const floor = ladder[ladder.length - 1];
  const full = rowsAt(floor, 0, true);
  if (insetHd === 0 || !reachesShield(full)) return result(full, true);
  return result(rowsAt(floor, insetHd, true), true);
}

/**
 * layoutLoyaltyRows for a frame profile: its rules box, the walker ceiling
 * (lib/cards/rules-box.ts walkerSizePct), its leading and loyalty shield.
 * The one call both renderers make (and the tests that check what they
 * draw).
 */
export function layoutProfileLoyaltyRows(
  layout: Pick<FrameProfile, "rules" | "loyalty" | "loyaltyRows">,
  abilities: readonly LoyaltyAbility[],
  aspect: number,
): LoyaltyRowsLayout {
  return layoutLoyaltyRows({
    abilities,
    rect: layout.rules.rect,
    baseSizePct: walkerSizePct(layout),
    lineHeight: layout.rules.lineHeight ?? RULES_TEXT.lineHeight,
    aspect,
    shield: loyaltyShieldRect(layout),
  });
}

/**
 * Where row `i`'s lines land at `target`, card-absolute target px (and their
 * ink): its text centred in its whole-px row box (the edges both renderers
 * draw), between the row's padding — what the shield check reads, and what
 * the renderers' flex rows put there.
 */
export function loyaltyRowLines(
  rows: Pick<LoyaltyRowsLayout, "text" | "rowFractions">,
  i: number,
  target: RulesTarget,
): RulesPlacement {
  const layout = rows.text[i];
  const { rect, aspect } = layout.input;
  const box = rectPx(rect, layout.orientation, aspect, target);
  const edges = loyaltyRowEdgesPx(rows.rowFractions, box.height);
  const cardHeight = Math.round(RULES_HD_WIDTH[layout.orientation] * RULES_TARGET_SCALE[target] * aspect);
  // The row's own box at this target, as a rect whose edges round to its
  // whole-px edges there.
  const rowRect: Rect = {
    ...rect,
    topPct: ((box.top + edges[i]) / cardHeight) * 100,
    heightPct: ((edges[i + 1] - edges[i]) / cardHeight) * 100,
  };
  return linePositions({ ...layout, input: { ...layout.input, rect: rowRect } }, target);
}

/** What a renderer draws for the rows at one target, in that target's whole
 *  px: the anatomy, the box height the rows' edges divide, and each row's
 *  text — its column's width, the ink headroom above and below its lines
 *  (drawn as padding on the column) and its metrics. */
export type LoyaltyRowsDrawing = {
  row: LoyaltyRowPx;
  boxHeight: number;
  edges: number[];
  text: { column: number; insetTop: number; insetBottom: number; metrics: RulesMetrics }[];
};

export function loyaltyRowsDrawing(rows: LoyaltyRowsLayout, target: RulesTarget): LoyaltyRowsDrawing {
  const first = rows.text[0];
  const box = first
    ? rectPx(first.input.rect, first.orientation, first.input.aspect, target)
    : { height: 0 };
  return {
    row: loyaltyRowPx(target),
    boxHeight: box.height,
    edges: loyaltyRowEdgesPx(rows.rowFractions, box.height),
    text: rows.text.map((layout) => {
      const placed = linePositions(layout, target);
      return {
        column: placed.interior.width,
        insetTop: placed.insetTop,
        insetBottom: placed.insetBottom,
        metrics: placed.metrics,
      };
    }),
  };
}
