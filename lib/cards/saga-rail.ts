// ---------------------------------------------------------------------------
// The saga chapter rail's text, through the ONE rules line drawing (layout
// v33, TODO 3.29) — one layout for the live preview (components/cards/
// card-preview.tsx ChapterRail) and the Satori bake (lib/render/
// card-image.tsx ChapterBake).
//
// Owner decision 2026-09-28: CORRECTNESS ONLY. The intro and every chapter
// are drawn as the rules layout's lines (lib/cards/rules-layout.ts) — real
// pips (DOM #122's "Add {R}{R}." used to bake as literal braces), reminder
// text in italics, U+2212 as the hyphen MPlantin has — AT TODAY'S SIZE, in
// today's equal rows, with today's badges, padding and dividers. The print
// anatomy (per-chapter hex badges on the rail's edge, 7.5 pt text, rows sized
// by their text) is TODO 4.21's re-source.
//
// "Today's" means the v32 bake, px for px at both targets: the chapter text
// at the slot's size (0.029 W — 22 px at 750, 44 at HD), the intro at 0.9 of
// it (20 / 40), each spacing value rounded from the target's own size. The
// only numbers that are the rules standard's are the word gap, the pips and
// the pip gap (RULES_TEXT), which the text now draws with. The HD size is
// twice the 750 bake's, so the 750 bake draws exactly half (the rules
// layout's contract), and the preview draws the HD bake's px.
//
// Lines are broken for the column each row really leaves the text — the rail
// less the row's padding, the marker badge's box and its gap — at both
// targets. The badge box is drawn at the width computed here (its marker's
// Beleren advances + padding, or the minimum), so a combined "II, III, IV"
// marker takes the room the lines were broken for in both renderers.
// ---------------------------------------------------------------------------

import type { SagaChapter } from "@/lib/cards/card-display";
import { displayTextExactWidthEm } from "@/lib/cards/display-metrics";
import {
  RULES_TARGETS,
  breakRulesParagraphs,
  metricsFor,
  rectPx,
  type RulesBlock,
  type RulesMetrics,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import { tokenizeRulesText, type RulesItem } from "@/lib/cards/rules-text";
import type { FrameProfile } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";

type ChapterSlot = NonNullable<FrameProfile["chapters"]>;

/** The rail's anatomy, in em of the chapter text size — v32's numbers. */
export const SAGA_RAIL = {
  /** The intro (the lore-counter reminder) above chapter I: its size, its
   *  line height, and its padding (vertical, horizontal) in em of the
   *  CHAPTER size. */
  introSizeEm: 0.9,
  introLineHeight: 1.2,
  introPadYEm: 0.4,
  introPadXEm: 0.3,
  /** Chapter text line height. */
  chapterLineHeight: 1.22,
  /** A chapter row's padding: vertical, horizontal. */
  rowPadYEm: 0.3,
  rowPadXEm: 0.2,
  /** The marker badge: its minimum width, its height (× the width), its
   *  side padding, the gap after it; the numeral's size and its lift. */
  badgeEm: 1.7,
  badgeHeightScale: 1.12,
  badgePadXEm: 0.32,
  badgeGapEm: 0.6,
  markerTextEm: 0.82,
  markerLiftEm: 0.3,
} as const;

/** The rail's anatomy at one target, in that target's whole px — each value
 *  rounded from the target's own chapter size, as v32 drew it. */
export type SagaRailPx = {
  /** Chapter text size, and the intro's. */
  size: number;
  introSize: number;
  introPadY: number;
  introPadX: number;
  rowPadY: number;
  rowPadX: number;
  /** The badge's minimum width and its height. */
  badge: number;
  badgeHeight: number;
  badgePadX: number;
  badgeGap: number;
  markerText: number;
  markerLift: number;
};

/** The chapter size in HD px: twice the 750 bake's whole px, so that bake
 *  draws exactly half (0.029 W → 44 px, 22 at 750 — v32's sizes). */
export function sagaChapterSizePx(slot: Pick<ChapterSlot, "sizePct">): number {
  return 2 * Math.round((slot.sizePct * RULES_HD_WIDTH.portrait) / 2);
}

export function sagaRailPx(slot: Pick<ChapterSlot, "sizePct">, target: RulesTarget): SagaRailPx {
  const r = SAGA_RAIL;
  const size = target === "hd" ? sagaChapterSizePx(slot) : sagaChapterSizePx(slot) / 2;
  const at = (em: number) => Math.round(size * em);
  const introHalf = Math.round((sagaChapterSizePx(slot) / 2) * r.introSizeEm);
  const badge = at(r.badgeEm);
  return {
    size,
    introSize: target === "hd" ? 2 * introHalf : introHalf,
    introPadY: at(r.introPadYEm),
    introPadX: at(r.introPadXEm),
    rowPadY: at(r.rowPadYEm),
    rowPadX: at(r.rowPadXEm),
    badge,
    badgeHeight: Math.round(badge * r.badgeHeightScale),
    badgePadX: at(r.badgePadXEm),
    badgeGap: at(r.badgeGapEm),
    markerText: at(r.markerTextEm),
    markerLift: at(r.markerLiftEm),
  };
}

/** A marker badge's box width at a target: its numeral's EXACT Beleren
 *  advances (the width Satori gives the text — it doesn't kern — ceiled to
 *  the px, as v32's bake sized the box) plus its padding, or the badge's
 *  minimum. */
export function sagaBadgeWidthPx(marker: string, px: SagaRailPx): number {
  return Math.max(px.badge, Math.ceil(displayTextExactWidthEm(marker) * px.markerText - 1e-6) + 2 * px.badgePadX);
}

export type SagaRailLayout = {
  /** Chapter text size and the intro's, HD px. */
  sizePx: number;
  introSizePx: number;
  /** The intro's lines (italic throughout, as v32 set it), or null. */
  intro: RulesBlock[] | null;
  chapters: { marker: string; blocks: RulesBlock[] }[];
};

/** A chapter's or the intro's text as one paragraph of rules items: v32 drew
 *  it as plain text, so a line break inside it was a space. */
function oneParagraph(text: string): RulesItem[][] {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat ? [tokenizeRulesText(flat).flat()] : [];
}

/**
 * The rail's text laid out at today's sizes: the intro's lines and each
 * chapter's, broken for their columns at both targets.
 */
export function layoutSagaRail(
  slot: ChapterSlot,
  intro: string | null,
  chapters: readonly SagaChapter[],
): SagaRailLayout {
  const px = { hd: sagaRailPx(slot, "hd"), default: sagaRailPx(slot, "default") };
  const railWidth = (t: RulesTarget) => rectPx(slot.rect, "portrait", 7 / 5, t).width;
  const columns = (width: (t: RulesTarget) => number) =>
    Object.fromEntries(RULES_TARGETS.map((t) => [t, width(t)])) as Record<RulesTarget, number>;
  const introItems = intro
    ? oneParagraph(intro).map((items) => items.map((it) => (it.t === "w" && !it.em ? { ...it, em: "reminder" as const } : it)))
    : [];
  return {
    sizePx: px.hd.size,
    introSizePx: px.hd.introSize,
    intro:
      introItems.length > 0
        ? breakRulesParagraphs(
            introItems,
            px.hd.introSize,
            columns((t) => railWidth(t) - 2 * px[t].introPadX),
            SAGA_RAIL.introLineHeight,
          )
        : null,
    chapters: chapters.map((ch) => ({
      marker: ch.marker,
      blocks: breakRulesParagraphs(
        oneParagraph(ch.text),
        px.hd.size,
        columns((t) => railWidth(t) - 2 * px[t].rowPadX - sagaBadgeWidthPx(ch.marker, px[t]) - px[t].badgeGap),
        SAGA_RAIL.chapterLineHeight,
      ),
    })),
  };
}

/** The rail's text metrics at one target: the chapters' and the intro's. */
export function sagaRailMetrics(layout: SagaRailLayout, target: RulesTarget): { chapter: RulesMetrics; intro: RulesMetrics } {
  return {
    chapter: metricsFor(layout.sizePx, SAGA_RAIL.chapterLineHeight, target),
    intro: metricsFor(layout.introSizePx, SAGA_RAIL.introLineHeight, target),
  };
}
