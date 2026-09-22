import { BRAND, MANA_HEX } from "@/lib/brand/constants";
import type { ColorIdentity } from "@/types/card";

// cards.color_identity stores identity WORDS ("white", …, "multicolor");
// MANA_HEX is keyed by letter. The composite used to test the words against
// the letter keys, so every card's accent came out colorless grey.
const IDENTITY_LETTER: Partial<Record<ColorIdentity, keyof typeof MANA_HEX>> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};

/** Discord's embed accent bar (theme-color) + the social composite's accent
 *  line: the card's mana color, gold for multicolor, neutral for colorless.
 *  Accepts letters too, for callers that already hold WUBRG. */
export function cardAccentColor(colorIdentity: readonly string[]): string {
  if (colorIdentity.includes("multicolor")) return BRAND.gold;
  const letters = colorIdentity
    .map((c) =>
      c in MANA_HEX ? (c as keyof typeof MANA_HEX) : IDENTITY_LETTER[c as ColorIdentity],
    )
    .filter((c): c is keyof typeof MANA_HEX => Boolean(c) && c !== "C");
  if (letters.length === 1) return MANA_HEX[letters[0]];
  if (letters.length > 1) return BRAND.gold;
  return MANA_HEX.C;
}
