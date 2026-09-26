// Stat values — P/T, loyalty, defense — shrink to fit their box (TODO 3.18),
// shared by the live preview (StatOverlay, the flip panel) and the Satori
// bake (StatBake, SecondFaceBake) so both pick the same size for the same
// value by construction. Card Conjurer's P/T is oneLine with shrink, MSE's
// `shrink-overflow`; ours used to print every value at the profile size, so
// `100/100` ran off the M15 plate and `*+1/*+1` across the Alpha pinstripe.
//
// Unlike the title/type fit (fitSingleLineSizePct's 0.56 em average), a stat
// is measured with Beleren Bold's real advance widths: a value is a handful
// of glyphs whose widths vary 2:1 ('1' 0.45 em, '0' 0.62 em), and an average
// would shrink `10/10` on the M15 plate, which fits. The sum is exactly the
// width Satori lays the value out at (it measures each grapheme on its own,
// without kerning); the browser kerns, which narrows these values by a hair.
//
// A value that fits keeps the profile's size EXACTLY, so its bake is byte-
// identical to one made before shrink-to-fit existed; a wider one shrinks
// until it fits, down to the typography hard floor.

import {
  getFrameProfile,
  type StatSlot,
} from "@/lib/cards/template-layout";
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

/** Advance widths (font units) of every glyph a stat is likely to hold:
 *  printable ASCII plus ½ ∞ − – — ×. Read from public/fonts/Beleren-Bold.ttf;
 *  tests/unit/cards/stat-fit.test.ts re-reads the font and pins each entry. */
export const STAT_ADVANCES: Readonly<Record<string, number>> = {
  " ": 491, "!": 606, "\"": 829, "#": 1269, "$": 927, "%": 1761, "&": 1290, "'": 440,
  "(": 710, ")": 710, "*": 1113, "+": 1269, ",": 565, "-": 1071, ".": 565, "/": 847,
  "0": 1269, "1": 921, "2": 1073, "3": 1013, "4": 1165, "5": 1073, "6": 1204, "7": 1011,
  "8": 1220, "9": 1204, ":": 565, ";": 565, "<": 1269, "=": 1269, ">": 1269, "?": 1097,
  "@": 1597, "A": 1308, "B": 1230, "C": 1212, "D": 1427, "E": 1112, "F": 1003, "G": 1411,
  "H": 1443, "I": 716, "J": 727, "K": 1351, "L": 1034, "M": 1720, "N": 1382, "O": 1470,
  "P": 1208, "Q": 1470, "R": 1300, "S": 1042, "T": 1126, "U": 1320, "V": 1228, "W": 1843,
  "X": 1327, "Y": 1228, "Z": 1079, "[": 710, "\\": 727, "]": 710, "^": 1269, "_": 1024,
  "`": 819, "a": 1046, "b": 1208, "c": 1007, "d": 1198, "e": 1044, "f": 757, "g": 1024,
  "h": 1218, "i": 604, "j": 604, "k": 1128, "l": 604, "m": 1712, "n": 1220, "o": 1159,
  "p": 1208, "q": 1187, "r": 870, "s": 829, "t": 768, "u": 1208, "v": 1044, "w": 1515,
  "x": 1116, "y": 1044, "z": 937, "{": 710, "|": 614, "}": 710, "~": 1269,
  "½": 1632, "∞": 1650, "−": 1311, "–": 1374, "—": 1701, "×": 1269,
};

/** Any other character counts a full em: wider than every glyph above but
 *  W, so an unexpected symbol errs toward shrinking, never overflowing. */
const FALLBACK_ADVANCE = UNITS_PER_EM;

/** The drawn defense badge's inset inside its rect (the Battle disc), in
 *  percent of the rect — both renderers draw it from these numbers. */
export const STAT_BADGE_INSET = { xPct: 12, yPct: 8 } as const;

/** A value's width in em at any size (sum of advance widths, no kerning). */
export function statWidthEm(value: string): number {
  let units = 0;
  for (const ch of value) units += STAT_ADVANCES[ch] ?? FALLBACK_ADVANCE;
  return units / UNITS_PER_EM;
}

/** The width a slot's value may use, as a fraction of the card's width: the
 *  value rect (or the profile's narrower `fitWidthPct`), or the drawn badge
 *  inside it — the value centres in all three. */
export function statFitWidth(slot: StatSlot): number {
  const width = Math.min(slot.rect.widthPct, slot.fitWidthPct ?? Infinity) / 100;
  const badge = !slot.plateAssetPathTemplate && slot.badgeColorHex;
  return badge ? width * (1 - (2 * STAT_BADGE_INSET.xPct) / 100) : width;
}

/**
 * The size a stat value prints at: the profile's `sizePct` when the value
 * fits its box at that size (returned as is — same bake bytes), otherwise
 * the size that just fits it, never below the hard floor.
 */
export function fitStatSizePct(
  slot: StatSlot,
  value: string,
  orientation: CardOrientation = "portrait",
): number {
  const widthEm = statWidthEm(value);
  if (widthEm * slot.sizePct <= statFitWidth(slot)) return slot.sizePct;
  const floor = ptToPct(RULES_TEXT.hardFloorPt, orientation);
  return Math.min(slot.sizePct, Math.max(floor, statFitWidth(slot) / widthEm));
}

/** The P/T string both renderers print: a missing side prints as an em dash. */
export function ptValue(power: string | null | undefined, toughness: string | null | undefined): string {
  return `${power ?? "—"}/${toughness ?? "—"}`;
}

/** The card-row fields `statsShrink` reads — the `cards` columns as stored. */
export type StatScopeCard = {
  frame_style: unknown;
  card_type: string | null;
  subtypes: readonly string[] | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  /** The raw `back_face` jsonb — a flip card prints its P/T too. */
  back_face: unknown;
};

/**
 * True when shrink-to-fit changes this card's bake: some stat the bake
 * prints is wider than its box at the profile size (judged on the template
 * the card is DRAWN on, with the committed profiles — production has no
 * frame_profile_overrides). Every other card bakes byte-identically.
 */
export function statsShrink(card: StatScopeCard): boolean {
  const frameStyle = card.frame_style as { template?: unknown } | null;
  const template = normalizeFrameTemplate(
    typeof frameStyle?.template === "string" ? frameStyle.template : null,
  );
  const layout = getFrameProfile(template);
  const orientation: CardOrientation = layout.orientation === "landscape" ? "landscape" : "portrait";
  const cardType = card.card_type as CardType | null;
  const shrinks = (slot: StatSlot | undefined, value: string) =>
    Boolean(slot) && fitStatSizePct(slot!, value, orientation) < slot!.sizePct;
  // The same show-rules as the bake (lib/render/card-image.tsx).
  if (showsPowerToughness(cardType, card.subtypes) && (card.power || card.toughness)) {
    if (shrinks(layout.pt, ptValue(card.power, card.toughness))) return true;
  }
  if (showsLoyalty(cardType) && card.loyalty && shrinks(layout.loyalty, card.loyalty)) return true;
  if (showsDefense(cardType) && card.defense && shrinks(layout.defense, card.defense)) return true;
  const back = card.back_face as { power?: string | null; toughness?: string | null } | null;
  if (layout.secondFace?.pt && back && (back.power || back.toughness)) {
    if (shrinks(layout.secondFace.pt, ptValue(back.power, back.toughness))) return true;
  }
  return false;
}
