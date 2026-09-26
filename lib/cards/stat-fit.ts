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
// typography hard floor. The ink is modelled glyph by glyph from Beleren
// Bold's metrics, because the two renderers place it differently:
//   * Satori lays a value out at the sum of its advance widths (it measures
//     each grapheme on its own) and centres that box — kept at full width
//     (flexShrink: 0) even when it is wider than the rect — but DRAWS the
//     run with the font's kerning from the box's left edge, so the ink
//     starts where the unkerned box does and ends a kern-sum later (`40/40`
//     is 10 px narrower than its box at HD, all of it on the right).
//   * The browser kerns, and centres the kerned run.
// An average glyph width (fitSingleLineSizePct's 0.56 em) would shrink values
// that fit — `10/10` on the M15 plate — and pass ones that don't.

import { getFrameProfile, type StatSlot } from "@/lib/cards/template-layout";
import {
  normalizeFrameTemplate,
  showsDefense,
  showsLoyalty,
  showsPowerToughness,
} from "@/lib/cards/card-display";
import { RULES_TEXT, ptToPct, type CardOrientation } from "@/lib/cards/typography";
import type { CardType } from "@/types/card";

/** Units per em of public/fonts/Beleren-Bold.ttf (the CardDisplay face). */
const UNITS_PER_EM = 2048;

/** [advance width, left side bearing, right side bearing] (font units) of
 *  every glyph a stat is likely to hold: printable ASCII plus ½ ∞ − – — ×.
 *  A bearing is the gap between the glyph's ink and its advance box (negative
 *  when the ink overhangs it, like `*`). Read from public/fonts/
 *  Beleren-Bold.ttf; tests/unit/cards/stat-fit.test.ts re-reads the font and
 *  pins each entry. */
export const STAT_GLYPHS: Readonly<Record<string, readonly [number, number, number]>> = {
  " ": [491, 0, 0], "!": [606, 102, 102], "\"": [829, 102, 102], "#": [1269, 123, 122], "$": [927, 82, 71], "%": [1761, 72, 71],
  "&": [1290, 72, 30], "'": [440, 102, 102], "(": [710, 113, 51], ")": [710, 51, 112], "*": [1113, -70, -65], "+": [1269, 154, 153],
  ",": [565, 82, 82], "-": [1071, 72, 72], ".": [565, 82, 82], "/": [847, 51, 50], "0": [1269, 92, 91], "1": [921, 102, 102],
  "2": [1073, 20, 112], "3": [1013, 41, 91], "4": [1165, 20, 82], "5": [1073, 102, 92], "6": [1204, 92, 112], "7": [1011, 51, 20],
  "8": [1220, 92, 92], "9": [1204, 113, 92], ":": [565, 82, 82], ";": [565, 82, 82], "<": [1269, 154, 153], "=": [1269, 154, 153],
  ">": [1269, 154, 153], "?": [1097, 61, 143], "@": [1597, 72, 71], "A": [1308, -31, -31], "B": [1230, 92, 61], "C": [1212, 92, 71],
  "D": [1427, 92, 92], "E": [1112, 92, 82], "F": [1003, 92, 10], "G": [1411, 92, 133], "H": [1443, 92, 91], "I": [716, 92, 91],
  "J": [727, -51, 92], "K": [1351, 92, -271], "L": [1034, 92, 20], "M": [1720, 92, 92], "N": [1382, 51, 92], "O": [1470, 92, 92],
  "P": [1208, 92, 20], "Q": [1470, 92, -285], "R": [1300, 92, -322], "S": [1042, 72, 61], "T": [1126, 20, 20], "U": [1320, 72, 50],
  "V": [1228, -20, -21], "W": [1843, -20, -21], "X": [1327, 0, -19], "Y": [1228, -20, -21], "Z": [1079, 45, 55], "[": [710, 113, 51],
  "\\": [727, 20, -39], "]": [710, 51, 112], "^": [1269, 168, 167], "_": [1024, -31, -31], "`": [819, 43, 168], "a": [1046, 51, 20],
  "b": [1208, 0, 61], "c": [1007, 61, 40], "d": [1198, 61, 154], "e": [1044, 61, 51], "f": [757, 31, -93], "g": [1024, 51, 0],
  "h": [1218, 0, 30], "i": [604, 41, 41], "j": [604, 41, 100], "k": [1128, -10, -41], "l": [604, 2, 31], "m": [1712, 51, 31],
  "n": [1220, 51, 30], "o": [1159, 61, 61], "p": [1208, 51, 61], "q": [1187, 61, 143], "r": [870, 51, 10], "s": [829, 72, 71],
  "t": [768, 31, 31], "u": [1208, 51, 30], "v": [1044, -10, -11], "w": [1515, -10, -11], "x": [1116, 10, 10], "y": [1044, -10, -11],
  "z": [937, 31, 40], "{": [710, 55, 51], "|": [614, 205, 204], "}": [710, 51, 55], "~": [1269, 162, 161], "½": [1632, 51, 102],
  "∞": [1650, 99, 99], "−": [1311, 106, 103], "–": [1374, 72, 71], "—": [1701, 72, 71], "×": [1269, 158, 157],
};

/** Beleren Bold's GPOS kerning (font units) between the characters stat
 *  values are made of — digits, + - * / X x ½ ∞ − – — × and the full stop —
 *  which both renderers apply when they draw a run. Pairs involving other
 *  letters are left out (a value like `A/B` is measured unkerned, a few px
 *  either way); the test pins this table against the font. Note the positive
 *  pairs (`1/`, `/7`, `77`, `34`, `54`): kerning can WIDEN a value. */
export const STAT_KERNING: Readonly<Record<string, number>> = {
  "-1": -180, "-2": -315, "-3": -134, "-7": -315, "-9": -90, "-X": -202, "-x": -180, ".0": -112,
  ".4": -134, ".7": -90, "/4": -271, "/5": -90, "/6": -202, "/7": 158, "0.": -112, "03": -44,
  "1-": -90, "1/": 90, "14": -112, "17": -44, "19": -112, "1–": -90, "1—": -90, "24": -44,
  "34": 68, "41": -44, "42": -90, "43": -68, "45": -112, "46": -90, "47": -44, "49": -180,
  "52": -44, "54": 68, "59": -112, "6.": -90, "61": -44, "62": -134, "63": -44, "65": -112,
  "67": -202, "69": -293, "7-": -44, "7.": -315, "7/": -271, "74": -224, "76": -90, "77": 224,
  "78": -44, "7–": -44, "7—": -44, "82": -90, "89": -90, "9.": -134, "9/": -202, "92": -112,
  "93": -68, "X-": -112, "X–": -112, "X—": -112, "x-": -202, "x–": -202, "x—": -202, "–1": -180,
  "–2": -315, "–3": -134, "–7": -315, "–9": -90, "–X": -202, "–x": -180, "—1": -180, "—2": -315,
  "—3": -134, "—7": -315, "—9": -90, "—X": -202, "—x": -180,
};

/** Any other character counts a full em with no bearings: wider than every
 *  glyph above but W, so an unexpected symbol errs toward shrinking. */
const FALLBACK_GLYPH = [UNITS_PER_EM, 0, 0] as const;

const glyph = (ch: string) => STAT_GLYPHS[ch] ?? FALLBACK_GLYPH;

/** The drawn defense badge's inset inside its rect (the Battle disc), in
 *  percent of the rect — both renderers draw it from these numbers. */
export const STAT_BADGE_INSET = { xPct: 12, yPct: 8 } as const;

/** A value's laid-out width in em — the sum of its advance widths, the box
 *  Satori centres (and wraps, when it is wider than the rect). */
export function statWidthEm(value: string): number {
  let units = 0;
  for (const ch of value) units += glyph(ch)[0];
  return units / UNITS_PER_EM;
}

/**
 * How far a value's ink reaches left and right of the centre of the box it
 * is centred in, in em — the further of the two renderers on each side.
 * Satori: box = advance sum A, ink from its left edge for the kerned run K.
 * Browser: box = K, centred. Both inset by the first/last glyph's bearing.
 */
export function statInkEm(value: string): { left: number; right: number } {
  const chars = Array.from(value);
  if (chars.length === 0) return { left: 0, right: 0 };
  let advance = 0;
  let kern = 0;
  chars.forEach((ch, i) => {
    advance += glyph(ch)[0];
    if (i > 0) kern += STAT_KERNING[chars[i - 1] + ch] ?? 0;
  });
  const lsb = glyph(chars[0])[1];
  const rsb = glyph(chars[chars.length - 1])[2];
  const kerned = advance + kern;
  const left = Math.max(advance / 2 - lsb, kerned / 2 - lsb);
  const right = Math.max(kerned - advance / 2 - rsb, kerned / 2 - rsb);
  return { left: left / UNITS_PER_EM, right: right / UNITS_PER_EM };
}

/** The x-range (fractions of the card's width) a slot's value may ink: the
 *  profile's measured `inkSpanPct`, else the value rect — or the drawn badge
 *  inside it. */
export function statInkSpan(slot: StatSlot): { left: number; right: number } {
  if (slot.inkSpanPct) return { left: slot.inkSpanPct.leftPct / 100, right: slot.inkSpanPct.rightPct / 100 };
  const inset = !slot.plateAssetPathTemplate && slot.badgeColorHex ? (slot.rect.widthPct * STAT_BADGE_INSET.xPct) / 100 : 0;
  return { left: (slot.rect.leftPct + inset) / 100, right: (slot.rect.leftPct + slot.rect.widthPct - inset) / 100 };
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
  const ink = statInkEm(value);
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

/** The `cards` columns the stat scope reads, as stored. Optional like
 *  lib/cards/layout-version.ts ScopeCard: `undefined` = not selected. */
export type StatScopeCard = {
  frame_style?: unknown;
  card_type?: string | null;
  subtypes?: readonly string[] | null;
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
  const printsPT = showsPowerToughness(cardType, card.subtypes) && Boolean(card.power || card.toughness);
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
      statWidthEm(value) * Math.round(slot.sizePct * hdWidth) > (slot.rect.widthPct / 100) * hdWidth,
  );
}
