// ---------------------------------------------------------------------------
// The full-art token's Nyx dress (TODO 4.51) — the recipe, as DATA.
// scripts/build-token-nyx.mjs applies it; lib/cards/template-layout.ts
// (the m20tokennyx… profiles) draws the result and a unit test holds the two
// key lists together.
//
// WHAT PRINT DOES (the six M20+ Nyx token printings, Scryfall PNGs scaled to
// 1500 × 2100, measured 2026-10-17 over the name pill's interior rows
// 118–202, x 130–1370 with the name's columns 420–1080 left out):
//
//   TDSK #4 Glimmer (W, textless)          166/161/154   specks 5.0 %
//   TSOC #3 Contract (W, regular box)      175/173/164           3.1 %
//   TDSK #10 Horror (B, textless)           42/38/46             7.9 %
//   TMDD #8 Spirit Sorcerer (U, regular)    20/85/127           18.1 %
//   SLD #1835 Shrine (C, textless)         124/125/124          17.6 %
//   TEOC #13 Golem (C artifact, textless)   74/80/96            12.0 %
//
// (a speck: a pixel 45 luma over the region's median). The starfield is in
// the NAME PILL only — the type pill, the box, the rims and the strip are the
// plain design's (TDSK #2 Shard, a plain Shard from the same set: 0 % specks
// in its pill). The pill keeps its colour: the black pill stays black with
// stars, the blue one blue, the colourless one grey, the artifact one slate —
// but the WHITE pill prints a mid silver (≈ 170) where the plain white pill
// is near-white (our master 236/237/238), so its tone moves with the dress.
//
// WHAT THIS RECIPE DOES (PipGlyph's own composite; no Card Conjurer file is
// read and no scan is kept): on each published full-art token master
// (m20token…/<key>, frames bucket), inside the name pill's flat interior —
//
//   • the REGION: the hole of the published crown band m20tokencrown/w (the
//     pill's interior: the band is α 0 there, the importer checks it —
//     M20_TOKEN_PILL_HOLE) that is connected to the pill's centre, weighted
//     by the published m20token/w master's own alpha — full at α ≤ 230 (the
//     pill's translucent face), none from 244 (its bevel, rims and outline,
//     which keep the master's pixels), linear between. The same region on
//     every template and key: Card Conjurer's three token packs share the
//     name pill, and the textless re-cut moves rows 1687–1844 only;
//   • the STARFIELD: the luminance of the starfield inside the title bar of
//     the Nyx Constellation master public/frames/nyx/b.png (Magic Set
//     Editor's magic-m15-showcase-theros-constellation, in git), at the
//     same pixel — that bar sits where the token's pill sits (its face rows
//     112–212, x 94–1396) — centred on its median over the region (a
//     neutral layer: the stars and the nebula's light, no colour of its own);
//   • the TONE: out = P + offset + k × (S − median S), per channel, where P
//     is the master's pixel and the offset is solved per key so the region's
//     median, read over mid-grey art as the prints were (the pill is
//     translucent), lands on print's (`targets`, above; keys with no print
//     keep their own median). An offset, not a gain: the pill keeps its own
//     shading, and a channel near 0 (the blue pill's red) can still move.
//     `k` is fitted to the prints' spread: their median p95 − p50 is ≈ 52
//     luma, the starfield's 19.
//
// Alpha is never touched; outside the region every byte is the published
// master's. Two-colour pairs are not built: no two-colour Nyx token is
// printed (a two-colour card on the dress wears gold, `m`).
// ---------------------------------------------------------------------------

export const TOKEN_NYX_RECIPE = Object.freeze({
  /** The published full-art templates and their Nyx dress, plain then
   *  artifact, by height. */
  templates: Object.freeze({
    m20tokennyx: "m20token",
    m20tokennyxtext: "m20tokentext",
    m20tokennyxtall: "m20tokentall",
    m20tokenartifactnyx: "m20tokenartifact",
    m20tokenartifactnyxtext: "m20tokenartifacttext",
    m20tokenartifactnyxtall: "m20tokenartifacttall",
  }),
  keys: Object.freeze(["w", "u", "b", "r", "g", "c", "m"]),
  width: 1500,
  height: 2100,
  /** The published band whose hole is the pill's interior, and the seed. */
  hole: Object.freeze({ band: "m20tokencrown/w", seed: Object.freeze([750, 160]), rows: Object.freeze([95, 225]) }),
  /** The published master whose alpha weighs the region (#576's convention). */
  alpha: Object.freeze({ master: "m20token/w", full: 230, none: 244 }),
  /** The starfield: the MSE constellation master in git, its title bar. */
  starfield: "public/frames/nyx/b.png",
  /** The starfield's weight on the master (fitted: print spread ÷ starfield). */
  k: 2.7,
  /** Print's pill medians (rgb) per key — `plain` for the plain templates,
   *  `artifact` for the slate pill every artifact key shares. null = no
   *  print: the master keeps its own median. */
  targets: Object.freeze({
    plain: Object.freeze({
      w: Object.freeze([170.5, 167, 159]),
      u: Object.freeze([20, 85, 127]),
      b: Object.freeze([42, 38, 46]),
      c: Object.freeze([124, 125, 124]),
      r: null,
      g: null,
      m: null,
    }),
    artifact: Object.freeze([74, 80, 96]),
  }),
  /** The window the prints' medians were read in (and the offsets are
   *  solved in): the pill's face rows, the name's columns left out. */
  measure: Object.freeze({ rows: Object.freeze([118, 202]), x: Object.freeze([130, 1370]), skipX: Object.freeze([420, 1080]) }),
  /** The prints each target is read from. */
  targetPrints: Object.freeze({
    w: "TDSK #4 Glimmer, TSOC #3 Contract (mean)",
    u: "TMDD #8 Spirit Sorcerer",
    b: "TDSK #10 Horror",
    c: "SLD #1835 Shrine",
    artifact: "TEOC #13 Golem",
  }),
});

/** True for the artifact templates. */
export const isArtifactNyx = (template) => template.includes("artifact");

/**
 * The region's weight per pixel (Float32Array, width × height): the crown
 * band's α-0 hole connected to the seed, × the master's alpha weight.
 * `band` is the band's raw RGBA (width × its rows), `master` the reference
 * master's raw RGBA (width × height).
 */
export function tokenNyxRegion(band, bandRows, master, recipe = TOKEN_NYX_RECIPE) {
  const { width: W, height: H, hole, alpha } = recipe;
  const inHole = new Uint8Array(W * bandRows);
  const [sx, sy] = hole.seed;
  if (band[(sy * W + sx) * 4 + 3] !== 0) throw new Error("tokenNyxRegion: the band is not clear at the seed");
  const stack = [sy * W + sx];
  inHole[sy * W + sx] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % W;
    const y = Math.floor(p / W);
    if (y < hole.rows[0] || y > hole.rows[1]) throw new Error(`tokenNyxRegion: the hole leaks to row ${y}`);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || xx >= W || yy < 0 || yy >= bandRows) continue;
      const q = yy * W + xx;
      if (inHole[q] || band[q * 4 + 3] !== 0) continue;
      inHole[q] = 1;
      stack.push(q);
    }
  }
  const weight = new Float32Array(W * H);
  let count = 0;
  for (let p = 0; p < W * bandRows; p++) {
    if (!inHole[p]) continue;
    const a = master[p * 4 + 3];
    const w = a <= alpha.full ? 1 : a >= alpha.none ? 0 : (alpha.none - a) / (alpha.none - alpha.full);
    if (w > 0) {
      weight[p] = w;
      count++;
    }
  }
  return { weight, count };
}

const luma = (d, o) => 0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2];

/** The neutral starfield layer over the region: luminance − its median. */
export function tokenNyxStarfield(stars, starsChannels, weight, recipe = TOKEN_NYX_RECIPE) {
  const { width: W, height: H } = recipe;
  const layer = new Float32Array(W * H);
  const values = [];
  for (let p = 0; p < W * H; p++) {
    if (weight[p] <= 0) continue;
    const l = luma(stars, p * starsChannels);
    layer[p] = l;
    values.push(l);
  }
  values.sort((a, b) => a - b);
  const median = values[values.length >> 1];
  for (let p = 0; p < W * H; p++) if (weight[p] > 0) layer[p] -= median;
  return { layer, median };
}

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** What a pixel reads over mid-grey art (the pill is translucent: α 230 on
 *  the plain templates) — how the prints' medians were read. */
const seen = (v, a) => (v * a + recipeGrey * (255 - a)) / 255;
const recipeGrey = 128;

/** The median, over the full-weight pixels of the window the prints were
 *  read in (`measure`; every `step`-th column), of fn(p, value) for channel
 *  c as seen over mid-grey. */
function regionMedian(data, weight, c, fn, step = 1, recipe = TOKEN_NYX_RECIPE) {
  const { width: W, measure } = recipe;
  const values = [];
  for (let y = measure.rows[0]; y <= measure.rows[1]; y++) {
    for (let x = measure.x[0]; x <= measure.x[1]; x += step) {
      if (x > measure.skipX[0] && x < measure.skipX[1]) continue;
      const p = y * W + x;
      if (weight[p] >= 1) values.push(seen(fn(p, data[p * 4 + c]), data[p * 4 + 3]));
    }
  }
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/**
 * Dress one master (raw RGBA, width × height), returning a new buffer and
 * the per-channel offsets used: dressed = P + offset + k × starfield, the
 * offset solved so the region's median — as it reads over mid-grey art —
 * is print's `target` (rgb); no offset when `target` is null (no print:
 * the starfield alone). An offset (not a gain) keeps the pill's own shading and works on a
 * channel near 0 (the blue pill's red).
 */
export function dressTokenNyx(master, weight, layer, target, recipe = TOKEN_NYX_RECIPE) {
  const { k } = recipe;
  const offsets = [0, 0, 0];
  for (let c = 0; c < 3 && target; c++) {
    const want = target[c];
    let lo = -255;
    let hi = 255;
    for (let i = 0; i < 24; i++) {
      const d = (lo + hi) / 2;
      const m = regionMedian(master, weight, c, (p, v) => clamp(v + d + k * layer[p]), 3);
      if (m < want) lo = d;
      else hi = d;
    }
    offsets[c] = (lo + hi) / 2;
  }
  const out = Buffer.from(master);
  let changed = 0;
  for (let p = 0; p < weight.length; p++) {
    const w = weight[p];
    if (w <= 0) continue;
    const o = p * 4;
    let moved = false;
    for (let c = 0; c < 3; c++) {
      const v = master[o + c];
      const dressed = clamp(v + offsets[c] + k * layer[p]);
      const next = Math.round(v + (dressed - v) * w);
      if (next !== v) moved = true;
      out[o + c] = next;
    }
    if (moved) changed++;
  }
  return { out, offsets, changed };
}
