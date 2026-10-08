// ---------------------------------------------------------------------------
// seventh-1997.mjs — the 1997 frame's recipes (TODO 4.10a, layout v46): Card
// Conjurer's "Seventh Edition" drawing RE-CUT edge by edge and TONED region
// by region onto the ORIGINAL cards of 1996–2003 (Mirage → Scourge; owner
// decision 2026-10-07: the originals, not the 2021+ reprints the pack's
// colours are). The steps are scripts/lib/print-cut.mjs; this file is the
// DATA and the drawing's regions. No scan is read by the build: every number
// below was read off the prints once (the era design's proof 1, re-measured
// for 4.10a) and is recorded in lib/cards/frame-sources.json.
//
// Why each piece (proof 1, 2026-10-07):
//   - the pack's eight masters share ONE geometry, 5 px right of the prints'
//     centre with a text box 8–9 px short; the prints' outer frame and art
//     window are shared by every colour, their TEXT BOXES are not (blue's top
//     is 6.6 px lower than white's, red's bottom 6.5 px higher, green's plank
//     24 px narrower …) — so the cut is per key (SEVENTH_TEXT_BOX);
//   - regions come from the DRAWING'S OWN LINES, not the pack's masks: its
//     Pinline mask is the land's coloured rings (not the bevels) and its
//     Trim mask starts 2 px outside the text box's line (toned through it,
//     that sliver of frame body reads as a pale halo). Green's plank and
//     black's parchment have no outlined box: theirs is cut by colour;
//   - the tone is mean-and-contrast in the frame body and the text box, a
//     per-channel gain per side of each bevel (print-cut.mjs toneRegions).
//
// Units: px of the 1500 × 2100 master.
// ---------------------------------------------------------------------------

import {
  blurPlane,
  cutMaps,
  lumaPlane,
  medianIn,
  planeToBytes,
  recutPlane,
  rectPlane,
  ringSidePlanes,
} from "./print-cut.mjs";

const W = 1500;
const H = 2100;

/** Where each structural edge sits in Card Conjurer's Seventh drawing (read
 *  from the PNGs; the same in all its keys): the outer frame, the art
 *  window, the text box's drawn line. */
export const SEVENTH_EDGES = Object.freeze({
  "outer-L": 79.5,
  "art-L": 181,
  "art-R": 1329,
  "outer-R": 1430,
  "text-L": 158.5,
  "text-R": 1347,
  "outer-T": 82.5,
  "art-T": 210,
  "art-B": 1136,
  "text-T": 1253.5,
  "text-B": 1862,
  "outer-B": 2017,
});

/** Where the same edges sit on the WHITE prints (21 sets, Mirage 1996 →
 *  Scourge 2003, the median of an edge correlation per print): the drawing's
 *  edge + the print's offset from it. Outer frame and art window are every
 *  colour's; the text box is white's (SEVENTH_TEXT_BOX moves it per key). */
export const PRINT_EDGES_1997 = Object.freeze({
  "outer-L": 72.97,
  "art-L": 174.88,
  "art-R": 1326.32,
  "outer-R": 1426.45,
  "text-L": 153.5,
  "text-R": 1347.38,
  "outer-T": 81.54,
  "art-T": 208.18,
  "art-B": 1136.2,
  "text-T": 1251.02,
  "text-B": 1871.04,
  "outer-B": 2019.07,
});

/** Each key's text box against the white prints' box (L, R, T, B; print
 *  minus the white-cut drawing), read two ways that agree to about 1 px (an
 *  edge correlation against the toned drawing; the box's extent by colour).
 *  `a` = the artifact frame, `l` = the plain land; `wl` … `gl` = the basic
 *  lands' coloured boxes (4.10a: six prints each, Mirage → Onslaught). */
export const SEVENTH_TEXT_BOX = Object.freeze({
  w: [0, 0, 0, 0],
  u: [0, 2.7, 6.6, 0],
  b: [-2.9, 5.5, 0, 0],
  r: [1.5, -4.2, 3.1, -6.5],
  g: [8.2, -16.0, 5.5, 0.8],
  a: [3.6, -2.0, 2.7, -7.0],
  l: [-3.2, 3.2, 4.5, -9.8],
  wl: [-0.7, 1.3, 4.5, -9.8],
  ul: [-3.2, 3.2, 4.5, -9.8],
  bl: [-3.2, 4.8, 4.5, -8.1],
  rl: [-1.4, 3.2, 4.5, -9.8],
  gl: [-3.2, 3.2, 4.5, -8.1],
  // The gold-box stand-in land (retroland/m, never ticked): the plain land's.
  ml: [-3.2, 3.2, 4.5, -9.8],
});

/** The gold frame's box against white's (the MSE master is cut onto it:
 *  retroGoldCut). */
export const GOLD_TEXT_BOX = Object.freeze([0, -2.4, 5.2, -3.1]);

/** The type band's rows on the prints: the column maps of the art rows and
 *  the text-box rows are lerped across it. */
export const SEVENTH_LERP_ROWS = Object.freeze([1172, 1244]);

const Y_EDGES = ["outer-T", "art-T", "art-B", "text-T", "text-B", "outer-B"];
const X_UPPER = ["outer-L", "art-L", "art-R", "outer-R"];
const X_LOWER = ["outer-L", "text-L", "text-R", "outer-R"];

/** Where a key's edges land: the white prints', the text box moved by the
 *  key's own offsets. */
export function printEdgesFor(box) {
  const [l, r, t, b] = box;
  return {
    ...PRINT_EDGES_1997,
    "text-L": PRINT_EDGES_1997["text-L"] + l,
    "text-R": PRINT_EDGES_1997["text-R"] + r,
    "text-T": PRINT_EDGES_1997["text-T"] + t,
    "text-B": PRINT_EDGES_1997["text-B"] + b,
  };
}

const round2 = (v) => Math.round(v * 100) / 100;

/** A re-cut (print-cut.mjs cutMaps' input) from a source's edges onto a
 *  target's. */
export function cutBetween(from, to) {
  const pairs = (names) => names.map((n) => [from[n], round2(to[n])]);
  return { y: pairs(Y_EDGES), xUpper: pairs(X_UPPER), xLower: pairs(X_LOWER), lerpRows: [...SEVENTH_LERP_ROWS] };
}

/** The re-cut of Card Conjurer's Seventh drawing for a key of
 *  SEVENTH_TEXT_BOX. */
export function seventhCut(key) {
  const box = SEVENTH_TEXT_BOX[key];
  if (!box) throw new Error(`seventhCut: no text box measured for ${key}`);
  return cutBetween(SEVENTH_EDGES, printEdgesFor(box));
}

// --- the gold frame: today's MSE artwork, cut onto the same edges ----------

/** Where the edges sit in the MSE gold master (magic-old mcard.jpg at
 *  1500 × 2100, scripts/frame-inputs/retro-m-mse.png): the art window read
 *  from its alpha (182–1319.5 × 210.5–1137), the outer frame and the text
 *  box by the same edge correlation as the prints', against Card Conjurer's
 *  gold drawing (whose edges are SEVENTH_EDGES). Checked on the cut master
 *  against 8 gold prints: outer frame and text box within 1.2 px by
 *  correlation (2.1 px RMS over all twelve edges). Card Conjurer's gold
 *  failed the eye in proof 1 (less fine detail than MSE's, twice the
 *  prints' contrast, violet bevels), so gold keeps MSE's artwork — cut edge
 *  by edge so its window, frame box and text box agree with the other
 *  seven keys (one scale per axis leaves its art bottom 4 px off). Its art
 *  RING stays the MSE drawing's: the gold prints' bevel is narrower (ring
 *  lines up to 4.8 px off), and the window was put on the shared one. */
export const MSE_GOLD_EDGES = Object.freeze({
  "outer-L": 75.6,
  "art-L": 182,
  "art-R": 1319.5,
  "outer-R": 1422.62,
  "text-L": 154.5,
  "text-R": 1340.34,
  "outer-T": 79.02,
  "art-T": 210.5,
  "art-B": 1137,
  "text-T": 1258.07,
  "text-B": 1874.33,
  "outer-B": 2022.33,
});

/** The MSE gold master's re-cut. */
export function retroGoldCut() {
  return cutBetween(MSE_GOLD_EDGES, printEdgesFor(GOLD_TEXT_BOX));
}

// --- the drawing's regions ---------------------------------------------------

// Rectangles [x0, y0, x1, y1) in the DRAWING's px.
const FRAME_BOX = [80, 83, 1430, 2017]; // the frame, from its outer line
const INSIDE_OUTER_BEVEL = [91, 94, 1419, 2006];
const ART_BEVEL_OUTER = [159, 188, 1351, 1158]; // the art bevel ring: its outer line …
const ART_WINDOW = [181, 210, 1329, 1136]; // … to the window
const TRIM_OUTER = [158, 1253, 1348, 1863]; // the text box's ring FROM THE DRAWN LINE (the pack's Trim mask starts 2 px outside it)
const TEXT_INNER = [176, 1271, 1330, 1845]; // the text box inside its ring

/** Keys whose text box has no drawn outline (green's plank, black's
 *  parchment): the box is what is box-coloured, and there is no trim ring. */
export const SEVENTH_BOX_BY_COLOUR = Object.freeze(["g", "b"]);

/** The rows and columns the by-colour box may lie in (the re-cut image). */
const BOX_ZONE = [110, 1205, 1395, 1915];
/** Where the box's own luma and the frame body's are read (medians). */
const BOX_SAMPLE = [500, 1450, 1000, 1650];
const BODY_SAMPLE = [500, 1178, 1000, 1232];

/** The regions in the drawing's own px, before any re-cut: body, text, and
 *  the four sides each of the outer bevel, the art bevel and the text box's
 *  trim. */
export function seventhDrawnRegions() {
  const body = rectPlane(INSIDE_OUTER_BEVEL, W, H);
  const art = rectPlane(ART_BEVEL_OUTER, W, H);
  const trim = rectPlane(TRIM_OUTER, W, H);
  for (let i = 0; i < body.length; i += 1) body[i] *= (1 - art[i]) * (1 - trim[i]);
  const regions = { body, text: rectPlane(TEXT_INNER, W, H) };
  for (const [name, outer, inner] of [
    ["obevel", FRAME_BOX, INSIDE_OUTER_BEVEL],
    ["abevel", ART_BEVEL_OUTER, ART_WINDOW],
    ["trim", TRIM_OUTER, TEXT_INNER],
  ]) {
    for (const [side, plane] of Object.entries(ringSidePlanes(outer, inner, W, H))) regions[`${name}${side}`] = plane;
  }
  return regions;
}

/**
 * A key's regions on its RE-CUT image (bytes, name → coverage): the drawn
 * regions moved with the same maps; for a key in SEVENTH_BOX_BY_COLOUR the
 * text box cut by colour out of body + text + trim (a smoothstep on the
 * blurred luma between the frame body's and the box's own, inside BOX_ZONE)
 * and no trim; with `rings` (the pack's Pinline mask as a 0 … 1 plane in the
 * drawing's px: a land's coloured rings) the rings are their own region
 * `pin`, taken out of every other.
 */
export function seventhRegions(recut, maps, { byColour = false, rings = null } = {}) {
  const drawn = seventhDrawnRegions();
  const R = Object.fromEntries(Object.entries(drawn).map(([name, plane]) => [name, recutPlane(plane, maps)]));
  const n = W * H;
  if (byColour) {
    const L = blurPlane(lumaPlane(recut, W, H), W, H, 1.5);
    const box = medianIn(L, W, BOX_SAMPLE);
    const body = medianIn(L, W, BODY_SAMPLE);
    const text = new Float32Array(n);
    const rest = new Float32Array(n);
    for (let y = 0; y < H; y += 1) {
      const inRows = y >= BOX_ZONE[1] && y < BOX_ZONE[3];
      for (let x = 0; x < W; x += 1) {
        const p = y * W + x;
        const frame = Math.min(1, R.body[p] + R.text[p] + R.trimL[p] + R.trimT[p] + R.trimR[p] + R.trimB[p]);
        if (frame === 0) continue;
        let s = 0;
        if (inRows && x >= BOX_ZONE[0] && x < BOX_ZONE[2]) {
          s = Math.min(1, Math.max(0, (L[p] - body) / (box - body)));
          s = Math.min(1, Math.max(0, (s - 0.3) / 0.4));
          s = s * s * (3 - 2 * s);
        }
        text[p] = s * frame;
        rest[p] = (1 - s) * frame;
      }
    }
    for (const side of ["L", "T", "R", "B"]) delete R[`trim${side}`];
    R.text = text;
    R.body = rest;
  }
  if (rings) {
    const pin = recutPlane(rings, maps);
    for (const plane of Object.values(R)) for (let p = 0; p < n; p += 1) plane[p] *= 1 - pin[p];
    R.pin = pin;
  }
  return Object.fromEntries(Object.entries(R).map(([name, plane]) => [name, planeToBytes(plane)]));
}

/** The maps of a key's re-cut. */
export function seventhMaps(cut) {
  return cutMaps(cut, W, H);
}

// --- the tones ---------------------------------------------------------------

/**
 * Recipe A's constants, per key and region: `from` = the region's mean in
 * the re-cut drawing (the inter-quartile core by luma, clear of the
 * drawing's own lines), `to` = the same region's mean on the per-pixel
 * MEDIAN of the key's prints (which drops each card's own ink), `k` (frame
 * body and text box only) = the prints' texture contrast over the drawing's
 * (the sd of band-passed luma, 3–24 px). A region without `k` is toned by
 * the gain to ÷ from. w u b r g a l: 21 / 9 / 9 / 9 / 9 / 9 / 9 sets (proof
 * 1's constants, re-derived for 4.10a with the importer's own re-cut and
 * regions: identical); wl ul bl rl gl: the seven black-bordered basics of
 * each colour — their rings and trim are flat colour and take `k: 1`, an
 * offset; ml (the stand-in land): the plain land's frame and rings with the
 * gold frame's text box and trim.
 */
export const SEVENTH_TONES = Object.freeze({
  w: {
    body: { from: [230.5, 219.6, 198.8], to: [183.7, 167.4, 142.8], k: 0.842 },
    text: { from: [244.6, 244.6, 234.8], to: [231.8, 229.1, 220.7], k: 1.023 },
    obevelL: { from: [166.8, 157.9, 140], to: [150.7, 138.3, 109.6] },
    obevelT: { from: [232.3, 224.9, 208.4], to: [188.1, 178.2, 158] },
    obevelR: { from: [230.6, 222.1, 202.9], to: [214.3, 209.1, 186.8] },
    obevelB: { from: [169.7, 162.7, 146.4], to: [151.6, 135, 106.9] },
    abevelL: { from: [235, 227.8, 213], to: [208, 197.2, 177.3] },
    abevelT: { from: [169.8, 162.7, 146.8], to: [141.9, 124.6, 99.9] },
    abevelR: { from: [158.2, 145.7, 123.6], to: [132.6, 116.8, 91.7] },
    abevelB: { from: [233, 225.4, 209.1], to: [209.9, 198.4, 178.1] },
    trimL: { from: [206.3, 206.6, 200.2], to: [225.5, 220.4, 209.5] },
    trimT: { from: [247, 247.1, 239], to: [233.6, 230.2, 223.2] },
    trimR: { from: [247.1, 247.1, 239.6], to: [233.2, 230.1, 223.1] },
    trimB: { from: [205.6, 205.8, 197.3], to: [227.8, 224.1, 213.8] },
  },
  u: {
    body: { from: [73, 163.2, 192.8], to: [76.8, 158.8, 171.8], k: 0.92 },
    text: { from: [230.5, 240.6, 252.3], to: [207.6, 224.3, 225], k: 0.753 },
    obevelL: { from: [43.3, 90.6, 128.2], to: [43, 67.2, 74.8] },
    obevelT: { from: [107.9, 163.4, 197.2], to: [97.9, 167.2, 183.5] },
    obevelR: { from: [111.9, 173.6, 202.6], to: [122.4, 187.9, 208.6] },
    obevelB: { from: [42.4, 118.8, 148.7], to: [55.5, 95.3, 98] },
    abevelL: { from: [112.9, 178, 204.9], to: [141.1, 193.2, 211.4] },
    abevelT: { from: [48.6, 111.8, 140], to: [66.7, 123, 127.2] },
    abevelR: { from: [43, 89.3, 127.2], to: [56.6, 97.3, 105.2] },
    abevelB: { from: [121, 185.7, 206.5], to: [144.6, 201.4, 220.5] },
    trimL: { from: [208.2, 226, 240.5], to: [184.5, 213.6, 221.7] },
    trimT: { from: [199.3, 220.8, 236.7], to: [167.5, 208, 222.6] },
    trimR: { from: [200.6, 221.4, 236.3], to: [172.4, 209.2, 221.7] },
    trimB: { from: [208.6, 226.7, 241.1], to: [189.6, 217.2, 223] },
  },
  b: {
    body: { from: [22, 16.1, 16.1], to: [27.1, 28.4, 23], k: 0.869 },
    text: { from: [234.2, 200, 144.6], to: [225.1, 175.5, 130.2], k: 0.814 },
    obevelL: { from: [17, 12.6, 12.6], to: [37.3, 41.7, 37] },
    obevelT: { from: [79.5, 75, 75], to: [54.2, 57.5, 50] },
    obevelR: { from: [82.5, 78.3, 78.3], to: [72.5, 82.5, 71] },
    obevelB: { from: [17.6, 13.3, 13.3], to: [48.1, 54.6, 45.5] },
    abevelL: { from: [81.1, 76.7, 76.7], to: [77.3, 82.6, 76.9] },
    abevelT: { from: [16.7, 12.3, 12.3], to: [29.6, 29.6, 23.5] },
    abevelR: { from: [15.8, 11.1, 11.1], to: [23.4, 24.1, 19.9] },
    abevelB: { from: [82, 77.7, 77.7], to: [87.6, 95.7, 85.9] },
  },
  r: {
    body: { from: [184.3, 88.7, 46.9], to: [150.9, 67, 46.7], k: 0.779 },
    text: { from: [206.7, 144.9, 115.4], to: [177.3, 116.2, 100.2], k: 1.083 },
    obevelL: { from: [129.2, 65.4, 35.1], to: [61.7, 38.5, 31.6] },
    obevelT: { from: [198.7, 129.9, 98.8], to: [162.3, 105.1, 86.5] },
    obevelR: { from: [200.3, 130.8, 98.8], to: [171.6, 115.7, 97.9] },
    obevelB: { from: [134.3, 65.4, 34.3], to: [64.2, 40.8, 32.4] },
    abevelL: { from: [201.4, 131.3, 99.2], to: [207.3, 113.3, 84.3] },
    abevelT: { from: [139.4, 67.1, 34.7], to: [98, 47.8, 35.2] },
    abevelR: { from: [134.6, 65.8, 34], to: [95.9, 47.8, 34.4] },
    abevelB: { from: [204.3, 131.3, 99], to: [206.8, 110, 82.2] },
    trimL: { from: [220, 150.4, 115.5], to: [208.8, 110.7, 81.6] },
    trimT: { from: [136.7, 85.3, 67.8], to: [99.2, 47.5, 35.4] },
    trimR: { from: [135.7, 84.7, 67.7], to: [97, 47.1, 34.2] },
    trimB: { from: [219.9, 150.5, 115.6], to: [207.4, 110.3, 81.6] },
  },
  g: {
    body: { from: [72.4, 91.2, 44.3], to: [58.5, 82.4, 55.8], k: 0.816 },
    text: { from: [230.9, 189.3, 133.2], to: [189.6, 153.4, 122.2], k: 0.647 },
    obevelL: { from: [53.8, 67.8, 33.1], to: [55.1, 70.6, 51.9] },
    obevelT: { from: [116.9, 131.3, 96.5], to: [101.7, 138.3, 106.3] },
    obevelR: { from: [116.2, 130.3, 95.6], to: [99.1, 126.3, 90] },
    obevelB: { from: [55.3, 69, 33.5], to: [56, 77.3, 53.5] },
    abevelL: { from: [124.6, 138.1, 101.9], to: [108.4, 142.5, 106.6] },
    abevelT: { from: [55.5, 70.3, 34.9], to: [46.4, 57.5, 41.4] },
    abevelR: { from: [47.3, 61.4, 28.4], to: [40.5, 43.5, 35.6] },
    abevelB: { from: [115.6, 129.6, 94.8], to: [100.1, 129.8, 91.6] },
  },
  a: {
    body: { from: [97.2, 79.5, 56.2], to: [80.9, 60.1, 45.1], k: 0.883 },
    text: { from: [237.9, 241.3, 240.1], to: [216.3, 209, 194.4], k: 0.817 },
    obevelL: { from: [70.7, 58.8, 42.4], to: [51.3, 42.1, 35.3] },
    obevelT: { from: [140.8, 125.6, 106.6], to: [139.7, 106.2, 82.9] },
    obevelR: { from: [146.6, 128.6, 107], to: [146.1, 115.2, 87] },
    obevelB: { from: [70, 58.2, 42], to: [43.1, 34.7, 28.7] },
    abevelL: { from: [136.5, 123.5, 106.3], to: [122.3, 99, 79.8] },
    abevelT: { from: [65.5, 56.3, 41.9], to: [45.8, 38.1, 30.2] },
    abevelR: { from: [73.2, 60, 42.8], to: [55.8, 42.1, 32.8] },
    abevelB: { from: [132.8, 121.9, 106.3], to: [130.1, 97.5, 72.4] },
    trimL: { from: [206.3, 204.6, 198.5], to: [214, 207.2, 192.6] },
    trimT: { from: [238.8, 245.7, 243.9], to: [217.5, 213.4, 196.9] },
    trimR: { from: [244.4, 243.2, 244.1], to: [218.4, 212.2, 195.2] },
    trimB: { from: [201.6, 205.1, 201.4], to: [212.4, 205.4, 190.3] },
  },
  l: {
    body: { from: [99.5, 75.9, 55.1], to: [121.7, 101.1, 86.9], k: 0.905 },
    text: { from: [219.1, 159.1, 85.6], to: [194.8, 150.8, 99.4], k: 0.875 },
    obevelL: { from: [52.8, 39.5, 28.1], to: [57, 50.6, 44] },
    obevelT: { from: [133.8, 113.3, 94.1], to: [169.3, 149.2, 132.6] },
    obevelR: { from: [138, 117.2, 97.4], to: [180.6, 160.3, 145.2] },
    obevelB: { from: [62, 46.7, 33.7], to: [68, 57.3, 49.5] },
    abevelL: { from: [132.4, 111.9, 93], to: [170.6, 151.4, 141.1] },
    abevelT: { from: [69.3, 53.4, 38.7], to: [94.5, 79.5, 68.5] },
    abevelR: { from: [66.2, 50.6, 36.7], to: [86.2, 72.3, 63.3] },
    abevelB: { from: [135.2, 114.6, 95.4], to: [179.7, 156.1, 143.3] },
    trimL: { from: [243, 173, 32], to: [210.1, 156, 55.9] },
    trimT: { from: [243, 173, 32], to: [212.3, 158.5, 56.9] },
    trimR: { from: [243, 173, 32], to: [213.4, 158.2, 58.9] },
    trimB: { from: [243, 173, 32], to: [211.6, 156.6, 56.2] },
    pin: { from: [243.4, 173, 32], to: [221.9, 169.6, 62.8] },
  },
  wl: {
    body: { from: [106.5, 81.5, 59.7], to: [131.2, 109, 91], k: 0.769 },
    text: { from: [242.7, 212.1, 157], to: [223.5, 190.2, 133.4], k: 1.078 },
    abevelB: { from: [135.4, 114.8, 95.6], to: [180, 157.9, 140.8] },
    abevelL: { from: [133.6, 112.8, 93.9], to: [179.5, 157.8, 143.6] },
    abevelR: { from: [66.6, 50.9, 36.7], to: [93.5, 75.6, 61.9] },
    abevelT: { from: [66.6, 51.1, 37.1], to: [99.9, 80.1, 65.7] },
    obevelB: { from: [63.2, 47.6, 34.2], to: [76.2, 62.9, 53.4] },
    obevelL: { from: [54.9, 41.2, 29.2], to: [66.3, 55.3, 47.8] },
    obevelR: { from: [138.1, 117.2, 97.5], to: [181.2, 159.1, 141.9] },
    obevelT: { from: [133.8, 113.3, 94.1], to: [168.8, 149.8, 130.3] },
    pin: { from: [243.5, 245, 239], to: [193.7, 190.2, 184.8], k: 1 },
    trimB: { from: [243, 245, 239], to: [192.1, 182.1, 178.8], k: 1 },
    trimL: { from: [243, 245, 239], to: [194, 183.4, 180.1], k: 1 },
    trimR: { from: [243, 245, 239], to: [196.4, 185.7, 181.5], k: 1 },
    trimT: { from: [243, 245, 239], to: [193.2, 183.1, 179.4], k: 1 },
  },
  ul: {
    body: { from: [106.2, 81.3, 59.5], to: [129.8, 109.3, 92.5], k: 0.839 },
    text: { from: [185.7, 208, 210.6], to: [171.7, 185.5, 185.4], k: 0.808 },
    abevelB: { from: [133.6, 113.3, 94.2], to: [176.5, 155.2, 139.3] },
    abevelL: { from: [132.7, 112.1, 93.3], to: [175.7, 156.7, 143.6] },
    abevelR: { from: [66, 50.4, 36.5], to: [91.9, 76.2, 65] },
    abevelT: { from: [69.5, 53.6, 38.9], to: [97.3, 80.9, 67.7] },
    obevelB: { from: [63.9, 48.6, 34.9], to: [78, 66.4, 57.3] },
    obevelL: { from: [54.2, 40.4, 28.8], to: [71.4, 62.7, 52.8] },
    obevelR: { from: [138, 117.2, 97.4], to: [182.6, 162, 145] },
    obevelT: { from: [136.9, 116.1, 96.2], to: [183.7, 160.3, 140.7] },
    pin: { from: [70.5, 129, 163], to: [66, 111.3, 133.8], k: 1 },
    trimB: { from: [70, 129, 163], to: [62.9, 104.4, 129.2], k: 1 },
    trimL: { from: [70, 129, 163], to: [62.5, 107.4, 133.4], k: 1 },
    trimR: { from: [70, 129, 163], to: [64.6, 109.1, 135.4], k: 1 },
    trimT: { from: [70, 129, 163], to: [64.7, 107, 132.6], k: 1 },
  },
  bl: {
    body: { from: [103.8, 79.4, 58], to: [125, 105.3, 89.4], k: 0.995 },
    text: { from: [156.3, 160, 153.6], to: [138.1, 136.8, 127.7], k: 0.73 },
    abevelB: { from: [136.2, 115.6, 96.1], to: [181.8, 160.5, 145.3] },
    abevelL: { from: [132.8, 112.2, 93.4], to: [175.6, 156.9, 144.4] },
    abevelR: { from: [66.4, 50.7, 36.8], to: [86, 70.6, 59.7] },
    abevelT: { from: [66.8, 51.3, 36.9], to: [86.6, 70.9, 58.7] },
    obevelB: { from: [60.7, 45.7, 32.7], to: [68.8, 57.1, 47.8] },
    obevelL: { from: [53.1, 39.8, 28.1], to: [63.8, 55.1, 46.5] },
    obevelR: { from: [137.3, 115.9, 96.9], to: [171.4, 152.4, 138.5] },
    obevelT: { from: [131.8, 111.3, 92.4], to: [167, 150.7, 133.3] },
    pin: { from: [43.5, 41, 33], to: [64.9, 63.2, 57.1], k: 1 },
    trimB: { from: [43, 41, 33], to: [59.9, 57.5, 50.5], k: 1 },
    trimL: { from: [43, 41, 33], to: [61.1, 58, 50.4], k: 1 },
    trimR: { from: [43, 41, 33], to: [62.6, 60.3, 53.4], k: 1 },
    trimT: { from: [43, 41, 33], to: [63.5, 60.2, 53.1], k: 1 },
  },
  rl: {
    body: { from: [106.6, 81.6, 59.7], to: [131.5, 109.2, 91.7], k: 0.873 },
    text: { from: [248.8, 195.6, 176.2], to: [231, 177.1, 153], k: 0.804 },
    abevelB: { from: [136, 115.4, 96], to: [181.9, 159.5, 142.4] },
    abevelL: { from: [133.3, 112.6, 93.6], to: [178.2, 156.9, 140.7] },
    abevelR: { from: [66.2, 50.5, 36.6], to: [96.5, 78.1, 65.3] },
    abevelT: { from: [70.2, 54.2, 39.4], to: [102.3, 83, 68.5] },
    obevelB: { from: [62.7, 47.4, 34], to: [76.9, 63.9, 54.7] },
    obevelL: { from: [52.9, 39.9, 28.3], to: [68, 58, 49.7] },
    obevelR: { from: [142.8, 121.9, 101.4], to: [188.7, 168.1, 152.3] },
    obevelT: { from: [133.8, 113.3, 94.1], to: [168.6, 149.4, 129.4] },
    pin: { from: [222, 93.4, 67], to: [193.9, 84.4, 57.2], k: 1 },
    trimB: { from: [222, 93, 67], to: [210.1, 79, 53.6], k: 1 },
    trimL: { from: [223, 93, 67], to: [214.7, 83.5, 54.5], k: 1 },
    trimR: { from: [222, 93, 67], to: [215.4, 85.2, 58.2], k: 1 },
    trimT: { from: [223, 93, 67], to: [212.3, 83.2, 57.2], k: 1 },
  },
  gl: {
    body: { from: [104.6, 80, 58.5], to: [127.8, 107.5, 90.1], k: 0.966 },
    text: { from: [204.9, 215.9, 144.6], to: [187.7, 188.9, 122.3], k: 0.563 },
    abevelB: { from: [135, 114.6, 95.2], to: [179.6, 157.4, 141.4] },
    abevelL: { from: [132.2, 111.8, 93], to: [171.6, 153.7, 139.2] },
    abevelR: { from: [66.3, 50.7, 36.9], to: [86.6, 71.9, 59.8] },
    abevelT: { from: [69.8, 53.6, 39.2], to: [99.1, 81.3, 66.6] },
    obevelB: { from: [61.2, 46.1, 33], to: [72.7, 61.8, 52.6] },
    obevelL: { from: [54.8, 40.8, 28.8], to: [69, 60.1, 53] },
    obevelR: { from: [137.7, 116.7, 96.9], to: [182.1, 162.1, 145.3] },
    obevelT: { from: [135.3, 114.2, 94.8], to: [180.4, 160.3, 146.9] },
    pin: { from: [5, 129, 69], to: [130.5, 168.8, 75.6], k: 1 },
    trimB: { from: [5, 129, 69], to: [128, 162.6, 65.9], k: 1 },
    trimL: { from: [5, 129, 69], to: [129.5, 165.1, 69.9], k: 1 },
    trimR: { from: [5, 129, 69], to: [130, 166.1, 71.1], k: 1 },
    trimT: { from: [5, 129, 69], to: [130.3, 165.8, 70.1], k: 1 },
  },
  ml: {
    body: { from: [99.5, 75.9, 55.1], to: [121.7, 101.1, 86.9], k: 0.905 },
    text: { from: [186, 162.9, 163.1], to: [168, 149.4, 145.3], k: 0.904 },
    abevelB: { from: [135.2, 114.6, 95.4], to: [179.7, 156.1, 143.3] },
    abevelL: { from: [132.4, 111.9, 93], to: [170.6, 151.4, 141.1] },
    abevelR: { from: [66.2, 50.6, 36.7], to: [86.2, 72.3, 63.3] },
    abevelT: { from: [69.3, 53.4, 38.7], to: [94.5, 79.5, 68.5] },
    obevelB: { from: [62, 46.7, 33.7], to: [68, 57.3, 49.5] },
    obevelL: { from: [52.8, 39.5, 28.1], to: [57, 50.6, 44] },
    obevelR: { from: [138, 117.2, 97.4], to: [180.6, 160.3, 145.2] },
    obevelT: { from: [133.8, 113.3, 94.1], to: [169.3, 149.2, 132.6] },
    pin: { from: [243.4, 173, 32], to: [221.9, 169.6, 62.8] },
    trimB: { from: [172.7, 153.4, 157.5], to: [206.7, 189.7, 192] },
    trimL: { from: [179.8, 163.3, 166.6], to: [212.2, 200.8, 202.5] },
    trimR: { from: [231.7, 219.5, 223.7], to: [178, 159.1, 169.5] },
    trimT: { from: [225.7, 208, 214.4], to: [169.1, 151.1, 156.6] },
  },
});
