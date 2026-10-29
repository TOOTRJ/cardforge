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
//
// The same content-sized rows carry a saga's chapters (TODO 4.21c,
// lib/cards/saga-rail.ts): the row arithmetic is contentRowsAt below, fed a
// RowAnatomy — the walker's here (its badge rail, its padding, ONE badge as
// each row's minimum), the saga's there (the chapter text column, a row never
// shorter than its stack of chapter badges). The walker's numbers are what
// they were: tests/unit/cards/loyalty-rows-pinned.test.ts holds every row,
// fraction and line of a set of walkers to the layout v41 produced, and
// tests/unit/render/pw-rows-pinned-bake.test.tsx their bakes and foil stripes
// byte for byte.

import type { LoyaltyAbility } from "@/lib/cards/card-display";
import {
  RULES_TARGETS,
  RULES_TARGET_SCALE,
  blockHeightPx,
  layoutRulesAt,
  lineHitsKeepOut,
  linePositions,
  rectPx,
  rulesLadderPx,
  type RulesLayout,
  type RulesMetrics,
  type RulesPlacement,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import { walkerSizePct } from "@/lib/cards/rules-box";
import { statInkEm } from "@/lib/cards/stat-fit";
import type { SymbolStyle } from "@/lib/cards/symbol-style";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH, RULES_SIZE_PX, RULES_TEXT, orientationFromAspect, rulesPxToPct } from "@/lib/cards/typography";

/** Row anatomy, in em of LOYALTY_ROW_SIZE_PX — the single copy both
 *  renderers draw from (the preview's badge was 1.6 em tall against the
 *  bake's 1.5, TODO 3.3). Since layout v75 the badges themselves are drawn
 *  where the prints draw them (LOYALTY_BADGE_PRINT, outside the rows): these
 *  ems only set the RAIL — where an ability's text column starts (x 275 at
 *  HD, the prints'). */
export const LOYALTY_ROW = {
  /** The rail's badge share (the pre-v75 badge box's width). */
  badgeWidthEm: 2.3,
  /** …and the room after it. */
  badgeGapEm: 0.5,
  /** Row padding: vertical, horizontal. */
  padYEm: 0.22,
  padXEm: 0.4,
} as const;

/**
 * The loyalty-cost badges AS PRINTED (layout v75, TODO 4.19's badge rail;
 * owner 2026-10-28), card-absolute HD px. Measured on 13 printings, 1500 ×
 * 2100 (WAR #1 / #169, M21 #135 / #183 / #283 / #284, DMU #1, ONE #115, MOM
 * #6 / #134 / #320, BFZ #29, FDN #357 — bordered and borderless alike): the
 * badge's black FACE spans x 87–220 (median 89–218) on every card, so the
 * badge straddles the frame's edge LEFT of the text box — never inside the
 * rules box, where v33–v74 drew a 106 × 69 px badge at x 146–252. Its
 * height and its place on the row depend on its shape: the face's centre
 * sits `faceDyPx` from the row's centre (medians of the face's centre
 * against the colon's, which prints on the row's text: a "+" badge rides
 * 10 px high, its peak above; a "−" 6 px low, its point below). The numeral
 * — Beleren Bold, 44–45 px digits = 62 px type — is centred on the face, 1 px
 * above its middle; the print's long minus "−". The COLON prints after the
 * badge on every walker: two round dots, 8–10 px, centres 26.5 px apart at x
 * 250, on the row's centre. A STATIC ability has no badge and no colon, and
 * its text starts at x 207–209 (ONE #115, MOM #134, WAR #1), not at the
 * ability margin (Card Conjurer: the column 0.044 W further left).
 */
export const LOYALTY_BADGE_PRINT = {
  faceLeftPx: 89,
  faceWidthPx: 129,
  shapes: {
    up: { faceHeightPx: 77, faceDyPx: -10 },
    down: { faceHeightPx: 79, faceDyPx: 6 },
    zero: { faceHeightPx: 74, faceDyPx: 0 },
  },
  numeralPx: 62,
  numeralDyPx: -1,
  colon: { centreXPx: 250, dotPx: 10, halfGapPx: 13 },
  /** A static ability's rail: its text column starts 67 px left of an
   *  ability's (x 207.5 against 274.5 on the M15 walker's box). */
  staticRailPx: 80,
} as const;

/** The badge art (public/frames/m15pw/loyalty{up,down,naught}.png, the MSE
 *  masters, 265 × 210): each shape's black face and its silver rim's rows
 *  in the art's own px, measured on the files. The art is drawn so its face
 *  lands on the print's (x and y scaled apart — MSE's flat badge is 7 %
 *  flatter than print's). */
const LOYALTY_BADGE_ART = {
  width: 265,
  height: 210,
  shapes: {
    up: { face: { left: 40, top: 40, right: 224, bottom: 153 }, rimTop: 5, rimBottom: 164 },
    down: { face: { left: 41, top: 48, right: 225, bottom: 161 }, rimTop: 31, rimBottom: 189 },
    zero: { face: { left: 40, top: 50, right: 225, bottom: 149 }, rimTop: 33, rimBottom: 160 },
  },
} as const;

export type LoyaltyBadgeShape = keyof typeof LOYALTY_BADGE_PRINT.shapes;

/** The badge's shape for a cost: "+N" peaked, "−N" pointed, else flat. */
export function loyaltyBadgeShapeOf(cost: string): LoyaltyBadgeShape {
  if (cost.startsWith("+")) return "up";
  if (cost.startsWith("-") || cost.startsWith("−")) return "down";
  return "zero";
}

/** The badge's numeral as printed: a leading hyphen is the long minus. */
export function loyaltyBadgeLabel(cost: string): string {
  return cost.replace(/^-/, "−");
}

/** The room the numeral keeps on each side of the face, HD px: print's
 *  widest two-character costs ("−10", "+10") leave 9–12 px. */
const BADGE_NUMERAL_SIDE_PX = 8;

/**
 * The badge numeral's size, HD px: LOYALTY_BADGE_PRINT.numeralPx while its
 * ink — both renderers' reach, glyph by glyph (lib/cards/stat-fit.ts
 * statInkEm, the stat fit's measure) — keeps BADGE_NUMERAL_SIDE_PX inside
 * the face; a wider one (a three-digit cost, "+100": ~150 px at 62 px
 * against a 129 px face) steps down to the largest EVEN px that fits (whole
 * at 750), never below the rules ladder's floor (42 px). Every one- and two-digit
 * cost keeps 62 px.
 */
export function loyaltyBadgeNumeralPx(label: string): number {
  const base = LOYALTY_BADGE_PRINT.numeralPx;
  const ink = statInkEm(label);
  const reach = Math.max(ink.left, ink.right);
  const half = LOYALTY_BADGE_PRINT.faceWidthPx / 2 - BADGE_NUMERAL_SIDE_PX;
  if (reach <= 0 || base * reach <= half) return base;
  const fit = Math.floor(half / reach);
  return Math.max(RULES_SIZE_PX.floor, fit - (fit % 2));
}

/** Where a glyph's digits are centred in a line-height-1 box of Beleren
 *  Bold, in em from the box's top: the baseline at (1 − (ascent + descent))
 *  / 2 + ascent = 0.833 em (hhea 1917 / 552 of 2048), the digits 0–0.71 em
 *  above it. */
const BADGE_NUMERAL_CENTRE_EM = 0.478;

/** A shape's art box and rim relative to its row's centre, HD px (floats). */
function badgeArtHd(shape: LoyaltyBadgeShape) {
  const p = LOYALTY_BADGE_PRINT.shapes[shape];
  const art = LOYALTY_BADGE_ART.shapes[shape];
  const sx = LOYALTY_BADGE_PRINT.faceWidthPx / (art.face.right - art.face.left);
  const sy = p.faceHeightPx / (art.face.bottom - art.face.top);
  const faceTop = p.faceDyPx - p.faceHeightPx / 2;
  const top = faceTop - art.face.top * sy;
  return {
    left: LOYALTY_BADGE_PRINT.faceLeftPx - art.face.left * sx,
    width: LOYALTY_BADGE_ART.width * sx,
    top,
    height: LOYALTY_BADGE_ART.height * sy,
    rimTop: top + art.rimTop * sy,
    rimBottom: top + art.rimBottom * sy,
  };
}

/** The least height of a row with a badge, HD px: what it was before the
 *  badges grew to print's size (v33–v74: a 69 px badge and its padding,
 *  89 px), so no walker's text is set smaller for them. Like print's, a
 *  badge may ride over its row's edges (a "+" peak above its stripe); what
 *  it may never do is meet its neighbour — the layout steps its size down
 *  first (loyaltyBadgesMeet). A static ability's row has no such floor:
 *  its text and padding. */
export const LOYALTY_BADGE_ROW_MIN_HD = 89;

/** LOYALTY_BADGE_ROW_MIN_HD at a target: the old badge's 69 px and the
 *  row's padding, each rounded there as v33–v74 drew them. */
function badgeRowMinPx(target: RulesTarget): number {
  const k = RULES_TARGET_SCALE[target];
  const padY = Math.round(Math.round(LOYALTY_ROW_SIZE_PX * LOYALTY_ROW.padYEm) * k);
  return Math.round((LOYALTY_BADGE_ROW_MIN_HD - 2 * Math.round(LOYALTY_ROW_SIZE_PX * LOYALTY_ROW.padYEm)) * k) + 2 * padY;
}

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
  /** The rail before an ability's text: the padding, the badge's share and
   *  its gap — where the text column starts. */
  rail: number;
  /** …and before a STATIC ability's (LOYALTY_BADGE_PRINT.staticRailPx). */
  staticRail: number;
};

/** The rail's HD px: the padding, the badge's share and its gap. */
function railHd(): number {
  const hd = (em: number) => Math.round(LOYALTY_ROW_SIZE_PX * em);
  return hd(LOYALTY_ROW.padXEm) + hd(LOYALTY_ROW.badgeWidthEm) + hd(LOYALTY_ROW.badgeGapEm);
}

/** Row `index`'s rail, HD px: an ability's, or a static ability's. */
function rowRailHd(abilities: readonly LoyaltyAbility[] | undefined, index: number): number {
  return abilities && !abilities[index]?.cost ? LOYALTY_BADGE_PRINT.staticRailPx : railHd();
}

/**
 * LOYALTY_ROW (at LOYALTY_ROW_SIZE_PX) in whole px of `target`: each em
 * value rounded to the HD px, and the 750 px bake's each the half of that,
 * rounded — the rails too (so the column the lines were broken for starts
 * where both bakes draw it: lib/cards/rules-layout.ts rounds a box's HD px
 * padding the same way).
 */
export function loyaltyRowPx(target: RulesTarget = "hd"): LoyaltyRowPx {
  const r = LOYALTY_ROW;
  const hd = (em: number) => Math.round(LOYALTY_ROW_SIZE_PX * em);
  const scale = RULES_TARGET_SCALE[target];
  const at = (px: number) => Math.round(px * scale);
  return {
    padY: at(hd(r.padYEm)),
    padX: at(hd(r.padXEm)),
    rail: at(railHd()),
    staticRail: at(LOYALTY_BADGE_PRINT.staticRailPx),
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
  /** How far the LAST row's text is held up, HD px (even), so its lines keep
   *  out of the holofoil stamp's arch (the borderless walkers, TODO 4.9d):
   *  the row's bottom padding grows by it. Absent (0) on every card whose
   *  last ability already clears the arch, and on every frame without one. */
  lastRowLiftHd?: number;
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
  /** The holofoil stamp's arch while it is drawn
   *  (ResolvedHoloStamp.keepOutShape — the borderless walkers, TODO 4.9d):
   *  no line's ink may enter it. Absent / null: the rows are exactly as
   *  before. */
  stamp?: readonly Rect[] | null;
  /** The frame's symbol style (the inline pip's shadow); "modern" unset. */
  symbolStyle?: SymbolStyle;
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

/**
 * What a content-sized row is made of besides its text (TODO 4.21c): where
 * the text column sits in the row's box, and the least height the row's
 * badge — or stack of badges — needs.
 */
export type RowAnatomy = {
  /** The text column's padding inside the row's box, HD px
   *  (RulesLayoutInput.padPx): the rail before the text, the room after it,
   *  and the row's own padding above and below its text block. */
  padPx: { left: number; right: number; top: number; bottom: number };
  /** Row `index`'s rail, HD px, where it differs from `padPx.left` (a
   *  walker's static ability, layout v75); absent = `padPx.left` on every
   *  row. */
  leftPx?: (index: number) => number;
  /** Row `index`'s minimum height at `target`, whole px of that target: what
   *  its badge(s) take, with whatever room the row keeps round them. */
  minHeightPx: (index: number, target: RulesTarget) => number;
};

export type ContentRowsInput = {
  /** Each row's text, top to bottom. */
  texts: readonly string[];
  /** The box the rows fill (card-relative percents). */
  rect: Rect;
  /** The ladder's ceiling (fraction of card width) — recorded on each row's
   *  layout input; the size laid out is contentRowsAt's `sizePx`. */
  baseSizePct: number;
  lineHeight?: number;
  /** Card height ÷ card width. */
  aspect: number;
  anatomy: RowAnatomy;
  /** The frame's symbol style (the inline pip's shadow); "modern" unset. */
  symbolStyle?: SymbolStyle;
};

/** One ladder step's rows: each row's text and natural height at both
 *  targets, the rows' fractions, and whether every row holds its text. */
export type ContentRowsAt = {
  sizePx: number;
  /** The last row's extra right padding (a walker's shield inset), HD px. */
  insetHd: number;
  /** The last row's extra bottom padding (the stamp's arch), HD px. */
  liftHd: number;
  text: RulesLayout[];
  /** Each row's natural height at each target, whole px. */
  needs: Record<RulesTarget, number[]>;
  /** The rows' shares of the box: its natural height (the larger of its two
   *  targets') plus an equal share of what is left; past the box, the shares
   *  as they are (or scaled alike into it, `scaleIntoBox`). Sums to 1 when
   *  the rows fit. */
  rowFractions: number[];
  /** Every row holds its text and its minimum, in the whole-px rows both
   *  bakes draw, and no run is wider than its column. */
  fits: boolean;
};

/**
 * The rows of `input` at ONE size (HD px): each text laid out in its row's
 * column by the rules layout (layoutRulesAt — or `opts.text`, the same
 * layouts kept from an earlier call at this size and inset), its natural
 * height — the text block with the row's padding, or the row's minimum,
 * whichever is taller, in whole px at each target — and the box shared out:
 * natural heights first, the rest equally. The one row arithmetic the walker
 * rows (layoutLoyaltyRows) and the saga rail (lib/cards/saga-rail.ts) share.
 */
export function contentRowsAt(
  { texts, rect, baseSizePct, lineHeight = RULES_TEXT.lineHeight, aspect, anatomy, symbolStyle }: ContentRowsInput,
  sizePx: number,
  opts: { lastRowInsetHd?: number; lastRowLiftHd?: number; scaleIntoBox?: boolean; text?: readonly RulesLayout[] } = {},
): ContentRowsAt {
  const orientation = orientationFromAspect(aspect);
  const count = texts.length;
  const last = count - 1;
  const lastInset = opts.lastRowInsetHd ?? 0;
  const lastLift = opts.lastRowLiftHd ?? 0;
  const box = { hd: rectPx(rect, orientation, aspect, "hd"), default: rectPx(rect, orientation, aspect, "default") };
  const pad = anatomy.padPx;
  const text =
    opts.text?.slice() ??
    texts.map((rulesText, i) =>
      layoutRulesAt(
        {
          rulesText,
          flavorText: null,
          rect,
          aspect,
          sizePct: baseSizePct,
          lineHeight,
          padPx: {
            left: anatomy.leftPx?.(i) ?? pad.left,
            right: pad.right + (i === last ? lastInset : 0),
            top: pad.top,
            bottom: pad.bottom + (i === last ? lastLift : 0),
          },
          vAlign: "center",
          ...(symbolStyle ? { symbolStyle } : {}),
        },
        sizePx,
      ),
    );
  // Each row's natural height, in whole px of each target (the padding as
  // the rules layout rounds it there).
  const needs = {} as Record<RulesTarget, number[]>;
  for (const t of RULES_TARGETS) {
    const scale = RULES_TARGET_SCALE[t];
    const padV = Math.round(pad.top * scale) + Math.round(pad.bottom * scale);
    const liftV = Math.round(lastLift * scale);
    needs[t] = text.map((l, i) => Math.max(blockHeightPx(l, t) + padV + (i === last ? liftV : 0), anatomy.minHeightPx(i, t)));
  }
  // A row's share: the larger of its two targets' needs, then an equal
  // share of what is left. Past the floor, every row scales alike.
  const share = text.map((_, i) => Math.max(...RULES_TARGETS.map((t) => needs[t][i] / box[t].height)));
  const total = share.reduce((a, b) => a + b, 0);
  const rowFractions =
    total <= 1 ? share.map((s) => s + (1 - total) / count) : opts.scaleIntoBox ? share.map((s) => s / total) : share;
  const overwide = text.some((l) => l.checks.hd.overwideRun || l.checks.default.overwideRun);
  // Every row holds its text in the whole-px rows the bake draws.
  const holds =
    total <= 1 &&
    RULES_TARGETS.every((t) => {
      const edges = loyaltyRowEdgesPx(rowFractions, box[t].height);
      return needs[t].every((need, i) => edges[i + 1] - edges[i] >= need);
    });
  return { sizePx, insetHd: lastInset, liftHd: lastLift, text, needs, rowFractions, fits: holds && !overwide };
}

/** The walker rows' anatomy (LOYALTY_ROW at LOYALTY_ROW_SIZE_PX): the rail
 *  before the text (a static ability's shorter, layout v75), the row's
 *  padding, and — on a row with a badge — LOYALTY_BADGE_ROW_MIN_HD as its
 *  minimum. */
export function loyaltyRowAnatomy(abilities: readonly LoyaltyAbility[]): RowAnatomy {
  const a = loyaltyRowPx();
  return {
    padPx: { left: a.rail, right: a.padX, top: a.padY, bottom: a.padY },
    leftPx: (index) => rowRailHd(abilities, index),
    minHeightPx: (index, target) => (abilities[index]?.cost ? badgeRowMinPx(target) : 0),
  };
}

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
  stamp = null,
  symbolStyle,
}: LoyaltyRowsInput): LoyaltyRowsLayout {
  const orientation = orientationFromAspect(aspect);
  const ladder = rulesLadderPx(baseSizePct, orientation);
  const count = abilities.length;
  if (count === 0) {
    return { sizePx: ladder[0], sizePct: baseSizePct, rowFractions: [], lastRowInsetPct: 0, text: [], clipped: false };
  }
  const insetPct = shieldInsetPct(rect, shield);
  const insetHd = Math.round(insetPct * RULES_HD_WIDTH[orientation]);
  type RowsAt = ContentRowsAt;
  // The rows at one size: the walker's anatomy over the shared row
  // arithmetic (contentRowsAt), the last row short of the shield by
  // `lastInset` HD px.
  const rows: ContentRowsInput = {
    texts: abilities.map((ab) => ab.text),
    rect,
    baseSizePct,
    lineHeight,
    aspect,
    anatomy: loyaltyRowAnatomy(abilities),
    ...(symbolStyle ? { symbolStyle } : {}),
  };
  const rowsAt = (sizePx: number, lastInset: number, scaleIntoBox: boolean, lastLift = 0): RowsAt =>
    contentRowsAt(rows, sizePx, { lastRowInsetHd: lastInset, scaleIntoBox, ...(lastLift > 0 ? { lastRowLiftHd: lastLift } : {}) });
  // The stamp's arch (TODO 4.9d): the most the last row's text is ever held
  // up when its lines would enter it — the arch's height over the box's
  // bottom (the HD px from its highest column's top down to the box's
  // bottom), rounded UP to even px. The lift tried is the SMALLEST even one
  // that clears the arch (owner Round 72), never more.
  const archs = stamp && stamp.length > 0 ? stamp : null;
  const liftHd = (() => {
    if (!archs) return 0;
    const box = rectPx(rect, orientation, aspect, "hd");
    const top = Math.min(...archs.map((k) => rectPx(k, orientation, aspect, "hd").top));
    const lift = Math.ceil(box.top + box.height - top);
    return lift <= 0 ? 0 : lift + (lift % 2);
  })();
  /** Whether any line of any row, where its row puts it at either target,
   *  puts ink in the stamp's arch — glyph by glyph, as every badge. */
  const entersArch = (rows: RowsAt): boolean => {
    if (!archs) return false;
    return RULES_TARGETS.some((t) => {
      const ks = archs.map((k) => rectPx(k, orientation, aspect, t));
      return rows.text.some((layout, i) => {
        const placed = loyaltyRowLines(rows, i, t);
        return placed.lines.some((l) =>
          ks.some((k) => lineHitsKeepOut(l, layout.blocks[l.block].lines[l.line], placed.metrics, k)),
        );
      });
    });
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
    ...(rows.liftHd > 0 ? { lastRowLiftHd: rows.liftHd } : {}),
  });

  // At each size: the rows as they are; and where a layout that holds its
  // text and clears the shield fails ONLY on the stamp's arch (the
  // borderless walkers), the same layout with the last row's text held up
  // over it by the SMALLEST even lift (2, 4, … up to the arch's height)
  // that clears it (owner Round 72) — never a smaller size while holding
  // it up fits, and never a change to a walker whose text clears the arch.
  // Down the ladder twice (layout v75): first for a size whose badges keep
  // apart (loyaltyBadgesMeet — a long row's room given to its short
  // neighbours as the text shrinks), then — where no size parts them, as
  // with many equal one-line rows, whose pitch no size changes — exactly
  // as before the badges grew, so no walker is set smaller than its text
  // needs for a meeting no size would part.
  const down = (apart: boolean): LoyaltyRowsLayout | null => {
    const ok = (at: RowsAt) => !apart || !loyaltyBadgesMeet(at, abilities);
    for (const sizePx of ladder) {
      const candidates = insetHd > 0 ? [0, insetHd] : [0];
      const archOnly: number[] = [];
      for (const inset of candidates) {
        const at = rowsAt(sizePx, inset, false);
        if (!at.fits || reachesShield(at) || !ok(at)) continue;
        if (!entersArch(at)) return result(at, false);
        archOnly.push(inset);
      }
      if (archOnly.length === 0) continue;
      for (let lift = 2; lift <= liftHd; lift += 2) {
        for (const inset of archOnly) {
          const held = rowsAt(sizePx, inset, false, lift);
          if (held.fits && !reachesShield(held) && !entersArch(held) && ok(held)) return result(held, false);
        }
      }
    }
    return null;
  };
  const laid = down(true) ?? down(false);
  if (laid) return laid;
  // Nothing fits even at the floor: the floor's rows, scaled into the box —
  // with NO lift (owner Round 72): a lift here only takes room from a text
  // that already does not fit, so the fallback is exactly the unstamped one.
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
  layout: Pick<FrameProfile, "rules" | "loyalty" | "loyaltyRows" | "symbolStyle">,
  abilities: readonly LoyaltyAbility[],
  aspect: number,
  /** The holofoil stamp's arch while drawn, where the rows keep out of it
   *  (rowsStampKeepOut: the borderless walkers, TODO 4.9d). */
  stamp: readonly Rect[] | null = null,
): LoyaltyRowsLayout {
  return layoutLoyaltyRows({
    abilities,
    rect: layout.rules.rect,
    baseSizePct: walkerSizePct(layout),
    lineHeight: layout.rules.lineHeight ?? RULES_TEXT.lineHeight,
    aspect,
    shield: loyaltyShieldRect(layout),
    ...(stamp ? { stamp } : {}),
    ...(layout.symbolStyle ? { symbolStyle: layout.symbolStyle } : {}),
  });
}

/**
 * The stamp keep-out the ability ROWS read (TODO 4.9d): the arch's shape
 * on a frame whose notch is drawn above the rows (ResolvedHoloStamp
 * .aboveRows — the borderless walkers, whose window's own outline arches
 * into the last row's stripe), else null — m15pw's rows keep their shield
 * rule alone, as since 4.9c. The one answer both renderers, the creator's
 * crowding note and the tests read.
 */
export function rowsStampKeepOut(
  stamp: { aboveRows?: true; keepOut: Rect; keepOutShape?: readonly Rect[] } | null | undefined,
): readonly Rect[] | null {
  if (!stamp?.aboveRows) return null;
  return stamp.keepOutShape ?? [stamp.keepOut];
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
  /** The last row's extra bottom padding at this target (the stamp's arch,
   *  LoyaltyRowsLayout.lastRowLiftHd), whole px; absent without one (the
   *  drawing of every other walker is what it was). */
  lastRowLift?: number;
  text: { column: number; insetTop: number; insetBottom: number; metrics: RulesMetrics }[];
  /** Each row's rail at this target, whole px — the space before its text
   *  column, padding included (an ability's, or a static ability's). */
  rails: number[];
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
    ...(rows.lastRowLiftHd ? { lastRowLift: Math.round(rows.lastRowLiftHd * RULES_TARGET_SCALE[target]) } : {}),
    text: rows.text.map((layout) => {
      const placed = linePositions(layout, target);
      return {
        column: placed.interior.width,
        insetTop: placed.insetTop,
        insetBottom: placed.insetBottom,
        metrics: placed.metrics,
      };
    }),
    rails: rows.text.map((layout) => {
      const pad = layout.input.padPx;
      const left = pad && typeof pad === "object" && "left" in pad ? pad.left : railHd();
      return Math.round(left * RULES_TARGET_SCALE[target]);
    }),
  };
}

/** One printed loyalty badge at a target, card-absolute whole px of it:
 *  the art's box, the numeral's line box (the face's width, centred), and
 *  the colon's two dots (LOYALTY_BADGE_PRINT). */
export type LoyaltyBadgeDrawing = {
  row: number;
  shape: LoyaltyBadgeShape;
  label: string;
  art: { left: number; top: number; width: number; height: number };
  /** The silver rim's top and bottom rows (the art's soft shadow below it
   *  is not the badge): where two badges would meet. */
  rim: { top: number; bottom: number };
  numeral: { left: number; top: number; width: number; fontPx: number };
  colon: { left: number; top: number; size: number }[];
};

/**
 * The badges of `abilities` (one per ability with a cost; a static ability
 * has none, and no colon) where the prints draw them, at `target`: each on
 * its row's centre (the rows' whole-px edges both renderers draw), in
 * card-absolute px — OUTSIDE the rules box, so both renderers draw them in
 * a layer of their own after the rows (layout v75).
 */
export function loyaltyBadgesDrawing(
  rows: Pick<LoyaltyRowsLayout, "text" | "rowFractions">,
  abilities: readonly LoyaltyAbility[],
  target: RulesTarget,
): LoyaltyBadgeDrawing[] {
  const first = rows.text[0];
  if (!first) return [];
  const k = RULES_TARGET_SCALE[target];
  const box = rectPx(first.input.rect, first.orientation, first.input.aspect, target);
  const edges = loyaltyRowEdgesPx(rows.rowFractions, box.height);
  const p = LOYALTY_BADGE_PRINT;
  const span = (from: number, size: number) => {
    const a = Math.round(from);
    return { at: a, size: Math.round(from + size) - a };
  };
  const out: LoyaltyBadgeDrawing[] = [];
  abilities.forEach((ab, i) => {
    if (!ab.cost || i >= edges.length - 1) return;
    const shape = loyaltyBadgeShapeOf(ab.cost);
    const centre = box.top + (edges[i] + edges[i + 1]) / 2;
    const art = badgeArtHd(shape);
    const x = span(art.left * k, art.width * k);
    const y = span(centre + art.top * k, art.height * k);
    const fontPx = Math.round(loyaltyBadgeNumeralPx(loyaltyBadgeLabel(ab.cost)) * k);
    const faceCentre = centre + (p.shapes[shape].faceDyPx + p.numeralDyPx) * k;
    const nx = span(p.faceLeftPx * k, p.faceWidthPx * k);
    const dot = Math.round(p.colon.dotPx * k);
    const dotLeft = Math.round(p.colon.centreXPx * k - dot / 2);
    out.push({
      row: i,
      shape,
      label: loyaltyBadgeLabel(ab.cost),
      art: { left: x.at, top: y.at, width: x.size, height: y.size },
      rim: { top: centre + art.rimTop * k, bottom: centre + art.rimBottom * k },
      numeral: { left: nx.at, top: Math.round(faceCentre - BADGE_NUMERAL_CENTRE_EM * fontPx), width: nx.size, fontPx },
      colon: [-1, 1].map((side) => ({ left: dotLeft, top: Math.round(centre + side * p.colon.halfGapPx * k - dot / 2), size: dot })),
    });
  });
  return out;
}

/** Whether two neighbouring badges of `rows` touch or overlap at either
 *  bake target (their silver rims, where the rows put them) — a static
 *  ability draws none, so only neighbours that both have a cost count. The
 *  layout steps its size down before it lets them (layoutLoyaltyRows); past
 *  the floor they may, and the row editor says so (lib/creator/
 *  walker-crowding.ts). */
export function loyaltyBadgesMeet(
  rows: Pick<LoyaltyRowsLayout, "text" | "rowFractions">,
  abilities: readonly Pick<LoyaltyAbility, "cost">[],
): boolean {
  if (rows.rowFractions.length < 2) return false;
  const drawn = abilities.map((a) => ({ cost: a.cost, text: "" }));
  return RULES_TARGETS.some((target) => {
    const badges = loyaltyBadgesDrawing(rows, drawn, target);
    return badges.some((b, j) => {
      const next = badges[j + 1];
      return next !== undefined && next.row === b.row + 1 && next.rim.top <= b.rim.bottom;
    });
  });
}
