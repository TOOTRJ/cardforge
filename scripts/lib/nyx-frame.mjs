// ---------------------------------------------------------------------------
// The Nyx Constellation frame (template `nyx`) corrected onto its prints —
// the RIM's tone (owner Round 59, decision 1: "correct the nyx frame itself
// against print"). A correction of a look against its own print: layout
// bump scoped to `nyx`, "sweep" (lib/cards/layout-version.ts).
// scripts/build-variation-frames.mjs applies it to the MSE masters after
// the type bar / text box tone (scripts/lib/nyx-tone.mjs), and
// scripts/build-nyx-crown.mjs brings the crown bands onto the same tones.
//
// WHAT PRINT DOES — the eleven printings, THB #258–268 (Scryfall's
// highres_scan PNGs, 745 × 1040, read 2026-10-14 at that native size; our
// masters downscaled with the same kernel; reported in 1500 × 2100 px;
// nothing kept). Positions are registered PER CARD: each showcase scan is
// read against our master, and the same card's REGULAR printing (THB #9,
// #18, #45, #71, #93, #119, #125, #150, #185, #196, #220 — the Nyx dress)
// against our print-verified m15nyx master; the second offset (what
// Scryfall's scan of that card does to a frame we know is right) is taken
// off the first.
//   • The rim is a flat colour in print as in our masters. Its tone — the
//     median of the side rims' plateau beside the art, both sides, every
//     print of the colour (4, 3, 4, 3, 4 readings) — is `to` below. #268
//     Klothys (red | green) reads 223,58,24 and 50,110,69: the same.
//   • The rim's WIDTH is the prints': 12.2 px (11.1–13.6) against our 11.9
//     (both read by one detector at one resolution). Not re-cut.
//   • The title bar sits where the regular printing's does once registered
//     (−0.9 px, median of 11): the "5–8 px low" against the raw scans is
//     what every THB scan does to the verified M15 frame too (−5.6).
//   • NOT corrected here (it moves text — reported to the owner): the MSE
//     masters' lower frame sits LOW against print — the type bar's top
//     −5.2, its bottom −3.7, the text box's bottom −6.0 px (median of 11,
//     registered); Card Conjurer's 'Nyx Showcase' drawing sits on print
//     there (−0.2, +1.8, +2.1).
//
// THE TONE: the rim is ONE flat colour in each master (`from`, read off the
// master), drawn over black outlines with anti-aliased edges. Every pixel
// within `reach` px of that flat colour whose colour is a mix of it and
// black (a projection p = t × from, residual under `residual`) is moved by
// t × (to − from): the flat rim lands on `to` exactly, an edge pixel keeps
// its coverage over the black (t × to), black stays black, and a pixel that
// mixes the rim with something else takes the share its residual allows.
// No other region of a master changes. A flat colour has no bevel, so there
// is no highlight to keep the hue of; the crown band (which has one) is
// toned by `shiftTone`, the same move faded out toward white.
//
// NOT PRINTED: gold `m` (THB prints its one two-colour card red | green)
// and colourless `c` (no colourless constellation card) keep MSE's rims —
// nothing to derive them from; the frame has no artifact key (a colourless
// card is `c`, whose crown is Round 59's bronze-toned `a`).
// ---------------------------------------------------------------------------

/** Rec. 709 luminance. */
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The rim, key → `{ from, to }`: `from` the master's flat rim (exact),
 *  `to` the prints' (see above). */
export const NYX_RIM_TONES = Object.freeze({
  w: Object.freeze({ from: Object.freeze([252, 254, 255]), to: Object.freeze([238, 236, 240]) }),
  u: Object.freeze({ from: Object.freeze([0, 117, 190]), to: Object.freeze([10, 93, 193]) }),
  b: Object.freeze({ from: Object.freeze([39, 38, 36]), to: Object.freeze([62, 57, 54]) }),
  r: Object.freeze({ from: Object.freeze([239, 56, 39]), to: Object.freeze([220, 59, 22]) }),
  g: Object.freeze({ from: Object.freeze([0, 123, 67]), to: Object.freeze([45, 107, 71]) }),
});

/** How the rim region is found: `flat` = the most a channel may differ from
 *  `from` and still be the flat rim; `reach` = how far (px) an edge pixel
 *  may be from it; `residual` = the colour distance at which an edge
    pixel stops being a rim / black mix (its weight falls to 0 there);
 *  `minPiece` = the least connected piece of the flat colour that is rim. */
export const NYX_RIM_REGION = Object.freeze({ flat: 2, reach: 2, residual: 48, minPiece: 2000 });

/**
 * The rim's region on one master (raw RGBA, width × height): weight 0–255
 * per pixel, and the coverage `t` of the rim in it (t × from + black).
 */
export function nyxRimMask(data, width, height, from, region = NYX_RIM_REGION) {
  const n = width * height;
  const isFlat = new Uint8Array(n);
  let flat = 0;
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (data[o + 3] === 255 && Math.abs(data[o] - from[0]) <= region.flat && Math.abs(data[o + 1] - from[1]) <= region.flat && Math.abs(data[o + 2] - from[2]) <= region.flat) {
      isFlat[p] = 1;
      flat++;
    }
  }
  // The rim is one drawn line round the frame: a flat-coloured speck that
  // is not part of a large piece of it (a star of white's field is the
  // white rim's colour) is not the rim.
  const seen = new Uint8Array(n);
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (!isFlat[s] || seen[s]) continue;
    const comp = [];
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      const x = p % width;
      const y = (p - x) / width;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          const q = yy * width + xx;
          if (isFlat[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
    }
    if (comp.length < region.minPiece) {
      for (const p of comp) isFlat[p] = 0;
      flat -= comp.length;
    }
  }
  // Near the flat rim: a separable max filter of radius `reach`.
  const R = region.reach;
  const rowNear = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let hit = 0;
      for (let dx = -R; dx <= R && !hit; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < width && isFlat[y * width + xx]) hit = 1;
      }
      rowNear[y * width + x] = hit;
    }
  }
  const mask = new Uint8Array(n);
  const cover = new Float32Array(n);
  const ff = from[0] * from[0] + from[1] * from[1] + from[2] * from[2];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (isFlat[p]) {
        mask[p] = 255;
        cover[p] = 1;
        continue;
      }
      let near = 0;
      for (let dy = -R; dy <= R && !near; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < height && rowNear[yy * width + x]) near = 1;
      }
      if (!near) continue;
      const o = p * 4;
      if (data[o + 3] === 0) continue;
      const t = Math.min(1, Math.max(0, (data[o] * from[0] + data[o + 1] * from[1] + data[o + 2] * from[2]) / ff));
      const res = Math.hypot(data[o] - t * from[0], data[o + 1] - t * from[1], data[o + 2] - t * from[2]);
      const w = Math.max(0, 1 - res / region.residual);
      if (w <= 0) continue;
      mask[p] = Math.round(w * 255);
      cover[p] = t;
    }
  }
  return { mask, cover, flat };
}

/**
 * Tone one master's rim onto the prints, in place (see the header). Returns
 * what it did; throws when the master holds too little of `from` (not the
 * MSE master the recipe was read off, or already toned).
 */
export function toneNyxRim(data, width, height, tone, { minFlat = 50_000, region = NYX_RIM_REGION } = {}) {
  const { mask, cover, flat } = nyxRimMask(data, width, height, tone.from, region);
  if (flat < minFlat) throw new Error(`toneNyxRim: only ${flat} px of the rim's ${tone.from.join(",")} (want ≥ ${minFlat}) — not the master the recipe was read off, or already toned`);
  let changed = 0;
  for (let p = 0; p < width * height; p++) {
    if (!mask[p]) continue;
    const o = p * 4;
    const k = (mask[p] / 255) * cover[p];
    let moved = false;
    for (let c = 0; c < 3; c++) {
      const v = Math.min(255, Math.max(0, Math.round(data[o + c] + k * (tone.to[c] - tone.from[c]))));
      if (v !== data[o + c]) moved = true;
      data[o + c] = v;
    }
    if (moved) changed++;
  }
  return { changed, flat };
}

/**
 * One pixel moved from `from` toward `to`, for a SHADED piece (the crown
 * band's bevels): by (to − from) × t, t = luma(p) ÷ luma(from) up to 1 (a
 * darker bevel moves less, black not at all), and above `from`'s
 * luminance faded out toward white ((255 − luma(p)) ÷ (255 − luma(from))),
 * so a highlight stays a highlight instead of taking the colour. A pixel at
 * `from` lands on `to` exactly. Unlike a per-channel gain it can lift a
 * channel that is 0 (blue's red, green's red).
 */
export function shiftTone(r, g, b, from, to) {
  const lf = luma(...from);
  const lp = luma(r, g, b);
  let k = lf > 0 ? Math.min(1, lp / lf) : 1;
  if (lp > lf) k = Math.max(0, Math.min(1, (255 - lp) / Math.max(1, 255 - lf)));
  return [r, g, b].map((v, c) => Math.min(255, Math.max(0, Math.round(v + k * (to[c] - from[c])))));
}
