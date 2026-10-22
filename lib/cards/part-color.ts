// ---------------------------------------------------------------------------
// Each part in its own colour (TODO 4.26; docs/FRAMES.md "Each part in its
// own colour").
//
// A two-part card prints its SECOND part in that part's own colour: split's
// right half and aftermath's lower part are their colour's master past a
// hard seam (FrameProfile.partColorSeam — components/cards/frame-layer.tsx
// partColorSplitFor), and the Prepare spell's page is its colour's page (a
// `partPage` overlay slot — lib/cards/anatomy.ts partPageKeyOf). The second
// part's colour is card data, `back_face.color_identity` (absent or empty:
// the card's own colour), and the look is an ADDITION, opt-in per card:
// drawn only with `frame_style.partColor === true` — a new card starts on,
// an import follows its printing (on, its parts' colours from their costs),
// and a card stored before it keeps its look until its owner switches it on
// (owner rule 2026-09-29: no sweep, no badge).
//
// This module is the colour's DEFAULT: what a part's cost says, the one
// rule the import and the creator's follow share. Pure and client-safe.
// ---------------------------------------------------------------------------

import { canonicalColorSequence } from "@/lib/cards/mana-order";
import { frameAnatomyOf, pairColorIdentity, twoColorFromCost, type TwoColorPair } from "@/lib/cards/anatomy";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

const LETTER_WORD: Record<string, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

/** The WUBRG letters a cost's coloured pips name, in WUBRG order: {W} → W,
 *  a hybrid {W/U} both, a twobrid {2/W} and a Phyrexian {W/P} their one
 *  colour; generic, {X}, {C} and {S} none. */
function costLetters(cost: string | null | undefined): string[] {
  const letters = new Set<string>();
  for (const [, inner] of (cost ?? "").matchAll(/\{([^{}]+)\}/g)) {
    for (const part of inner.toUpperCase().split("/")) {
      const letter = part.trim();
      if (letter in LETTER_WORD) letters.add(letter);
    }
  }
  return "WUBRG".split("").filter((l) => letters.has(l));
}

/**
 * A part's colour as its cost says (the default the import stores and the
 * creator fills): one colour → that colour; two → the PAIR in printed order
 * (a pair page or seam's two colours — the dress follows the cost: an
 * all-hybrid cost the hybrid's, else the gold-split); three or more →
 * ["multicolor"] (gold); none (a colourless or cost-less part) → [] — the
 * part prints in the card's own colour.
 */
export function partColorFromCost(cost: string | null | undefined): ColorIdentity[] {
  const letters = costLetters(cost);
  if (letters.length === 0) return [];
  if (letters.length === 1) return [LETTER_WORD[letters[0]!]!];
  if (letters.length === 2) {
    const pair = twoColorFromCost(cost) as TwoColorPair | null;
    if (pair) return pairColorIdentity(pair);
    const ordered = canonicalColorSequence(letters);
    return ordered.split("").map((l) => LETTER_WORD[l]!);
  }
  return ["multicolor"];
}

/** True when `template` draws a second part in its own colour (a seam or a
 *  page) — where the creator offers the switch and the second part's
 *  colour row. */
export function drawsPartColor(template: FrameTemplate | string | null | undefined): boolean {
  return frameAnatomyOf(template).partColor === true;
}

/** Two identities name the same colour (order-free). */
export function samePartColor(a: readonly ColorIdentity[] | null | undefined, b: readonly ColorIdentity[] | null | undefined): boolean {
  const x = [...(a ?? [])].sort().join(",");
  const y = [...(b ?? [])].sort().join(",");
  return x === y;
}
