// ---------------------------------------------------------------------------
// The Nyx Constellation frame's legendary crown (template `nyx`; owner
// 2026-10-13) — the recipe, as DATA. scripts/build-nyx-crown.mjs applies it;
// lib/cards/template-layout.ts (NYX_CONSTELLATION_CROWN) draws the result and
// a unit test holds the two key lists together.
//
// WHAT PRINT DOES (the eleven Theros Beyond Death constellation showcase
// cards, THB #258–268 — every one legendary; measured 2026-10-13 from
// Scryfall's 745 × 1040 scans scaled to 1500 × 2100, nothing kept): the
// STANDARD 2015 legendary crown in the card's colour — the same scallops,
// wings and arms as FDN's, its top edge on row 51–53 at x = 600 — with the
// Nyx starfield strip inside it, between the arch and the title bar (rows
// 60–92). Not one dark or silver crown: white prints it silver, blue blue,
// black dark grey, red red, green green, and the one two-colour card (#268
// Klothys) red | green over a gold bar. That is the piece Card Conjurer's
// own 'Nyx Showcase' pack (packM15NyxShowcase.js) lists beside its crownless
// masters — the M15 crown with the 'Inner Crown (Nyx)' — and it is the band
// the Nyx dress already publishes: `m15nyxcrown/<key>` (scripts/lib/
// cc-frames.mjs NYX_INNER_CROWN).
//
// WHAT THIS RECIPE ADDS: the `nyx` masters are Magic Set Editor's, and their
// side rim beside the art is 3 px narrower than the prints' and the crown's
// (10 px, x 101–110, against 13, x 98–110; mirrored on the right: 1389–1399
// against 1391–1402), and in another tone on four keys (green 0,124,67
// against the prints' 47,108,69 and the crown's 42,108,69; black 39 against
// 56 / 58; red 241,56,39 against 213,57,23 / 209,77,53). The band's arms end
// on row 408: drawn as published they stop in a 3 px jog and a tone step.
// So the arms' last rows FADE OUT — alpha × (1 − t), t running 0 → 1 from
// row `fade.from` to row `fade.to` — and the crown hands over to the
// master's own rim. Nothing else of the band changes: every other pixel is
// the published band's, byte for byte, and no colour is touched (the
// standard crowns are Card Conjurer's as they are, owner round 17).
//
// The masters themselves are NOT re-cut here (their rim, and the 5–8 px the
// scans' title bar sits above ours, are a correction of the frame — another
// step, with its own before/after).
// ---------------------------------------------------------------------------

export const NYX_CONSTELLATION_CROWN_RECIPE = Object.freeze({
  /** The folder the bands are published under (`nyxcrown/<key>.png`). */
  folder: "nyxcrown",
  /** The published band each key is cut from (`m15nyxcrown/<key>.png`). */
  from: "m15nyxcrown",
  /** The `nyx` masters' letters — w u b r g, m — and the artifact silver
   *  `a`, which the profile maps the colourless key to (as m15nyx does).
   *  No pairs: the frame draws no pair masters (a two-colour card is gold). */
  keys: Object.freeze(["w", "u", "b", "r", "g", "m", "a"]),
  width: 1500,
  rows: 410,
  /** The arms' fade: full strength on `from`, gone on `to` (and below). */
  fade: Object.freeze({ from: 372, to: 408 }),
  /** From `fade.from` down the band paints its two arms and nothing else:
   *  the build refuses a band with ink outside these columns there. */
  arms: Object.freeze({ left: Object.freeze([60, 125]), right: Object.freeze([1375, 1440]) }),
});

/** The factor a band row's alpha is multiplied by (1 above the fade). */
export function nyxCrownFade(y, fade = NYX_CONSTELLATION_CROWN_RECIPE.fade) {
  if (y <= fade.from) return 1;
  if (y >= fade.to) return 0;
  return 1 - (y - fade.from) / (fade.to - fade.from);
}

/**
 * Fade one published band's arms, in place (raw RGBA, `width` × `rows`).
 * Returns what it did; throws when the band isn't the shape the recipe was
 * measured on (ink outside the arms' columns under `fade.from`).
 */
export function fadeNyxCrownBand(data, recipe = NYX_CONSTELLATION_CROWN_RECIPE) {
  const { width, rows, fade, arms } = recipe;
  if (data.length !== width * rows * 4) throw new Error(`fadeNyxCrownBand: ${data.length} bytes, expected ${width}×${rows} RGBA`);
  let changed = 0;
  for (let y = fade.from; y < rows; y++) {
    const k = nyxCrownFade(y, fade);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4 + 3;
      const a = data[o];
      if (a === 0) continue;
      const inArm = (x >= arms.left[0] && x <= arms.left[1]) || (x >= arms.right[0] && x <= arms.right[1]);
      if (!inArm) throw new Error(`fadeNyxCrownBand: ink at ${x},${y} (alpha ${a}) outside the arms — not the band the recipe was measured on`);
      const next = Math.round(a * k);
      if (next !== a) {
        data[o] = next;
        changed++;
      }
    }
  }
  return { changed };
}
