// Stat values — P/T, loyalty, defense — shrink to fit the face they print on
// (TODO 3.18), shared by the live preview (StatOverlay, the flip panel) and
// the Satori bake (StatBake, SecondFaceBake) so both pick the same size for
// the same value by construction. Card Conjurer's P/T is oneLine with shrink,
// MSE's `shrink-overflow`; ours used to print every value at the profile
// size, so `100/100` ran off the M15 plate and `*+1/*+1` across the Alpha
// pinstripe.
//
// A value keeps the profile's size EXACTLY while its ink stays on its face —
// the plate's light interior, the strip up to its pinstripe (the slot's
// `inkSpanPct`, else its rect) — in BOTH renderers, so every value that fits
// today bakes byte-identically; a wider one shrinks until it fits, down to the
// typography hard floor. The ink is modelled glyph by glyph from the metrics
// of the face the slot is set in (StatSlot.font — Beleren Bold unless a
// profile says otherwise; lib/cards/type-faces.ts), because the two
// renderers place it differently:
//   * Satori lays a value out at the sum of its advance widths (it measures
//     each grapheme on its own) and centres that box — kept at full width
//     (flexShrink: 0) even when it is wider than the rect — but DRAWS the
//     run with the font's kerning from the box's left edge, so the ink
//     starts where the unkerned box does and ends a kern-sum later (`40/40`
//     is 10 px narrower than its box at HD, all of it on the right).
//   * The browser kerns, and centres the kerned run.
// An average glyph width (fitSingleLineSizePct's 0.56 em) would shrink values
// that fit — `10/10` on the M15 plate — and pass ones that don't.

import { getFrameProfile, type Rect, type StatSlot } from "@/lib/cards/template-layout";
import {
  normalizeFrameTemplate,
  printsPowerToughness,
  showsDefense,
  showsLoyalty,
} from "@/lib/cards/card-display";
import { LINE_FACE_METRICS, type LineFaceMetrics } from "@/lib/cards/font-metrics";
import { typeFace, type SlotFace } from "@/lib/cards/type-faces";
import { RULES_TEXT, ptToPct, type CardOrientation } from "@/lib/cards/typography";
import type { CardType } from "@/types/card";

/** The face a value is measured in when its slot names none: the display
 *  face (lib/cards/type-faces.ts DEFAULT_SLOT_FACE). */
const DEFAULT_FACE: SlotFace = "display";

const metricsOf = (font: SlotFace | undefined) => typeFace(font ?? DEFAULT_FACE).metrics;

/** [advance width, left side bearing, right side bearing] (font units) of
 *  every glyph a stat is likely to hold — printable ASCII plus ½ ∞ − – — × —
 *  in the DISPLAY face (Beleren Bold, 2048 units per em). A bearing is the
 *  gap between the glyph's ink and its advance box (negative when the ink
 *  overhangs it, like `*`). Generated from public/fonts/Beleren-Bold.ttf
 *  (lib/cards/font-metrics.ts — by hand here until TODO 4.8.0);
 *  tests/unit/cards/stat-fit.test.ts re-reads the font and pins each entry.
 *  The fit reads the SLOT's face's table (StatSlot.font), not this one. */
export const STAT_GLYPHS: Readonly<Record<string, readonly [number, number, number]>> = LINE_FACE_METRICS.display.statGlyphs;

/** Beleren Bold's GPOS kerning (font units) between the characters stat
 *  values are made of — digits, + - * / X x ½ ∞ − – — × and the full stop —
 *  which both renderers apply when they draw a run. Pairs involving other
 *  letters are left out (a value like `A/B` is measured unkerned, a few px
 *  either way); the test pins this table against the font. Note the positive
 *  pairs (`1/`, `/7`, `77`, `34`, `54`): kerning can WIDEN a value. */
export const STAT_KERNING: Readonly<Record<string, number>> = LINE_FACE_METRICS.display.statKerning;

/** Any other character counts a full em with no bearings: wider than every
 *  glyph above but W, so an unexpected symbol errs toward shrinking. */
const glyph = (ch: string, face: LineFaceMetrics) => face.statGlyphs[ch] ?? ([face.unitsPerEm, 0, 0] as const);

/** A value's laid-out width in em — the sum of its advance widths, the box
 *  Satori centres (and wraps, when it is wider than the rect) — in the face
 *  named `font` (a StatSlot's; the display face when it names none). */
export function statWidthEm(value: string, font?: SlotFace): number {
  const face = metricsOf(font);
  let units = 0;
  for (const ch of value) units += glyph(ch, face)[0];
  return units / face.unitsPerEm;
}

/**
 * How far a value's ink reaches left and right of the centre of the box it
 * is centred in, in em — the further of the two renderers on each side.
 * Satori: box = advance sum A, ink from its left edge for the kerned run K.
 * Browser: box = K, centred. Both inset by the first/last glyph's bearing.
 * Measured in the face named `font` (a StatSlot's).
 */
export function statInkEm(value: string, font?: SlotFace): { left: number; right: number } {
  const face = metricsOf(font);
  const chars = Array.from(value);
  if (chars.length === 0) return { left: 0, right: 0 };
  let advance = 0;
  let kern = 0;
  chars.forEach((ch, i) => {
    advance += glyph(ch, face)[0];
    if (i > 0) kern += face.statKerning[chars[i - 1] + ch] ?? 0;
  });
  const lsb = glyph(chars[0], face)[1];
  const rsb = glyph(chars[chars.length - 1], face)[2];
  const kerned = advance + kern;
  const left = Math.max(advance / 2 - lsb, kerned / 2 - lsb);
  const right = Math.max(kerned - advance / 2 - rsb, kerned / 2 - rsb);
  return { left: left / face.unitsPerEm, right: right / face.unitsPerEm };
}

/** The x-range (fractions of the card's width) a slot's value may ink: the
 *  profile's measured `inkSpanPct`, else the value rect. */
export function statInkSpan(slot: StatSlot): { left: number; right: number } {
  if (slot.inkSpanPct) return { left: slot.inkSpanPct.leftPct / 100, right: slot.inkSpanPct.rightPct / 100 };
  return { left: slot.rect.leftPct / 100, right: (slot.rect.leftPct + slot.rect.widthPct) / 100 };
}

/**
 * The size a stat value prints at: the profile's `sizePct` when its ink fits
 * the slot's span at that size (returned as is — same bake bytes), otherwise
 * the largest size at which it fits, never below the hard floor. `upsideDown`
 * = the value is drawn rotated 180° (a flip card's second face), which
 * mirrors where each renderer's ink sits.
 */
export function fitStatSizePct(
  slot: StatSlot,
  value: string,
  orientation: CardOrientation = "portrait",
  upsideDown = false,
): number {
  const ink = statInkEm(value, slot.font);
  const [inkLeft, inkRight] = upsideDown ? [ink.right, ink.left] : [ink.left, ink.right];
  const span = statInkSpan(slot);
  const centre = (slot.rect.leftPct + slot.rect.widthPct / 2) / 100;
  // The profile's horizontal nudge moves the ink with the size (StatBake /
  // StatOverlay translate it by valueDxEm em; the second face has none).
  const dx = upsideDown ? 0 : (slot.valueDxEm ?? 0);
  const reachLeft = inkLeft - dx;
  const reachRight = inkRight + dx;
  const roomLeft = centre - span.left;
  const roomRight = span.right - centre;
  const fits = (size: number) => size * reachLeft <= roomLeft && size * reachRight <= roomRight;
  if (fits(slot.sizePct)) return slot.sizePct;
  let largest = slot.sizePct;
  if (reachLeft > 0) largest = Math.min(largest, roomLeft / reachLeft);
  if (reachRight > 0) largest = Math.min(largest, roomRight / reachRight);
  const floor = ptToPct(RULES_TEXT.hardFloorPt, orientation);
  return Math.min(slot.sizePct, Math.max(floor, largest));
}

/** The P/T string both renderers print: a missing side prints as an em dash. */
export function ptValue(power: string | null | undefined, toughness: string | null | undefined): string {
  return `${power ?? "—"}/${toughness ?? "—"}`;
}

/** The air a rules line keeps left of an end-aligned value's ink, in em of
 *  the value's size (a word gap's worth). */
export const END_ALIGNED_STAT_AIR_EM = 0.25;

/**
 * The footprint of a value drawn END-aligned in a plate-less slot — the
 * transform front's reverse P/T in its grey tab (DFC_REVERSE_PT, TODO 5.1a;
 * the rules FLOAT since 5.1d): the digits' ink against the slot's right
 * edge, over the slot's rows, in card percents. The width is the value's
 * laid-out width (statWidthEm: the sum of its advance widths — Satori's
 * box, the wider of the two renderers' runs) plus END_ALIGNED_STAT_AIR_EM
 * of air on the left, at the size the value prints at (fitStatSizePct: the
 * profile's unless the value is wider than the slot). Both renderers pass
 * it as DrawnStats.reversePt, only while the digits are drawn (the tab
 * prints empty otherwise, owner decision Q7); the rules lines whose rows
 * meet it break short of it (RulesLayoutInput.floats).
 */
export function endAlignedStatKeepOut(slot: StatSlot, value: string, orientation: CardOrientation = "portrait"): Rect {
  const sizePct = fitStatSizePct(slot, value, orientation);
  const widthPct = (statWidthEm(value, slot.font) + END_ALIGNED_STAT_AIR_EM) * sizePct * 100;
  const rightPct = slot.rect.leftPct + slot.rect.widthPct;
  return {
    leftPct: Math.max(slot.rect.leftPct, rightPct - widthPct),
    topPct: slot.rect.topPct,
    widthPct: Math.min(widthPct, slot.rect.widthPct),
    heightPct: slot.rect.heightPct,
  };
}

/** The `cards` columns the stat scope reads, as stored. Optional like
 *  lib/cards/layout-version.ts ScopeCard: `undefined` = not selected. */
export type StatScopeCard = {
  frame_style?: unknown;
  card_type?: string | null;
  subtypes?: readonly string[] | null;
  /** A token prints its P/T by its type words (TODO 3b.15). Not in
   *  STAT_SCOPE_COLUMNS: a row without it reads as no words — a token then
   *  prints any P/T it has, as every token did before the picker. */
  supertype?: string | null;
  power?: string | null;
  toughness?: string | null;
  loyalty?: string | null;
  defense?: string | null;
  /** The raw `back_face` jsonb — a flip card prints its P/T too. */
  back_face?: unknown;
};

const STAT_SCOPE_COLUMNS = [
  "frame_style", "card_type", "subtypes", "power", "toughness", "loyalty", "defense", "back_face",
] as const satisfies readonly (keyof StatScopeCard)[];

/** The stats the bake prints for a card row — the same show-rules as
 *  lib/render/card-image.tsx — with the slot each prints in. */
function printedStats(card: StatScopeCard) {
  const frameStyle = card.frame_style as { template?: unknown } | null | undefined;
  const template = normalizeFrameTemplate(typeof frameStyle?.template === "string" ? frameStyle.template : null);
  const layout = getFrameProfile(template);
  const cardType = (card.card_type ?? null) as CardType | null;
  const stats: { slot: StatSlot; value: string; upsideDown: boolean }[] = [];
  const printsPT = printsPowerToughness({
    cardType,
    subtypes: card.subtypes,
    supertype: card.supertype,
    power: card.power,
    toughness: card.toughness,
  });
  if (layout.pt && printsPT) stats.push({ slot: layout.pt, value: ptValue(card.power, card.toughness), upsideDown: false });
  if (layout.loyalty && showsLoyalty(cardType) && card.loyalty) stats.push({ slot: layout.loyalty, value: card.loyalty, upsideDown: false });
  if (layout.defense && showsDefense(cardType) && card.defense) stats.push({ slot: layout.defense, value: card.defense, upsideDown: false });
  const back = card.back_face as { power?: string | null; toughness?: string | null } | null | undefined;
  if (layout.secondFace?.pt && back && (back.power || back.toughness)) {
    stats.push({
      slot: layout.secondFace.pt,
      value: ptValue(back.power, back.toughness),
      upsideDown: layout.secondFace.rotation === 180,
    });
  }
  return { template, landscape: layout.orientation === "landscape", printsPT, stats };
}

/**
 * True when shrink-to-fit changes this card's stored (HD) bake: a printed
 * stat whose ink runs past its span at the profile size shrinks. Judged on
 * the template the card is DRAWN on, with the committed profiles — it
 * assumes no stat-slot frame_profile_overrides (production has none).
 */
export function statsShrink(card: StatScopeCard): boolean {
  const { landscape, stats } = printedStats(card);
  const orientation: CardOrientation = landscape ? "landscape" : "portrait";
  return stats.some(({ slot, value, upsideDown }) => fitStatSizePct(slot, value, orientation, upsideDown) < slot.sizePct);
}

/**
 * The layout-version scope of this change: true when a card's stored HD bake
 * differs from the one made before it. Three ways:
 *   * a printed stat shrinks (statsShrink);
 *   * a printed stat is wider than its rect at the HD size: Satori used to
 *     squeeze its box to the rect, so a value with a break (`X/X+1`) wrapped
 *     after its slash and one without (`40/40` on M15) ran off the rect's
 *     right edge only; it now prints on one line, centred like the preview;
 *   * a Draconic (tarkirdraconic) card that prints a P/T: new plate and ink.
 * A column that wasn't selected (`undefined`) can't be judged → true.
 */
export function statLayoutChanged(card: StatScopeCard): boolean {
  if (STAT_SCOPE_COLUMNS.some((column) => card[column] === undefined)) return true;
  const { template, landscape, printsPT, stats } = printedStats(card);
  if (template === "tarkirdraconic" && printsPT) return true;
  const orientation: CardOrientation = landscape ? "landscape" : "portrait";
  const hdWidth = landscape ? 2100 : 1500;
  return stats.some(
    ({ slot, value, upsideDown }) =>
      fitStatSizePct(slot, value, orientation, upsideDown) < slot.sizePct ||
      statWidthEm(value, slot.font) * Math.round(slot.sizePct * hdWidth) > (slot.rect.widthPct / 100) * hdWidth,
  );
}
