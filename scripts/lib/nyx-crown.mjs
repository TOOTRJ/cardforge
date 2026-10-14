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
// ONE TINT (owner Round 59, 2026-10-14): the colourless master is a BRONZE
// drawing (its rim beside the art 172,148,132 — MSE's; no printed colourless
// constellation card) and the band it wears, the artifact silver `a`, a
// neutral 223,225,225: two metals on one card. So `a`'s metal is toned onto
// the master's bronze — `tint` below, through toneSourceRegions (the
// Universes Beyond tones' function: the colour multiplied by to ÷ from, the
// colour part of the gain fading out toward white so the bevel's highlights
// keep their hue instead of turning — the Vehicle plate's lesson). The
// starfield strip is NOT toned: every pixel where the Nyx band differs from
// the plain crown band of the same key (`m15crown/a`) stays the parent's
// byte — but for the strip's soft edge, which takes the share of the tone
// the crown shows through it (tintNyxCrownBand). Alpha untouched. The other
// six bands take no tint.
//
// The masters themselves are NOT re-cut here (their rim, and the 5–8 px the
// scans' title bar sits above ours, are a correction of the frame — another
// step, with its own before/after).
// ---------------------------------------------------------------------------

import { toneSourceRegions } from "./cc-frames.mjs";

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
  /** The tints, key → `{ plain, from, to }`: the band's metal toned from
   *  `from` (what the band's arm reads) to `to` (what the `nyx` master's rim
   *  reads beside the art), everywhere the band equals the published plain
   *  crown band `<plain>/<key>.png` — i.e. everywhere but the starfield
   *  strip. Only the colourless card's silver. */
  tint: Object.freeze({
    a: Object.freeze({ plain: "m15crown", from: Object.freeze([223, 225, 225]), to: Object.freeze([172, 148, 132]) }),
  }),
  /** The rows the starfield strip may occupy (measured: 50–101). */
  stripRows: Object.freeze([40, 110]),
  /** The strip's edge (see tintNyxCrownBand): how near metal a strip pixel
   *  is an edge pixel, how far its strip tone is sampled, and the least
   *  luminance the plain crown must have over that tone. */
  edge: Object.freeze({ reach: 2, sample: 3, minContrast: 24 }),
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

/** Rec. 709 luminance (toneSourceRegions'). */
const luma = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];

/**
 * Tone one band's metal onto its master's (raw RGBA, `width` × `rows`), the
 * starfield strip left alone. `plain` is the published plain crown band of
 * the same key (the crown with no strip over it):
 *   • METAL — a pixel whose four bytes equal the plain band's — takes the
 *     tone (toneSourceRegions, hue kept toward white);
 *   • the STRIP — every other pixel — is the parent's byte, but for its
 *     EDGE (a strip pixel within `edge.reach` px of metal): there the strip
 *     only part-covers the crown, so the pixel takes the part of the tone
 *     the crown shows through it, out = band + (toned plain − plain) × w,
 *     w = 1 − cover, cover = (L plain − L band) ÷ (L plain − L strip), L
 *     strip the darkest strip pixel within `edge.sample` px (0 … 1; w = 0
 *     where the plain crown is not at least `edge.minContrast` lighter than
 *     the strip). Without it the edge stays a silver hairline round the
 *     starfield.
 * Alpha is never touched. Returns a new buffer and what it did; throws when
 * the strip isn't where the recipe was measured (no differing pixel, or one
 * outside `stripRows`).
 */
export function tintNyxCrownBand(data, plain, tint, recipe = NYX_CONSTELLATION_CROWN_RECIPE) {
  const { width, rows, stripRows, edge } = recipe;
  const n = width * rows;
  if (data.length !== n * 4 || plain.length !== n * 4) throw new Error(`tintNyxCrownBand: expected two ${width}×${rows} RGBA bands`);
  const metal = new Uint8Array(n);
  let strip = 0;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (data[o] === plain[o] && data[o + 1] === plain[o + 1] && data[o + 2] === plain[o + 2] && data[o + 3] === plain[o + 3]) {
      metal[p] = 255;
      continue;
    }
    const y = Math.floor(p / width);
    if (y < stripRows[0] || y > stripRows[1]) throw new Error(`tintNyxCrownBand: the band differs from its plain crown at ${p % width},${y} — outside the strip's rows`);
    strip++;
  }
  if (strip === 0) throw new Error("tintNyxCrownBand: the band has no starfield strip (it equals the plain crown)");
  const tones = { metal: { from: [...tint.from], to: [...tint.to] } };
  const out = toneSourceRegions(data, width, rows, { metal }, tones);
  const tonedPlain = toneSourceRegions(plain, width, rows, { metal: new Uint8Array(n).fill(255) }, tones);
  let edged = 0;
  for (let y = stripRows[0]; y <= Math.min(rows - 1, stripRows[1]); y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (metal[p]) continue;
      let nearMetal = false;
      let darkest = Infinity;
      for (let dy = -edge.sample; dy <= edge.sample; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= rows) continue;
        for (let dx = -edge.sample; dx <= edge.sample; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (metal[q]) {
            if (Math.abs(dx) <= edge.reach && Math.abs(dy) <= edge.reach && data[q * 4 + 3] === 255) nearMetal = true;
          } else darkest = Math.min(darkest, luma(data, q * 4));
        }
      }
      if (!nearMetal) continue;
      const o = p * 4;
      const lPlain = luma(plain, o);
      if (lPlain - darkest < edge.minContrast) continue;
      const w = 1 - Math.min(1, Math.max(0, (lPlain - luma(data, o)) / (lPlain - darkest)));
      if (w <= 0) continue;
      let moved = false;
      for (let c = 0; c < 3; c++) {
        const v = Math.min(255, Math.max(0, Math.round(data[o + c] + (tonedPlain[o + c] - plain[o + c]) * w)));
        if (v !== out[o + c]) moved = true;
        out[o + c] = v;
      }
      if (moved) edged++;
    }
  }
  let changed = 0;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (out[o] !== data[o] || out[o + 1] !== data[o + 1] || out[o + 2] !== data[o + 2]) changed++;
  }
  return { out, changed, strip, edged };
}
