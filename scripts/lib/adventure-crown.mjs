// ---------------------------------------------------------------------------
// The adventure frame's legendary crown (template `adventure`; TODO 4.6f,
// owner 2026-11-22) — the recipe, as DATA. scripts/build-adventure-crown.mjs
// applies it; lib/cards/template-layout.ts (ADVENTURE_CROWN) draws the result
// and a unit test holds the two key lists together.
//
// WHAT PRINT DOES (Scryfall 2026-11-22: `layout:adventure frame:2015
// frame:legendary`, 58 printings; the plain black-bordered ones read at
// 1500 × 2100, nothing kept): the STANDARD 2015 legendary crown in the
// card's colour over the adventure frame's title bar — LCI #231 Kellan,
// Daring Traveler (w), HOB #34 Bilbo Baggins, Burglar (u), HOB #71 Gollum,
// Silent Slinker (b), WOE #230 Kellan, the Fae-Blooded (r), HOB #118 Beorn,
// Reluctant Host (g), WOE #220 Beluna Grandsquall (gold), HOB #170 The
// Arkenstone (a colourless artifact: the artifact silver), and the
// two-colour MKM #212 Kellan, Inquisitive Prodigy (G|U, the split crown
// over the gold-split frame) and HOB #166 Thranduil, Sindarin Liege (G|U
// over the hybrid frame).
//
// WHY A CUT OF ITS OWN: the adventure masters are Card Conjurer's 'Adventure'
// pack, drawn on the REGULAR M15 pack's geometry — the title bar's top
// outline on rows 100–103 as M15's, its bottom outline 1 px higher (rows
// 218–221 against 219–222), so the band registers as it does on m15 — but
// their pinline beside the art is that pack's other tone on six keys (r
// 239,56,39 against the band's 209,77,53; g 0,123,67 against 42,108,69; b
// 39,38,36 against 58,56,50; gold 246,210,98 against 233,212,125; w
// 252,254,255 against 244,243,236; the artifact silver 246,247,245 against
// 223,225,225). The band's arms repaint that pinline down to row 408: drawn
// as published they end in a tone step and a 1–2 px jog there. So, as the Nyx
// Constellation frame's crown does for the same tones (scripts/lib/
// nyx-crown.mjs, owner Round 59), the arms' last rows FADE OUT — alpha ×
// (1 − t), t running 0 → 1 from row `fade.from` to row `fade.to` — and the
// crown hands over to the master's own pinline. Nothing else changes: every
// other pixel is the published band's, byte for byte, no colour is touched
// (the standard crowns are Card Conjurer's as they are, owner round 17), and
// the masters are not re-toned (their pinline is a correction of the frame,
// another step with its own before / after).
// ---------------------------------------------------------------------------

import { fadeNyxCrownBand, nyxCrownFade } from "./nyx-crown.mjs";
import { TWO_COLOR_PAIRS } from "./pair-ramp.mjs";

export const ADVENTURE_CROWN_RECIPE = Object.freeze({
  /** The folder the bands are published under (`adventurecrown/<key>.png`). */
  folder: "adventurecrown",
  /** The published band each key is cut from (`m15crown/<key>.png`). */
  from: "m15crown",
  /** The adventure masters' letters — w u b r g, m — the artifact silver
   *  `a`, which the profile maps the colourless key to (`adventure/c` is
   *  the pack's artifact frame), and the ten pairs (the pair masters, TODO
   *  4.6f: MKM #212 prints the split crown). */
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a", ...TWO_COLOR_PAIRS]),
  width: 1500,
  rows: 410,
  /** The arms' fade: full strength on `from`, gone on `to` (and below) —
   *  the Nyx Constellation crown's rows. */
  fade: Object.freeze({ from: 372, to: 408 }),
  /** From `fade.from` down the band paints its two arms and nothing else:
   *  the build refuses a band with ink outside these columns there. */
  arms: Object.freeze({ left: Object.freeze([60, 125]), right: Object.freeze([1375, 1440]) }),
});

/** The factor a band row's alpha is multiplied by (1 above the fade). */
export function adventureCrownFade(y) {
  return nyxCrownFade(y, ADVENTURE_CROWN_RECIPE.fade);
}

/**
 * Fade one published band's arms, in place (raw RGBA, 1500 × 410): the Nyx
 * Constellation crown's cut, with this recipe's rows and columns. Returns
 * what it did; throws when the band isn't the shape the recipe was measured
 * on (ink outside the arms' columns under `fade.from`).
 */
export function fadeAdventureCrownBand(data) {
  return fadeNyxCrownBand(data, ADVENTURE_CROWN_RECIPE);
}
