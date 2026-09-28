// The card name next to a DETACHED mana cost (FrameProfile.costRect — m15pw
// and modern). Both renderers draw those pips in their own right-aligned box,
// so the name's span used to run the whole title band and a long name slid
// under the pips ("Miner the Miner, Damned Delver"). The name now ends one
// band gap before the cost's left edge, measured from the cost it actually
// draws, and a name too long for that width shrinks to fit it, the way a
// printed name is set (owner decision 2026-09-25, TODO 3.10 for these
// frames). Only past the fit's 5 pt floor is it cut, with a "…".
//
// Since layout v32 (TODO 4.20) the M15-era family's names fit the same way
// in EVERY band — a slot with `fit: "measured"`: next to an inline cost,
// alone, or centred, as well as before a detached cost — at the family's one
// name size and down to the 5 pt floor of the card's orientation. Both
// renderers take the name's text, width and size from fitTitleBand, which
// keeps fitDetachedCostTitle for every other frame.

import { tokenize } from "@/components/cards/mana-cost-glyphs";
import { displayTextWidthEm, truncateDisplayLine } from "@/lib/cards/display-metrics";
import {
  BAND_GAP_PCT,
  COST_PIP_GAP,
  HALF_PX_PCT,
  MIN_NAME_EM,
  NAME_COST_GAP_PCT,
  costRowWidthPct,
  fitSingleLineSizePct,
  measuredLineFloorPct,
  measuredLineSizePct,
  pastFloorText,
} from "@/lib/cards/render-tiers";
import type { FrameProfile } from "@/lib/cards/template-layout";
import type { CardOrientation } from "@/lib/cards/typography";

/** The title band's name ↔ cost gap, as a fraction of card width (preview
 *  `gap: 2cqw`, bake `gap: fpx(0.02)`) — the same gap aftermath's second
 *  face measures (render-tiers NAME_COST_GAP_PCT). */
export const TITLE_COST_GAP_PCT = NAME_COST_GAP_PCT;

/** Space between two cost pips as a fraction of the disc — the bake's
 *  CostGlyphs gap, the wider of the two renderers' (the preview's
 *  0.12 em is of the disc ÷ 1.3), so the estimate never runs short. */
const PIP_GAP_DISC = COST_PIP_GAP;
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

/** `name` cut to at most `maxEm` including its "…" (truncateDisplayLine,
 *  lib/cards/display-metrics.ts), measured by its advances. */
function truncateToEm(name: string, maxEm: number, metrics: Metrics): string {
  return truncateDisplayLine(name, maxEm, (s) => displayTextWidthEm(s, metrics));
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

// ---------------------------------------------------------------------------
// fitTitleBand — the measured name fit (TextSlot.fit "measured", layout v32).
// ---------------------------------------------------------------------------

/** The gap a measured name keeps before a DETACHED cost (the planeswalker's
 *  costRect), as a fraction of card width, from the name's box — its
 *  advances, what the bake lays out — to the first disc's edge: the band gap
 *  an inline cost keeps (BAND_GAP_PCT, 30 px at HD). The name's ink ends
 *  before its box (the last letter's side bearing, its tracking, and the
 *  kerning Beleren tightens a name by — 2.5 % at the median), so the drawn
 *  gap is ≈ 35–60 px: the prints' 39–57 px (KLD #110, WAR #169 / #231 /
 *  #275; 4.20 print review), where the 0.005 W first shipped drew
 *  "Defiance" 17 px from its {2}. Re-tuned against print (owner decision
 *  2026-09-28): KLD #110 sets "Chandra, Torch of Defiance" at ≈ 78 px
 *  (its x-height), and so do we; a name the print sets at full size and
 *  that fits our wider Beleren (Gideon, Kaya, Karn, Liliana) keeps 80 px.
 *  The old detached path (modern) keeps TITLE_COST_GAP_PCT and
 *  TITLE_FIT_HEADROOM. */
export const DETACHED_COST_GAP_PCT = BAND_GAP_PCT;

type TitleBandLayout = Pick<FrameProfile, "title" | "costRect" | "costSizePct">;

/**
 * The room (fraction of card width) a measured name has in its band:
 *
 * - before a detached cost: up to DETACHED_COST_GAP_PCT before the first
 *   disc, and never past the band less half a pixel (the bake sets a
 *   full-size name at its rounded px, a hair over its fit);
 * - beside an inline cost: the band less the band gap and the cost row as
 *   the bake draws it (costRowWidthPct — discs, pip gaps, the hard shadow and
 *   whole-px rounding), so it is room the preview's narrower row leaves too;
 * - alone: the band. The bake draws no filler span in a measured title band
 *   with no inline cost (the preview never has one), so nothing takes a gap
 *   from it — a start-aligned name runs to the band's end like the print's.
 *
 * `cost` is the cost the band DRAWS (null/empty when it shows none).
 */
export function titleBandRoomPct(layout: TitleBandLayout, cost: string | null | undefined): number {
  const band = layout.title.rect;
  const drawn = cost?.trim() ? cost : null;
  const disc = layout.costSizePct ?? layout.title.sizePct;
  if (drawn && layout.costRect) {
    const pipsLeft = (layout.costRect.leftPct + layout.costRect.widthPct) / 100 - manaCostWidthPct(drawn, disc);
    return Math.min(band.widthPct / 100 - HALF_PX_PCT, pipsLeft - band.leftPct / 100 - DETACHED_COST_GAP_PCT);
  }
  if (drawn) return band.widthPct / 100 - BAND_GAP_PCT - costRowWidthPct(drawn, disc);
  return band.widthPct / 100;
}

/**
 * The name's text, width and size for both renderers — the front face's
 * title band and the adventure panel's.
 *
 * A slot without `fit: "measured"` keeps the old path exactly: before a
 * detached cost fitDetachedCostTitle, otherwise null (the slot's size, the
 * band's width, the CSS ellipsis).
 *
 * A measured slot (the M15-era family) always gets a fit. The name keeps its
 * slot's size while its measured width fits the room its band leaves it
 * (titleBandRoomPct), and otherwise shrinks only as far as that room needs,
 * down to the 5 pt floor of the card's orientation; only past the floor is
 * it cut, with a whole "…" placed here (pastFloorText — at the floor plus the
 * half pixel the bake may round it up by, measuredLinePx), never by a
 * renderer.
 * The cost never shrinks — a front face's pips stay the cost's size — so a
 * pathological cost leaves the name MIN_NAME_EM at the floor, at least.
 *
 * - Inline or no cost: measured by its advances × TITLE_FIT_HEADROOM (the
 *   pairs the browser kerns wider, the bake's whole px); `widthPct`, the
 *   span's max-width, is the room.
 * - Detached cost: measured by its advances alone — exactly the box the bake
 *   lays it out in (the preview kerns it tighter) — against the room to the
 *   pips, so a printed walker keeps full size where the print does.
 *   `widthPct`, the span's max-width in both renderers, allows
 *   TITLE_FIT_HEADROOM on top of that room, so neither renderer's ellipsis
 *   cuts a name the fit kept whole (the bake rounds the size to a whole px;
 *   the browser kerns a few pairs wider, 1.2 % at the worst public title).
 *
 * The bake sets a shrunk name at measuredLinePx (the whole px below its
 * fitted size, never below the floor's), as for the old detached fit.
 */
export function fitTitleBand(
  layout: TitleBandLayout,
  title: string,
  cost: string | null | undefined,
  orientation: CardOrientation = "portrait",
): DetachedCostTitle | null {
  const drawn = cost?.trim() ? cost : null;
  if (layout.title.fit !== "measured") return drawn ? fitDetachedCostTitle(layout, title, drawn) : null;
  const slot = layout.title;
  const name = title.trim();
  const metrics: Metrics = { letterSpacingEm: slot.letterSpacingEm, uppercase: slot.uppercase };
  const detached = Boolean(drawn && layout.costRect);
  const headroom = detached ? 1 : TITLE_FIT_HEADROOM;
  const measure = (s: string) => displayTextWidthEm(s, metrics) * headroom;
  const nameEm = measure(name);
  const floor = measuredLineFloorPct(orientation);
  // However long the cost, the name keeps a few letters at the floor — at
  // the floor's whole px in the bake (the half pixel it may round up by).
  const bandRoom = titleBandRoomPct(layout, drawn);
  const room = Math.max(bandRoom, Math.min(nameEm, MIN_NAME_EM) * (floor + HALF_PX_PCT));
  const sizePct = nameEm > 0 ? measuredLineSizePct(slot.sizePct, Math.max(0, bandRoom) / nameEm, orientation) : slot.sizePct;
  const text = pastFloorText(name, room, sizePct, orientation, measure);
  return { text, widthPct: detached ? room * TITLE_FIT_HEADROOM : room, sizePct };
}
