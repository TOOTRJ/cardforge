// ---------------------------------------------------------------------------
// The saga's chapter rail (TODO 4.21c = 3.7; design 2026-09-29 §3.4, owner
// decisions 2026-09-29) — ONE layout, in HD pixels, for the live preview
// (components/cards/card-preview.tsx ChapterRail) and the Satori bake
// (lib/render/card-image.tsx ChapterBake). Pure: no React, no font parsing.
//
// The frame gives the geometry (FrameProfile.chapters, measured on the prints
// and on Card Conjurer's saga pack); this module decides everything a card's
// own text moves:
//
//   * THE REMINDER BLOCK (the intro) — rules text in its own fixed box above
//     chapter I (the frame paints that box: its outline ends at the fold the
//     ribbon starts from), laid out by the rules layout (lib/cards/
//     rules-layout.ts) on its own ladder: a long reminder steps down inside
//     its box, it never pushes the rows. Its emphasis is the text's own, as
//     the prints set it: the parenthesised reminder italic, a keyword before
//     it roman (DMU #85's "Read ahead (Choose a chapter…)") — v33 set the
//     whole block italic.
//   * WHERE THE ROWS START — under the reminder block (`rowsTopPct`, the
//     first divider), or from the rail's own top when the saga has no
//     reminder (owner decision 2026-09-29: no empty reminder band, no
//     generated reminder — all four stored production sagas).
//   * THE ROWS — one per chapter, content-sized by the walker rows'
//     arithmetic (lib/cards/loyalty-rows.ts contentRowsAt): a row's natural
//     height is its text block with the row's padding, or its stack of
//     chapter badges, whichever is taller, in whole px at BOTH bake targets;
//     what the rail has left is shared equally. The text is ONE size for the
//     whole rail — the largest step of the rules ladder at which every row
//     fits.
//   * THE BADGE STACKS — one hexagon per chapter numeral, stacked down the
//     ribbon. The prints set a stack's pitch 160 px where there is room
//     (DOM, THB, KHM, 40K, WOE, PIP) and ≈ 138 px where there is not (LTR,
//     LTC, WHO, MH3 — WHO #99 stacks five, LTR #174 six): the pitch is the
//     roomiest whole step from 160 down to 138 at which the rows fit at the
//     text's size, and the text steps down only after the stacks are tight.
//   * THE COMBINED MARKER — a stack that can never fit (repeated numerals:
//     validation allows a numeral on several rows, so the stacks' own
//     heights can pass the rail) turns every multi-badge row into ONE badge
//     with a combined label ("I–III", or "I,III,V" when the numerals are not
//     a run); a row with more numerals than a stack may hold (SAGA_RAIL
//     .maxStack) takes it alone.
//   * EVERY POSITION — the rows' whole-px edges, the divider on each row's
//     top edge, each badge's box, each numeral's line box — per target
//     (sagaRailDrawing): the HD bake's, which the preview draws in cqw, and
//     the 750 px bake's own.
//
// Both renderers only DRAW what this returns: the reminder and each
// chapter's text are rules layouts (RulesBox / RulesBoxBake draw their
// lines), the badges and dividers are the pack's bitmaps at the boxes given
// (drawn with the frame, under both finish sheens — printed frame, not ink),
// the numerals are text in the boxes given.
// ---------------------------------------------------------------------------

import type { SagaChapter } from "@/lib/cards/card-display";
import { contentRowsAt, loyaltyRowEdgesPx, type ContentRowsAt, type ContentRowsInput } from "@/lib/cards/loyalty-rows";
import { fromTopWhenOverflowing } from "@/lib/cards/rules-box";
import {
  RULES_TARGETS,
  RULES_TARGET_SCALE,
  blockHeightPx,
  fitRulesLayout,
  rectPx,
  rulesLadderPx,
  type RulesLayout,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import type { FrameProfile, Rect } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";

export type ChapterSlot = NonNullable<FrameProfile["chapters"]>;

/** The rail's own numbers — what is not the frame's geometry. HD px unless
 *  it says em. */
export const SAGA_RAIL = {
  /** A row's padding above and below its text block. The densest print
   *  measured (40K #126) keeps 18 px of paper between its ink and a divider;
   *  a 0.98 em line box already holds ≈ 4 px of air above the ascenders and
   *  ≈ 2 px below the descenders. */
  rowPadYPx: 14,
  /** The chapter text column's padding inside `chapters.rect`: none — the
   *  rect IS the column (the layout keeps its own side headroom for a glyph
   *  that inks past its advance). */
  textPadXPx: 0,
  /** The reminder block's padding inside its box. */
  introPadPx: { x: 0, y: 0 },
  /** How far a badge stack sits ABOVE its row's centre, in em of the chapter
   *  text: the prints hang the badge on the text's leading (its centre
   *  0.445 em above the text's mean baseline — DOM #21 880.0 px against
   *  880.0, DOM #38 / #90 / #122 / #173 within 4 px), where a stack centred
   *  like the text's line boxes would sit 0.2745 em above it. Never past the
   *  row's own edges. */
  badgeLiftEm: 0.17,
  /** The most badges ONE row stacks. The prints go to six (LTR #174 Long
   *  List of the Ents; WHO #99 City of Death five, WHO #86 The Flux and FIN
   *  #35 four) — the design's "four or more → combined" took those for
   *  unprinted. A row with more numerals than this draws the combined
   *  marker. */
  maxStack: 6,
  /** The pitch search's step: even, so the 750 px bake's pitch is whole. */
  pitchStepPx: 2,
  /** A badge's label: the room it keeps from the badge's sides (the
   *  hexagon's bevel), and the smallest size a fitted one is drawn at. */
  labelInsetPx: 16,
  labelMinPx: 24,
  /** How far the numeral's capitals are centred below the badge's centre. */
  numeralDyPx: 1,
} as const;

/** MPlantin's capital height and the capitals' centre below a line box's
 *  top, in em, for a line box one em tall (hhea 0.774 / 0.225: the baseline
 *  0.7745 em down, the capitals 0.682 em tall). */
const CAP_CENTRE_EM = 0.7745 - 0.682 / 2;

/** Where the divider's dark line is centred, as a share of the bitmap's
 *  height (sagaDivider.png: a 5-row dark line over a 4-row white one in 9
 *  rows — centred 2.5 rows down). The row's top edge is THAT line: the
 *  prints' dividers read 619–621 px with the rows starting at 621. */
const DIVIDER_LINE_CENTRE = 2.5 / 9;

const ROMAN_VALUE: Readonly<Record<string, number>> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

/** A chapter marker ("II,III,IV") as its numerals. */
export function sagaNumerals(marker: string): string[] {
  return marker
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
}

/** ONE badge's label for several numerals: a run of consecutive numerals as
 *  its ends ("I–III"), anything else as the list ("I,III,V"). */
export function combinedSagaLabel(numerals: readonly string[]): string {
  const values = numerals.map((n) => ROMAN_VALUE[n]);
  const run = values.length > 1 && values.every((v, i) => v !== undefined && (i === 0 || v === (values[i - 1] ?? NaN) + 1));
  return run ? `${numerals[0]}–${numerals[numerals.length - 1]}` : numerals.join(",");
}

export type SagaRailRow = {
  /** The chapter's marker as stored ("II,III,IV") and its numerals. */
  marker: string;
  numerals: string[];
  /** Drawn as ONE badge with a combined label instead of a stack. */
  combined: boolean;
  /** The label on each badge drawn, top to bottom: the numerals, or the one
   *  combined label; none for a chapter with no marker. */
  labels: string[];
  /** The chapter's lines, laid out in the rows' column (the row's own box is
   *  sagaRailDrawing's). */
  text: RulesLayout;
};

export type SagaRail = {
  slot: ChapterSlot;
  /** Card height ÷ card width. */
  aspect: number;
  /** The chapter text's size, HD px (an even step of the rules ladder). */
  sizePx: number;
  /** A stack's pitch, HD px (even). */
  pitchPx: number;
  /** The reminder block, or null when the saga has none. */
  intro: RulesLayout | null;
  rows: SagaRailRow[];
  /** The box the rows fill: the text column from where the rows start to
   *  the rail's foot. */
  rowsRect: Rect;
  /** Each row's share of that box, top to bottom. */
  rowFractions: number[];
  /** The rows don't fit even at the ladder's floor with tight stacks: the
   *  floor's rows, scaled alike into the box (a row may clip its text). */
  clipped: boolean;
  /** The stacks alone could not fit the rail: every multi-badge row draws
   *  the combined marker. */
  combinedFallback: boolean;
};

/** One badge's height and a stack's extent at a target, whole px. */
function badgeHeightPx(slot: ChapterSlot, aspect: number, target: RulesTarget): number {
  const cardHeight = Math.round(RULES_HD_WIDTH.portrait * RULES_TARGET_SCALE[target] * aspect);
  return Math.round((slot.badge.heightPct / 100) * cardHeight);
}
function stackExtentPx(slot: ChapterSlot, aspect: number, target: RulesTarget, count: number, pitchHd: number): number {
  if (count <= 0) return 0;
  return badgeHeightPx(slot, aspect, target) + (count - 1) * pitchHd * RULES_TARGET_SCALE[target];
}

/** The pitch range in HD px: the profile's, on the even grid. */
function pitchRangePx(slot: ChapterSlot, aspect: number): { min: number; max: number } {
  const cardHeight = Math.round(RULES_HD_WIDTH.portrait * aspect);
  const even = (pct: number) => 2 * Math.round(((pct / 100) * cardHeight) / 2);
  const min = even(slot.badge.pitchPct.min);
  return { min, max: Math.max(min, even(slot.badge.pitchPct.max)) };
}

/**
 * The rail of one saga: its reminder block, its rows and their badges, at
 * the one text size and stack pitch at which everything fits (see the
 * header). Deterministic, so the preview and the bake draw the same rail by
 * construction. `intro` and each chapter's text keep their line breaks as
 * paragraphs.
 */
export function sagaRail(slot: ChapterSlot, intro: string | null | undefined, chapters: readonly SagaChapter[], aspect: number = 7 / 5): SagaRail {
  const introText = intro?.trim() ? intro.trim() : null;
  const foot = slot.rect.topPct + slot.rect.heightPct;
  const rowsTop = introText ? slot.rowsTopPct : slot.rect.topPct;
  const rowsRect: Rect = { leftPct: slot.rect.leftPct, widthPct: slot.rect.widthPct, topPct: rowsTop, heightPct: foot - rowsTop };
  const ladder = rulesLadderPx(slot.sizePct, "portrait");
  const pitch = pitchRangePx(slot, aspect);

  // The reminder block: its own box and ladder. A saga typed with no
  // chapter markers is ALL reminder — it takes the whole rail, in the
  // chapters' column (the reminder box's own width would run its lines over
  // the ribbon below the fold), and clips at the rail's foot from its first
  // line if it is longer than that.
  const introLayout = introText
    ? fromTopWhenOverflowing(
        fitRulesLayout({
          rulesText: introText,
          rect: chapters.length > 0 ? slot.intro.rect : { leftPct: slot.rect.leftPct, widthPct: slot.rect.widthPct, topPct: slot.intro.rect.topPct, heightPct: foot - slot.intro.rect.topPct },
          aspect,
          sizePct: slot.intro.sizePct,
          ...(slot.intro.lineHeight !== undefined ? { lineHeight: slot.intro.lineHeight } : {}),
          padPx: SAGA_RAIL.introPadPx,
          vAlign: "center",
        }),
      )
    : null;

  const numerals = chapters.map((ch) => sagaNumerals(ch.marker));
  if (chapters.length === 0) {
    return { slot, aspect, sizePx: ladder[0], pitchPx: pitch.max, intro: introLayout, rows: [], rowsRect, rowFractions: [], clipped: false, combinedFallback: false };
  }

  // How many badges each row stacks: its numerals, or ONE combined marker —
  // for a row past the stack's limit always, and for every multi-badge row
  // when the tight stacks alone are taller than the rows' box at either
  // target (repeated numerals).
  const box = { hd: rectPx(rowsRect, "portrait", aspect, "hd"), default: rectPx(rowsRect, "portrait", aspect, "default") };
  const stacked = numerals.map((n) => (n.length > SAGA_RAIL.maxStack ? 1 : n.length));
  const combinedFallback = RULES_TARGETS.some(
    (t) => stacked.reduce((sum, count) => sum + stackExtentPx(slot, aspect, t, count, pitch.min), 0) > box[t].height,
  );
  const counts = combinedFallback ? stacked.map((count) => Math.min(count, 1)) : stacked;
  const stacks = counts.some((count) => count > 1);

  const input = (pitchHd: number): ContentRowsInput => ({
    texts: chapters.map((ch) => ch.text),
    rect: rowsRect,
    baseSizePct: slot.sizePct,
    ...(slot.lineHeight !== undefined ? { lineHeight: slot.lineHeight } : {}),
    aspect,
    anatomy: {
      padPx: { left: SAGA_RAIL.textPadXPx, right: SAGA_RAIL.textPadXPx, top: SAGA_RAIL.rowPadYPx, bottom: SAGA_RAIL.rowPadYPx },
      minHeightPx: (i, target) => stackExtentPx(slot, aspect, target, counts[i], pitchHd),
    },
  });

  // Down the ladder: the first size whose rows fit with the stacks tight,
  // then the roomiest pitch that still fits at that size. With no stack the
  // pitch moves nothing.
  let chosen: { rows: ContentRowsAt; pitchHd: number; clipped: boolean } | null = null;
  for (const sizePx of ladder) {
    const tight = contentRowsAt(input(pitch.min), sizePx);
    if (!tight.fits) continue;
    chosen = { rows: tight, pitchHd: stacks ? pitch.min : pitch.max, clipped: false };
    if (stacks) {
      for (let p = pitch.max; p > pitch.min; p -= SAGA_RAIL.pitchStepPx) {
        const roomy = contentRowsAt(input(p), sizePx, { text: tight.text });
        if (roomy.fits) {
          chosen = { rows: roomy, pitchHd: p, clipped: false };
          break;
        }
      }
    }
    break;
  }
  if (!chosen) {
    // Nothing fits even at the floor: the floor's rows with tight stacks,
    // scaled alike into the box.
    const floor = ladder[ladder.length - 1];
    chosen = { rows: contentRowsAt(input(pitch.min), floor, { scaleIntoBox: true }), pitchHd: pitch.min, clipped: true };
  }

  const fitted = chosen;
  return {
    slot,
    aspect,
    sizePx: fitted.rows.sizePx,
    pitchPx: fitted.pitchHd,
    intro: introLayout,
    rows: chapters.map((ch, i) => {
      const combined = numerals[i].length > 1 && counts[i] === 1;
      return {
        marker: ch.marker,
        numerals: numerals[i],
        combined,
        labels: combined ? [combinedSagaLabel(numerals[i])] : numerals[i],
        text: fitted.rows.text[i],
      };
    }),
    rowsRect,
    rowFractions: fitted.rows.rowFractions,
    clipped: fitted.clipped,
    combinedFallback,
  };
}

/** sagaRail for a card on `layout` (null on a frame without a rail). */
export function profileSagaRail(
  layout: Pick<FrameProfile, "chapters">,
  content: { intro: string | null; chapters: readonly SagaChapter[] } | null,
  aspect: number = 7 / 5,
): SagaRail | null {
  return layout.chapters && content ? sagaRail(layout.chapters, content.intro, content.chapters, aspect) : null;
}

// ---------------------------------------------------------------------------
// Drawing geometry
// ---------------------------------------------------------------------------

/** A box in whole px of one target, card-absolute. */
export type PxBox = { left: number; top: number; width: number; height: number };

export type SagaBadgeDrawing = PxBox & {
  /** The numeral (or the combined label) and its size at this target. */
  label: string;
  fontPx: number;
  /** The label's line box — `fontPx` tall (line height 1), the badge's
   *  width, the text centred in it — from this top (card-absolute), so its
   *  capitals centre on the badge. */
  labelTop: number;
};

export type SagaRowDrawing = {
  /** The row's box: [top, bottom) of the rows' column. */
  top: number;
  bottom: number;
  /** The chapter's lines in the row's own box at this target (its
   *  `input.rect` rounds to [top, bottom) there) — drawn by RulesBox /
   *  RulesBoxBake. */
  text: RulesLayout;
  badges: SagaBadgeDrawing[];
  /** The divider on the row's top edge, or null (the first row of a rail
   *  with no reminder block starts at the frame's own edge). */
  divider: PxBox | null;
};

export type SagaRailDrawing = {
  target: RulesTarget;
  /** The target's card size, px. */
  cardWidth: number;
  cardHeight: number;
  /** The reminder block (its `input.rect` is its box), or null. */
  intro: RulesLayout | null;
  rows: SagaRowDrawing[];
};

/** A badge label's size, HD px: the numeral's, stepped down (even px) to
 *  the room the badge's face leaves it — a combined label ("I–III"), or a
 *  numeral past VI from a legacy marker ("VIII") — never below its minimum.
 *  I to VI keep the numeral's size (the widest, III, is 1.125 em). */
export function sagaLabelSizePx(slot: ChapterSlot, label: string): number {
  const numeral = 2 * Math.round((slot.badge.numeralSizePct * RULES_HD_WIDTH.portrait) / 2);
  const face = (slot.badge.widthPct / 100) * RULES_HD_WIDTH.portrait - 2 * SAGA_RAIL.labelInsetPx;
  const width = rulesTextWidthEm(label, false);
  const fitted = width > 0 ? 2 * Math.floor(face / width / 2) : numeral;
  return Math.max(SAGA_RAIL.labelMinPx, Math.min(numeral, fitted));
}

/** A px box of `target` as card percents whose edges round back to it there
 *  (and are exact on the HD card the preview scales). */
export function pxBoxRect(box: PxBox, d: Pick<SagaRailDrawing, "cardWidth" | "cardHeight">): Rect {
  return {
    leftPct: (box.left / d.cardWidth) * 100,
    topPct: (box.top / d.cardHeight) * 100,
    widthPct: (box.width / d.cardWidth) * 100,
    heightPct: (box.height / d.cardHeight) * 100,
  };
}

/**
 * What a renderer draws for `rail` at one target, in that target's whole px:
 * each row's box, its text in that box, its badges (centred in the row and
 * lifted onto the text's leading, SAGA_RAIL.badgeLiftEm, inside the row) with
 * their numerals' line boxes, and the divider on its top edge.
 */
export function sagaRailDrawing(rail: SagaRail, target: RulesTarget): SagaRailDrawing {
  const { slot, aspect } = rail;
  const scale = RULES_TARGET_SCALE[target];
  const cardWidth = RULES_HD_WIDTH.portrait * scale;
  const cardHeight = Math.round(cardWidth * aspect);
  const box = rectPx(rail.rowsRect, "portrait", aspect, target);
  const edges = loyaltyRowEdgesPx(rail.rowFractions, box.height);
  const px = (pct: number, of: number) => Math.round((pct / 100) * of);

  const badgeLeft = px(slot.badge.leftPct, cardWidth);
  const badgeWidth = px(slot.badge.leftPct + slot.badge.widthPct, cardWidth) - badgeLeft;
  const badgeHeight = badgeHeightPx(slot, aspect, target);
  const pitch = rail.pitchPx * scale;
  const lift = Math.round(SAGA_RAIL.badgeLiftEm * rail.sizePx * scale);

  const dividerLeft = px(slot.divider.leftPct, cardWidth);
  const dividerWidth = px(slot.divider.leftPct + slot.divider.widthPct, cardWidth) - dividerLeft;
  const dividerHeight = Math.max(1, px(slot.divider.heightPct, cardHeight));

  const rows = rail.rows.map((row, i): SagaRowDrawing => {
    const top = box.top + edges[i];
    const bottom = box.top + edges[i + 1];
    const rowRect: Rect = { ...rail.rowsRect, topPct: (top / cardHeight) * 100, heightPct: ((bottom - top) / cardHeight) * 100 };
    const count = row.labels.length;
    const extent = count > 0 ? badgeHeight + (count - 1) * pitch : 0;
    const centred = Math.round((top + bottom - extent) / 2);
    // Lifted onto the text's leading, but never out of the row; a stack
    // taller than its row (a rail past its floor) stays centred.
    const stackTop = extent <= bottom - top ? Math.min(Math.max(centred - lift, top), bottom - extent) : centred;
    // A row past the ladder's floor (rail.clipped) that can't hold its text
    // sets it from the row's TOP: the clip then takes the tail, never the
    // chapter's first line (rules-box.ts fromTopWhenOverflowing's rule).
    const padV = Math.round(SAGA_RAIL.rowPadYPx * scale) * 2;
    const overflows = rail.clipped && blockHeightPx(row.text, target) + padV > bottom - top;
    return {
      top,
      bottom,
      text: { ...row.text, input: { ...row.text.input, rect: rowRect, ...(overflows ? { vAlign: "start" as const } : {}) } },
      badges: row.labels.map((label, j) => {
        const badgeTop = stackTop + j * pitch;
        const fontPx = sagaLabelSizePx(slot, label) * scale;
        return {
          left: badgeLeft,
          top: badgeTop,
          width: badgeWidth,
          height: badgeHeight,
          label,
          fontPx,
          labelTop: Math.round(badgeTop + badgeHeight / 2 + SAGA_RAIL.numeralDyPx * scale - CAP_CENTRE_EM * fontPx),
        };
      }),
      divider:
        i > 0 || rail.intro
          ? { left: dividerLeft, top: top - Math.round(dividerHeight * DIVIDER_LINE_CENTRE), width: dividerWidth, height: dividerHeight }
          : null,
    };
  });
  return { target, cardWidth, cardHeight, intro: rail.intro, rows };
}

/** The rail's bitmaps a drawing puts down, as the frame overlays both
 *  renderers and both finish masks treat them (drawn with the frame, under
 *  the sheens): every divider, then every badge, each at its box. */
export function sagaRailPieces(d: SagaRailDrawing, slot: ChapterSlot): { path: string; rect: Rect }[] {
  return [
    ...d.rows.flatMap((row) => (row.divider ? [{ path: slot.divider.assetPath, rect: pxBoxRect(row.divider, d) }] : [])),
    ...d.rows.flatMap((row) => row.badges.map((badge) => ({ path: slot.badge.assetPath, rect: pxBoxRect(badge, d) }))),
  ];
}

/** The frame assets a rail draws (the bake preloads them): the badge when a
 *  chapter has one, the divider when a row has one. */
export function sagaRailAssetPaths(rail: SagaRail | null): string[] {
  if (!rail) return [];
  const badge = rail.rows.some((row) => row.labels.length > 0);
  const divider = rail.rows.length > 1 || (rail.rows.length === 1 && rail.intro !== null);
  return [...(badge ? [rail.slot.badge.assetPath] : []), ...(divider ? [rail.slot.divider.assetPath] : [])];
}
