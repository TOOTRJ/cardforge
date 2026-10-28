// ---------------------------------------------------------------------------
// The Nyx Constellation frame (template `nyx`) on its prints — the RIM's
// tone (owner Round 59, decision 1; Round 61: the FAMILY's tones). A
// correction of a look against its own print: layout bump scoped to `nyx`,
// "sweep" (lib/cards/layout-version.ts). The importer applies it — the
// `masterPass` of CC_TEMPLATES.nyx (scripts/lib/cc-frames.mjs
// nyxShowcasePass, TODO 4.17f) — to Card Conjurer's 'Nyx Showcase' masters
// after the type bar / text box tone (scripts/lib/nyx-tone.mjs); the MSE
// masters it was first read off took the same pass.
//
// WHAT PRINT DOES — the eleven printings, THB #258–268, against the same
// cards' REGULAR printings (THB #9, #18, #45, #71, #93, #119, #125, #150,
// #185, #196, #220 — the Nyx dress, which our print-verified m15nyx masters
// draw), all Scryfall highres_scan PNGs read 2026-10-14 at their native
// 745 × 1040 (our masters downscaled with the same kernel; 1500 × 2100 px;
// nothing kept).
//   • COLOUR, registered per card the way positions are: a scan's colour is
//     the scan's, so the rim is read on the showcase scan AND on the same
//     card's regular scan, both sides, and the difference is laid on our
//     verified m15nyx rim — the M15 family's tone:
//
//       key  family rim     showcase − regular (median; per reading)   → registered
//       w    244,243,236    +1.5,+1.5,+1  (2,2,1 2,2,2 1,1,1 0,−1,−1)   246,245,237
//       u      0,117,190    +5,−2,−3      (−3,−3,−4 6,8,7 5,−2,−3)      5,115,187
//       b     58,56,50      −2.5,−4,−1    (−2,−2,−1 0,0,1 −3,−6,−2 −8,−8,−1) 56,52,49
//       r    209,77,53      −3,−2,−4      (3,2,−4 −4,−4,−3 −3,−2,−7)    206,75,49
//       g     42,108,69     0,−2,−7.5     (1,0,−3 1,−1,−5 −1,−3,−10 −6,−5,−11) 42,106,62
//
//     Every median is inside a single print's spread (one card to the next
//     moves a channel by up to 8–11): the constellation rim IS the family's
//     rim, so `to` is the family's tone itself — which is what the frame's
//     crown bands (nyxcrown/*, cut from the family's m15nyxcrown) already
//     are: crown and rim one tone, the bands untinted. Blue's family tone is
//     MSE's own: blue is not toned.
//   • GOLD has no print (THB's one two-colour card, #268, is red | green);
//     its rim is put on the gold crown band's own flat arm, 233,212,125, so
//     crown and rim match with no tint on the band (owner Round 61).
//   • Colourless `c` has no print and keeps MSE's bronze, which Round 59's
//     `a` crown band is toned to. The frame has no artifact key.
//   • GEOMETRY, registered the same way, is not changed: the rim's width is
//     print's (12.2 px, 11.1–13.6, against our 11.9) and the title bar's
//     "5–8 px low" is what every THB scan does to the verified M15 frame
//     (−0.9 px once registered). The MSE lower frame sits 4–6 px low (type
//     bar −5.2 / −3.7, box bottom −6.0; Card Conjurer's drawing is on
//     print): fixing it moves text — a later step (TODO.md).
//
// THE TONE: the rim is ONE flat colour in each master (`from`, read off the
// master), drawn over black outlines with anti-aliased edges. Every pixel
// within `reach` px of that flat colour whose colour is a mix of it and
// black (a projection p = t × from, residual under `residual`) is moved by
// t × (to − from): the flat rim lands on `to` exactly, an edge pixel keeps
// its coverage over the black (t × to), black stays black, and a pixel that
// mixes the rim with something else takes the share its residual allows. A
// flat colour has no bevel: there is no highlight whose hue could turn. No
// other region of a master changes.
// ---------------------------------------------------------------------------

/** The rim, key → `{ from, to }`: `from` the master's flat rim (exact), `to`
 *  the family's tone (see above; gold: the gold crown band's arm). Blue is
 *  absent — its family tone is MSE's — and so is colourless. */
export const NYX_RIM_TONES = Object.freeze({
  w: Object.freeze({ from: Object.freeze([252, 254, 255]), to: Object.freeze([244, 243, 236]) }),
  b: Object.freeze({ from: Object.freeze([39, 38, 36]), to: Object.freeze([58, 56, 50]) }),
  r: Object.freeze({ from: Object.freeze([239, 56, 39]), to: Object.freeze([209, 77, 53]) }),
  g: Object.freeze({ from: Object.freeze([0, 123, 67]), to: Object.freeze([42, 108, 69]) }),
  m: Object.freeze({ from: Object.freeze([246, 210, 98]), to: Object.freeze([233, 212, 125]) }),
  // Colourless (TODO 4.17f): the masters are Card Conjurer's 'Nyx Showcase'
  // now, whose colourless frame is its 'Artifact Frame' — a SILVER rim
  // (246,247,245) where MSE's `c` was bronze. No print is colourless; the
  // rim takes MSE's bronze, the tone the constellation crown's `a` band was
  // tinted to (Round 59), so crown and rim stay one metal.
  c: Object.freeze({ from: Object.freeze([246, 247, 245]), to: Object.freeze([172, 148, 132]) }),
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
