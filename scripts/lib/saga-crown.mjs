// ---------------------------------------------------------------------------
// The saga frame's legendary crown (template `saga`; TODO 4.6f, owner
// 2026-11-25) — the recipe, as DATA. scripts/build-saga-crown.mjs applies it;
// lib/cards/template-layout.ts (SAGA_CROWN) draws the result and a unit test
// holds the two key lists together.
//
// WHAT PRINT DOES (Scryfall 2026-11-25: `layout:saga frame:legendary`, four
// printings — DSK #75 The Tale of Tamiyo (u) with its prerelease and
// promo-pack stamps, and PH18 #4 The Legend of Arena, a three-colour gold
// saga; read at 1500 × 2100, nothing kept): the STANDARD 2015 legendary
// crown in the card's colour over the saga's title bar — Card Conjurer's
// saga group lists the M15 'Legend Crowns' for it, and the saga's Title mask
// IS M15's (m15MaskTitle; the masters' bar faces 104–210 px against M15's
// 104–208), so the m15crown band registers there as it does on m15: on DSK
// #75 and PH18 #4 the crown's top edge (x 200–1300) lies within 1 px of the
// band's, its ears' and arms' outer edges (rows 100–450) within 0–3 px. No
// two-colour saga was printed crowned.
//
// WHY A CUT OF ITS OWN: the saga masters are Card Conjurer's 'Regular Frames'
// saga pack, whose pinline beside the window and down the rail is that pack's
// other tone — the adventure pack's (r 239,56,39 against the band's
// 209,77,53; g 0,123,67 against 42,108,69; b 39,38,36 against 58,56,50;
// gold 246,210,98 against 233,212,125; w 252,254,255 against 244,243,236;
// blue's is the band's own, 0,117,190) — and the band's arms repaint that
// pinline down to row 408: drawn as published they end in a tone step and
// a jog there (on every key, blue's included: the right arm's inner face
// runs x 1390–1403 at row 400, the master's pinline 1385–1399). So, as the
// adventure frame's crown does for the same tones (TODO 4.6f's adventure
// family) and the Nyx Constellation crown before it (scripts/lib/
// nyx-crown.mjs, owner Round 59), the arms' last rows FADE OUT — alpha ×
// (1 − t), t running 0 → 1 from row `fade.from` to row `fade.to` — and the
// crown hands over to the master's own pinline. On the left the arm's foot
// lies over the top of the ribbon's fold (rows 300–408: the fold shows from
// under the arm as the arm narrows, as on DSK #75 and PH18 #4). Nothing else
// changes: every other pixel is the published band's, byte for byte, no
// colour is touched (the standard crowns are Card Conjurer's as they are,
// owner round 17), and the masters are not re-toned (their pinline is a
// correction of the frame, another step with its own before / after).
// ---------------------------------------------------------------------------

import { fadeNyxCrownBand, nyxCrownFade } from "./nyx-crown.mjs";
import { TWO_COLOR_PAIRS } from "./pair-ramp.mjs";

export const SAGA_CROWN_RECIPE = Object.freeze({
  /** The folder the bands are published under (`sagacrown/<key>.png`). */
  folder: "sagacrown",
  /** The published band each key is cut from (`m15crown/<key>.png`). */
  from: "m15crown",
  /** The saga masters' letters — w u b r g, m — the land crown `l`, which
   *  the profile maps the colourless key to (`saga/c` is the pack's 'Land
   *  Frame', as m15land maps its `c`), and the ten pairs (the pair masters,
   *  TODO 4.6f). */
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "l", ...TWO_COLOR_PAIRS]),
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
export function sagaCrownFade(y) {
  return nyxCrownFade(y, SAGA_CROWN_RECIPE.fade);
}

/**
 * Fade one published band's arms, in place (raw RGBA, 1500 × 410): the Nyx
 * Constellation crown's cut, with this recipe's rows and columns. Returns
 * what it did; throws when the band isn't the shape the recipe was measured
 * on (ink outside the arms' columns under `fade.from`).
 */
export function fadeSagaCrownBand(data) {
  return fadeNyxCrownBand(data, SAGA_CROWN_RECIPE);
}
