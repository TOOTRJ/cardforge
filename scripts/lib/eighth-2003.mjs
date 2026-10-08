// ---------------------------------------------------------------------------
// eighth-2003.mjs — the 2003 frame's recipes (TODO 4.10b): Card Conjurer's
// "8th Edition" drawing RE-CUT onto the prints of the frame's LATER drawing
// (Champions of Kamigawa 2004 → Journey into Nyx 2014) and TONED region by
// region onto their colours. The steps are scripts/lib/print-cut.mjs (the
// 1997 frame's, TODO 4.10a); this file is the DATA and the drawing's
// regions. No scan is read by the build: every number below was read off the
// prints once (the era design's proof 2, 2026-10-07) and is recorded in
// lib/cards/frame-sources.json.
//
// Why each piece (proof 2):
//   - the pack's fifteen masters share ONE geometry, about 1 % smaller than
//     the prints' (frame box 1344.8 × 1946.0 px against 1358–1359 × 1958):
//     5.3–6.4 px RMS over fifteen structural edges as drawn. One scale per
//     axis between the outer frame's edges (the black border outside them is
//     never stretched) leaves 1.1–1.8 px, and three places stay off on EVERY
//     key: the type bar's top line 3–4 px high (the pack's bar is that much
//     taller than the prints'), the text box's top line 2 px high, its
//     bottom line 2 px low and its right line 2 px right. Those are anchors
//     of their own: 0.7–1.2 px RMS on every key;
//   - the prints' edges are the same on every colour (unlike the 1997
//     frame's text boxes), so there is ONE cut;
//   - the drawing's colours are a draw with the MSE conversion's against the
//     prints (mean ΔE over six bands 2.9–10.9 against 6.0–10.1) and both
//     sit 10–25 luma light on most bands, so every key is toned through the
//     pack's own five masks (Frame, Title, Type, Rules, Pinline — here they
//     ARE the drawing's regions) onto the per-pixel median of its prints:
//     mean ΔE 0.5–1.6.
//
// Units: px of the 1500 × 2100 master.
// ---------------------------------------------------------------------------

import { cutMaps, planeToBytes, recutPlane } from "./print-cut.mjs";

const W = 1500;
const H = 2100;

/**
 * The ONE re-cut of Card Conjurer's 8th drawing (print-cut.mjs cutMaps'
 * input; `[drawing px, print px]`). Rows: the outer frame (77 → 70.6,
 * 2023 → 2028.4: × 1.0061), the art window's lower black line (kept on the
 * scale), the type bar's top line (1180.8 → 1185.3: the prints' bar is
 * 3.5 px shorter at the top), its bottom line, the text box's top line
 * (1309.3 → 1312.3) and bottom line (1903.3 → 1906.0). Columns: the outer
 * frame (77.1 → 70.6, 1421.9 → 1428.5: × 1.0098) on the art rows; on the
 * text-box rows the box's right line too (1368.3 → 1372.6, 2 px further
 * left than the scale puts it), lerped across the type bar.
 */
export const EIGHTH_CUT = Object.freeze({
  y: Object.freeze([
    [77.0, 70.6],
    [1167.8, 1168.0],
    [1180.8, 1185.3],
    [1291.3, 1292.3],
    [1309.3, 1312.3],
    [1903.3, 1906.0],
    [2023.0, 2028.4],
  ]),
  xUpper: Object.freeze([
    [77.1, 70.6],
    [1421.9, 1428.5],
  ]),
  xLower: Object.freeze([
    [77.1, 70.6],
    [1368.3, 1372.6],
    [1421.9, 1428.5],
  ]),
  lerpRows: Object.freeze([1195, 1285]),
});

/** The cut as cutMaps takes it (plain arrays). */
export function eighthCut() {
  return {
    y: EIGHTH_CUT.y.map((a) => [...a]),
    xUpper: EIGHTH_CUT.xUpper.map((a) => [...a]),
    xLower: EIGHTH_CUT.xLower.map((a) => [...a]),
    lerpRows: [...EIGHTH_CUT.lerpRows],
  };
}

/** The maps of the re-cut. */
export function eighthMaps() {
  return cutMaps(eighthCut(), W, H);
}

/** The pack's masks that ARE the drawing's regions, by region name. `pin`
 *  (the coloured lines round the bars, the art and the text box) is taken
 *  out of the other four, whose masks it overlaps by its soft edge. */
export const EIGHTH_REGION_MASKS = Object.freeze({
  body: "img/frames/8th/frame.png",
  title: "img/frames/8th/title.png",
  type: "img/frames/8th/type.png",
  text: "img/frames/8th/rules.png",
  pin: "img/frames/8th/pinline.png",
});

/**
 * A key's regions on its RE-CUT image (bytes, name → coverage): each mask's
 * coverage (a 0 … 1 plane in the DRAWING's px, name → plane) moved with the
 * same maps as the image, the pinline taken out of the rest.
 */
export function eighthRegions(planes, maps) {
  const names = Object.keys(EIGHTH_REGION_MASKS);
  for (const name of names) {
    if (!planes[name] || planes[name].length !== W * H) throw new Error(`eighthRegions: no ${W}x${H} plane for ${name}`);
  }
  const R = Object.fromEntries(names.map((name) => [name, recutPlane(planes[name], maps)]));
  for (const name of names) {
    if (name === "pin") continue;
    for (let p = 0; p < W * H; p += 1) R[name][p] *= 1 - R.pin[p];
  }
  return Object.fromEntries(names.map((name) => [name, planeToBytes(R[name])]));
}

/** Which of the pack's masters (a key of EIGHTH_TONES) builds a template's
 *  colour key: `c` paints the ARTIFACT frame on `modern` (as before; the
 *  pack's own c.png is the translucent Eldrazi frame, TODO 4.10d) and the
 *  plain land on `modernland`; `modernland`/m is the pack's gold land. */
export const EIGHTH_MASTER_OF = Object.freeze({
  modern: Object.freeze({ w: "w", u: "u", b: "b", r: "r", g: "g", c: "a", m: "m" }),
  modernland: Object.freeze({ w: "wl", u: "ul", b: "bl", r: "rl", g: "gl", c: "l", m: "ml" }),
});

/**
 * The tones, per master and region: `from` = the region's mean in the
 * re-cut drawing (the inter-quartile core by luma, clear of the drawing's
 * own lines), `to` = the same region's mean on the per-pixel MEDIAN of the
 * master's prints (which drops each card's own ink). A region with `k` is
 * toned `(in − from) × k + to` (`k` = the prints' texture contrast over the
 * drawing's, the sd of band-passed luma 3–24 px, held to 0.7–1.2); one
 * without is toned by the gain to ÷ from. The rule that picks: a region the
 * prints set DARKER than the drawing takes the offset (a gain would flatten
 * its texture), one they set LIGHTER takes the gain while it is under
 * × 1.35 on every channel (an offset would lift the drawing's black lines
 * to grey), else the offset. Prints (CHK 2004 → JOU 2014, black-bordered):
 * w 34, u r g 11, b a 10, m 8 three-colour cards (a two-colour gold card
 * wears two-colour pinlines: TODO 4.6h), l 13 lands with no colour of their
 * own, wl ul bl rl gl the eight basics of each colour (CHK RAV TSP LRW ALA
 * ISD RTR THS), ml 9 three- and five-colour lands.
 */
export const EIGHTH_TONES = Object.freeze({
  w: {
    body: { from: [240.7, 232.9, 218.6], to: [219.0, 207.6, 188.9], k: 0.77 },
    title: { from: [249.6, 248.9, 241.2], to: [228.6, 223.9, 216.4], k: 0.933 },
    type: { from: [248.7, 248.1, 239.7], to: [228.1, 222.5, 214.2], k: 0.926 },
    text: { from: [237.6, 237.3, 230.5], to: [229.7, 225.6, 220.8], k: 0.882 },
    pin: { from: [255.0, 255.0, 255.0], to: [228.3, 225.4, 218.0], k: 1 },
  },
  u: {
    body: { from: [129.1, 160.4, 210.6], to: [108.3, 153.5, 200.7], k: 0.754 },
    title: { from: [206.7, 214.0, 220.7], to: [183.7, 196.5, 209.6], k: 0.967 },
    type: { from: [205.5, 213.2, 220.4], to: [181.7, 194.5, 207.5], k: 0.879 },
    text: { from: [236.8, 240.6, 246.2], to: [213.0, 215.7, 226.0], k: 0.791 },
    pin: { from: [49.0, 92.2, 144.2], to: [43.6, 100.6, 159.3] },
  },
  b: {
    body: { from: [33.4, 32.6, 34.1], to: [29.2, 31.7, 32.2], k: 1 },
    title: { from: [184.4, 176.0, 166.9], to: [182.1, 166.6, 157.3], k: 1.041 },
    type: { from: [183.6, 175.3, 165.9], to: [188.8, 174.4, 166.3] },
    text: { from: [233.3, 232.1, 229.2], to: [219.5, 213.4, 213.3], k: 0.857 },
    pin: { from: [56.2, 51.4, 47.7], to: [43.4, 41.8, 40.8], k: 1 },
  },
  r: {
    body: { from: [151.8, 72.3, 44.4], to: [190.4, 83.0, 53.5] },
    title: { from: [212.9, 180.1, 151.3], to: [228.5, 191.3, 168.3] },
    type: { from: [212.6, 179.8, 150.7], to: [228.2, 189.7, 166.7] },
    text: { from: [243.8, 237.6, 226.5], to: [230.2, 209.9, 201.5], k: 0.717 },
    pin: { from: [186.4, 46.9, 13.1], to: [214.3, 65.7, 41.6], k: 1 },
  },
  g: {
    body: { from: [90.9, 96.2, 68.7], to: [101.2, 119.8, 79.3] },
    title: { from: [186.1, 189.3, 172.7], to: [190.9, 194.0, 180.8] },
    type: { from: [184.7, 188.9, 171.6], to: [190.4, 193.5, 180.3] },
    text: { from: [220.5, 225.3, 209.8], to: [207.2, 211.6, 204.1], k: 0.805 },
    pin: { from: [50.7, 80.2, 52.0], to: [45.5, 93.2, 58.3] },
  },
  m: {
    body: { from: [198.3, 167.2, 84.2], to: [194.3, 163.4, 70.1], k: 0.77 },
    title: { from: [217.6, 200.6, 160.1], to: [203.0, 175.1, 109.6], k: 0.874 },
    type: { from: [216.8, 200.2, 154.8], to: [199.2, 171.0, 99.1], k: 0.834 },
    text: { from: [242.7, 238.5, 221.2], to: [226.4, 215.9, 199.9], k: 0.706 },
    pin: { from: [213.3, 189.3, 77.1], to: [218.8, 189.1, 84.6] },
  },
  a: {
    body: { from: [132.6, 134.7, 140.9], to: [137.9, 144.6, 148.7] },
    title: { from: [171.1, 176.2, 174.1], to: [175.2, 177.2, 176.2] },
    type: { from: [168.0, 173.8, 171.5], to: [174.1, 176.3, 175.1] },
    text: { from: [197.6, 198.0, 198.4], to: [204.9, 204.2, 205.4] },
    pin: { from: [255.0, 255.0, 255.0], to: [207.0, 202.1, 202.5], k: 1 },
  },
  l: {
    body: { from: [140.3, 115.4, 88.4], to: [146.6, 114.5, 87.2] },
    title: { from: [194.3, 184.3, 175.1], to: [197.1, 184.4, 174.0] },
    type: { from: [194.6, 185.4, 176.4], to: [198.9, 186.5, 177.1] },
    text: { from: [208.2, 202.5, 189.7], to: [199.3, 189.4, 181.1], k: 0.794 },
    pin: { from: [143.4, 127.3, 111.7], to: [156.2, 131.0, 110.3] },
  },
  wl: {
    body: { from: [144.2, 119.2, 92.1], to: [151.5, 118.5, 86.1] },
    title: { from: [250.1, 248.6, 240.5], to: [230.1, 222.3, 212.1], k: 0.93 },
    type: { from: [249.6, 249.0, 240.8], to: [229.8, 221.9, 211.9], k: 1.039 },
    text: { from: [237.7, 227.3, 179.1], to: [235.5, 214.6, 164.0], k: 0.861 },
    pin: { from: [254.9, 255.0, 254.9], to: [229.0, 223.8, 213.6], k: 1 },
  },
  ul: {
    body: { from: [142.2, 117.0, 90.2], to: [144.8, 114.1, 82.3], k: 1.099 },
    title: { from: [206.7, 213.4, 221.0], to: [185.5, 198.1, 209.7], k: 0.841 },
    type: { from: [207.8, 213.7, 220.8], to: [185.3, 198.0, 209.6], k: 0.959 },
    text: { from: [211.8, 219.2, 231.4], to: [182.9, 194.9, 222.4], k: 0.787 },
    pin: { from: [50.2, 90.6, 141.6], to: [42.2, 100.6, 157.3] },
  },
  bl: {
    body: { from: [149.2, 123.8, 95.3], to: [158.2, 126.2, 90.7] },
    title: { from: [184.9, 176.4, 167.4], to: [182.9, 169.6, 157.3], k: 0.998 },
    type: { from: [184.1, 175.6, 165.9], to: [190.1, 177.4, 165.5] },
    text: { from: [150.8, 142.2, 132.7], to: [164.1, 148.1, 134.0] },
    pin: { from: [54.0, 48.4, 45.6], to: [39.1, 37.9, 34.1], k: 1 },
  },
  rl: {
    body: { from: [145.0, 119.7, 92.3], to: [152.0, 117.2, 85.7], k: 1.072 },
    title: { from: [213.4, 179.0, 150.2], to: [230.7, 189.3, 160.5] },
    type: { from: [212.7, 179.7, 150.7], to: [231.2, 188.9, 161.0] },
    text: { from: [216.4, 148.4, 112.5], to: [226.6, 148.2, 106.4] },
    pin: { from: [182.1, 49.4, 15.4], to: [212.9, 63.5, 37.2], k: 1 },
  },
  gl: {
    body: { from: [138.6, 114.4, 88.1], to: [137.5, 106.8, 79.3], k: 1.097 },
    title: { from: [184.7, 187.9, 171.0], to: [187.5, 191.4, 173.7] },
    type: { from: [185.5, 189.0, 171.7], to: [187.0, 191.1, 174.0] },
    text: { from: [193.1, 202.0, 171.4], to: [185.7, 199.4, 170.5], k: 0.927 },
    pin: { from: [52.9, 79.3, 51.8], to: [42.5, 89.4, 56.9] },
  },
  ml: {
    body: { from: [181.7, 156.4, 123.2], to: [204.7, 171.3, 134.5] },
    title: { from: [218.6, 201.4, 160.1], to: [207.8, 180.1, 110.8], k: 0.792 },
    type: { from: [217.5, 200.8, 158.2], to: [210.7, 182.7, 113.9], k: 0.7 },
    text: { from: [243.2, 238.3, 220.3], to: [226.7, 216.4, 199.2], k: 0.7 },
    pin: { from: [214.6, 188.9, 76.5], to: [220.0, 191.7, 87.2] },
  },
});

/**
 * The P/T plates' tones, per master: `from` = the plate's light face as the
 * pack draws it, `to` = the same patch of the face (left of the digits) on
 * the master's prints — a per-channel GAIN (to ÷ from) over the whole
 * plate, so its dark outline and soft shadow stay dark. As drawn the gold
 * plate read 30 luma light, blue's 20 light and red's 16 dark against
 * their prints (ΔE 17 / 9 / 7); white, black, green and the artifact plate
 * were within 3.
 */
export const EIGHTH_PLATE_TONES = Object.freeze({
  w: { from: [220.8, 218.7, 208.9], to: [225.5, 217.9, 203.8] },
  u: { from: [194.9, 203.8, 214.7], to: [167.4, 184.7, 202.0] },
  b: { from: [182.3, 174.2, 165.3], to: [188.0, 173.3, 163.1] },
  r: { from: [210.5, 177.0, 148.0], to: [227.5, 192.3, 170.8] },
  g: { from: [183.4, 186.5, 169.8], to: [190.4, 194.2, 179.4] },
  m: { from: [209.0, 191.8, 144.4], to: [187.1, 161.9, 91.9] },
  a: { from: [161.6, 169.0, 169.0], to: [166.0, 172.0, 171.6] },
});

/** A 2003 master's print recipe (the importer's `printRecipe`). */
export function eighthPrintRecipe(template, key) {
  const master = EIGHTH_MASTER_OF[template]?.[key];
  if (!master) throw new Error(`eighthPrintRecipe: ${template}/${key} is no 2003 master`);
  const tones = EIGHTH_TONES[master];
  if (!tones) throw new Error(`eighthPrintRecipe: no tones for ${master}`);
  return { cut: eighthCut(), tones, regionMasks: EIGHTH_REGION_MASKS };
}
