// ---------------------------------------------------------------------------
// mse-showcase-borders.mjs — the printed border the MSE showcase masters
// leave out (TODO 4.11 / 4.35, the MSE-only showcase step, layout v68).
//
// Magic Set Editor draws a showcase's border at RENDER time: the style's
// `border color` layer, in the card's border colour, through a mask — so
// the card PNGs it ships (and our upscales of them, scripts/build-showcase-
// frames.mjs) are see-through where print has its black border, and the
// bake showed the card root's #101015 there (7.7's edge contract, 4.35).
// This module is that border as DATA, painted UNDER each master by the
// builder: never over a pixel the drawing paints, the black itself the
// border black the print-verified Card Conjurer M15 masters draw (0,0,0 —
// owner 2026-10-22: Scryfall's PNGs read 19,12,12 on every black border,
// the regular M15 printings' too, which is their scanning, not the frame).
//
// Two shapes:
//   • "edge" — every see-through pixel (α < 250) joined to the card's
//     outline through see-through pixels: the band the drawing leaves round
//     itself. The art window is never joined to it (the builder throws if
//     the flood reaches an art seed). Tarkir draconic: MSE's own
//     `border_mask.png` is not a border mask (it marks the text box), and
//     its drawing runs its dragons to the side edges — print's black is
//     exactly the band below and beside them (TDM #292–326: the black border
//     at the bottom and the lower sides, the dragons to the edge above).
//   • "ring" — a black ring of fixed width round an art window, with a
//     footer: Tarkir ghostfire's black run (TDM #399–408). The window's
//     shape is MSE's `border_mask.png` (744 × 1039: window x 38–705, y
//     39–931, inner corners r ≈ 11, the bottom corners chamfered 45° over
//     ~38 px, black under the ribbon to the bottom edge); its three straight
//     edges are PRINT'S (owner rule: match print) — the ring's inner edge by
//     its half-level crossing on every bright-art row / column of #399–408,
//     median: left 78.3 px, right 80.2, top 80.0 (MSE's scaled 76.6 / 76.6 /
//     78.8 drew it 1–3 px narrow). Drawn as geometry (4 × 4 supersampled),
//     not the 2.016× upscale of a 744 px mask, so its edge is clean at 2×.
//
// The builder writes these masters as a palette PNG WITHOUT dithering
// (PALETTE_PNG_OPTIONS) and checks the decoded file: a dithered palette
// maps a few opaque near-black pixels of the new border onto a dark
// TRANSLUCENT entry (α 231–240 on the draconic sides — cheap for the
// quantizer, which weighs dark colours premultiplied, and a 7.7 failure).
//
//   • "outside" — every see-through pixel NOT joined to the art window
//     (the window: α < 250 joined to an art seed): the footer a frame whose
//     art runs to the top and side edges leaves below its box. The Avatar
//     elemental (TLA #336–353, TLE #305–317: a black footer — MSE's
//     `border_borderless_mask.png`, the style's "only copyright" border) and
//     the Bloomburrow woodland (BLB #295–336: the footer in the colour's own
//     tone — MSE's `card colored border`, border/<c>border.png through
//     border_mask.png — whose flat colours equal the raw scan medians of the
//     prints, colour for colour: w 64,49,56 · u 0,55,81 · r 84,0,9 · g
//     18,66,7 · gold 64,37,49 · b 19,12,13 — the footer's own tone, not
//     the scanner's: the same scans read 0,0,0 on BLB's black borders; c (no
//     print) MSE's 51,31,21). On both the region is
//     exactly MSE's mask (the woodland's differs by 56 px of rim).
//
// The painted layer is cut at the one card corner (lib/cards/card-corner.ts
// applyCardCornerMask) — the drawing's own pixels outside the arc are left
// as drawn (draconic's dragon heads in the top corners: design, 3.26).
// Pure; no I/O. Unit-tested in tests/unit/frames/mse-showcase-borders.test.ts.
// ---------------------------------------------------------------------------
import { applyCardCornerMask } from "../../lib/cards/card-corner.ts";

/** The border black (lib/frames/square-corners.ts BORDER_BLACK_RGB). */
export const BORDER_BLACK = Object.freeze([0, 0, 0]);
/** "See-through" for the edge flood: every pixel short of opaque — the
 *  drawing's anti-aliased rim and its faint specks at the edge join the
 *  band, so the black goes under them (no light fringe, no α 0.98 speck
 *  for the edge contract). */
export const SEE_THROUGH_BELOW = 255;

/** The ghostfire black run's art window at 1500 × 2100 (HD px): print's
 *  ring (TDM #399–408, the inner edge's median: 78.3 / 80.2 / 80.0 px from
 *  the left, right and top edges) on whole px, MSE's footer (its border
 *  mask's y 931.99 of 1039, under the ribbon). */
export const GHOSTFIRE_WINDOW = Object.freeze({
  left: 78,
  top: 80,
  right: 1420,
  bottom: 1884,
  /** The inner corners at the top: MSE's r ≈ 11 of 744. */
  topRadius: 22,
  /** The bottom corners' 45° chamfer (MSE: 38 px of 744), under the
   *  ribbon but for a sliver at its ends. */
  bottomChamfer: 77,
});

/** The PNG encoder options for a bordered master (no dithering, see above). */
export const PALETTE_PNG_OPTIONS = Object.freeze({ compressionLevel: 9, effort: 10, dither: 0 });
/** …tried in this order until the decoded border is whole (the quantizer's
 *  palette for a busy drawing — the woodland's — can still map a few
 *  footer pixels onto a translucent entry at full quality); the last is a
 *  truecolour PNG, which cannot. The builder logs which one each master
 *  took; the attempts are deterministic for the same input. */
export const BORDERED_PNG_ATTEMPTS = Object.freeze([
  PALETTE_PNG_OPTIONS,
  Object.freeze({ ...PALETTE_PNG_OPTIONS, quality: 90 }),
  Object.freeze({ ...PALETTE_PNG_OPTIONS, quality: 80 }),
  // Truecolour, lossless: adaptive filtering writes it ~30 % smaller
  // (bloomburrow/r 2.9 MB → 2.0 MB, the same pixels).
  Object.freeze({ compressionLevel: 9, palette: false, adaptiveFiltering: true }),
]);

/** Pixels of the painted BORDER (coverage 1) the encode left short of
 *  opaque (α < 252, 0.99 — the edge contract's floor): must be none. (The
 *  quantizer may still move a near-opaque rim pixel of the DRAWING a few
 *  levels — α 240–251 on a handful of outline pixels, invisible over the
 *  art; the border itself is held exactly.) */
export function borderLost(cov, after) {
  let lost = 0;
  for (let p = 0; p < cov.length; p += 1) if (cov[p] >= 1 && after[p * 4 + 3] < 252) lost += 1;
  return lost;
}

/** The woodland's footer per colour key: MSE's border/<c>border.png, equal
 *  to the prints' raw medians channel for channel. The black key's is the
 *  footer's OWN tone, 19,12,13 — not the border black: every black woodland
 *  print reads it at the footer's centre and both lower sides (BLB #309,
 *  #311, #312, #314) while the same BLB scans read 0,0,0 on the regular
 *  black-bordered cards (#1, #60, #86, #90, #100, #210), so it is print's
 *  drawing, not the scanner's tint (the owner's "true black" is for a
 *  border whose tint is the scanner's). */
export const WOODLAND_FOOTER_RGB = Object.freeze({
  w: Object.freeze([64, 49, 56]),
  u: Object.freeze([0, 55, 81]),
  b: Object.freeze([19, 12, 13]),
  r: Object.freeze([84, 0, 9]),
  g: Object.freeze([18, 66, 7]),
  m: Object.freeze([64, 37, 49]),
  c: Object.freeze([51, 31, 21]),
});

/** The Bloomburrow anime showcase (BLB #343–355; TODO 4.11 / 4.35, layout
 *  v70): MSE's style is a RECOLOUR template — its strokes are flat red
 *  (255,0,0) that MSE recolours per card colour at render — and its name and
 *  text boxes are `set_alpha(recolor_image(…, namebox / textbox colour),
 *  70 %)`. Print wears ONE look on every colour (two-colour legends, all of
 *  them, on the same frame), so the builder bakes ONE master, with these
 *  numbers measured on the 13 raised-foil scans (Scryfall PNGs at 1500 ×
 *  2100, each registered on MSE's stroke shapes per region — the crops
 *  wander 0–12 px):
 *   - the strokes: the raw median over every stroke's core (2 px eroded),
 *     531,750 px over 75 registered regions — 35,31,12 (one flat tone,
 *     owner 2026-10-27; print's raised foil runs 15–98 per region);
 *   - the boxes: the pairs of pixels 7 px inside / outside every box edge
 *     (strokes masked off), fitted inside = (1 − α)·outside + α·C per
 *     channel — the name box α 0.78 over 45,50,52 (slate; MSE's default is
 *     70 % black), the type / text box α 0.80 over 39,40,35;
 *   - the footer: 15,20,16 (the median of the 12 creature prints' footers;
 *     20 levels off black on green, where the same BLB scans read 0,0,0 on
 *     the regular black borders — print's own tone, as the woodland's). */
export const ANIME_STROKE_RGB = Object.freeze([35, 31, 12]);
export const ANIME_NAMEBOX = Object.freeze({ alpha: 0.78, rgb: Object.freeze([45, 50, 52]) });
export const ANIME_TEXTBOX = Object.freeze({ alpha: 0.8, rgb: Object.freeze([39, 40, 35]) });
export const ANIME_FOOTER_RGB = Object.freeze([15, 20, 16]);
/** The copper rim of the anime's raised-foil strokes (owner 2026-10-27: add
 *  it), measured on the same registered regions: a light copper edge on the
 *  strokes' UPPER edges only — the edges whose outward normal points within
 *  ~37° of straight up (by the share of copper pixels per 15° bin: 0.41–0.55
 *  within ±15°, 0.25–0.46 at ±30°, 0.13–0.26 at ±45°, the background's
 *  0.03–0.09 past 60°) — straddling MSE's stroke edge: its first two pixels
 *  inside (0.51 / 0.31 copper at 0°) and two to three outside (0.55 / 0.44 /
 *  0.26) — drawn as one ring in, one out and a half past it (a 2 + 3 ring
 *  rim read heavier than print's on the 2× sheet). Its tone: the median of the copper pixels of those rings within
 *  ±45° (68,570 px), 180,103,59; the stroke's core keeps its 35,31,12 (the
 *  rings past the rim read 34–38, 29–33, 9–16). */
export const ANIME_RIM = Object.freeze({
  rgb: Object.freeze([180, 103, 59]),
  /** Rings inside the edge (4-neighbour, 1 px each), fully copper. */
  inside: 1,
  /** Rings outside the edge fully copper, then one at half. */
  outside: 1,
  outsideHalf: 1,
  /** Full strength on edges within this angle of straight up… */
  fullWithinDeg: 30,
  /** …fading to none here. */
  zeroAtDeg: 50,
  /** The box blur (px) that turns the edge's alpha gradient into its normal. */
  normalBlurPx: 4,
});

/** Per template: the border's shape and colour (`rgb`, or `rgbByKey` per
 *  colour key). Kind "mask" is a style's own border mask (the anime's
 *  border_pt_mask.png), painted by the builder's layered path OVER the
 *  boxes and under the strokes, as MSE's z order draws it. */
export const MSE_SHOWCASE_BORDERS = Object.freeze({
  tarkirdraconic: Object.freeze({ kind: "edge", rgb: BORDER_BLACK }),
  tarkirghostfire: Object.freeze({ kind: "ring", rgb: BORDER_BLACK, window: GHOSTFIRE_WINDOW }),
  avatar: Object.freeze({ kind: "outside", rgb: BORDER_BLACK }),
  // Not cut at the card corner: the coloured footer is the frame's design
  // running into the bottom corners (a square output keeps it there,
  // lib/frames/square-corners.ts "frame"; a round render cuts it).
  bloomburrow: Object.freeze({ kind: "outside", rgbByKey: WOODLAND_FOOTER_RGB, keepCorners: true }),
  // Not cut at the card corner: the footer is the frame's own dark tone
  // running into the bottom corners (a square output keeps it; a round
  // render cuts it).
  bloomanime: Object.freeze({ kind: "mask", rgb: ANIME_FOOTER_RGB, keepCorners: true }),
});

/** The colour `template`'s border paints for colour key `key` (null: no
 *  border declared). */
export function showcaseBorderRgb(template, key) {
  const spec = MSE_SHOWCASE_BORDERS[template];
  if (!spec) return null;
  if (spec.rgbByKey) {
    const rgb = spec.rgbByKey[key];
    if (!rgb) throw new Error(`${template}: no border colour for key ${key}`);
    return rgb;
  }
  return spec.rgb;
}

/** 1 inside the ghostfire-style window at the point (x, y), else 0. */
function insideWindow(win, x, y) {
  if (x < win.left || x > win.right || y < win.top || y > win.bottom) return false;
  const r = win.topRadius;
  if (y < win.top + r) {
    const cx = x < win.left + r ? win.left + r : x > win.right - r ? win.right - r : x;
    if (cx !== x && Math.hypot(x - cx, y - (win.top + r)) > r) return false;
  }
  // The bottom corners cut 45° from (left, bottom − c) to (left + c,
  // bottom), and the mirror at the right.
  const c = win.bottomChamfer;
  if (y > win.bottom - c + (x - win.left)) return false;
  if (y > win.bottom - c + (win.right - x)) return false;
  return true;
}

/** The ring's coverage (0–1 per pixel): 1 − the window's coverage, 4 × 4
 *  samples a pixel. */
export function ringCoverage(win, width, height) {
  const cov = new Float32Array(width * height);
  const S = 4;
  for (let y = 0; y < height; y += 1) {
    const near = y < win.top - 1 || y > win.bottom + 1;
    for (let x = 0; x < width; x += 1) {
      if (near || x < win.left - 1 || x > win.right + 1) {
        cov[y * width + x] = 1;
        continue;
      }
      let inside = 0;
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          if (insideWindow(win, x + (sx + 0.5) / S, y + (sy + 0.5) / S)) inside += 1;
        }
      }
      cov[y * width + x] = 1 - inside / (S * S);
    }
  }
  return cov;
}

/** 4-connected flood over `open` pixels from every listed start. */
function flood(open, width, height, starts) {
  const seen = new Uint8Array(width * height);
  const stack = [];
  for (const p of starts) {
    if (open(p) && !seen[p]) {
      seen[p] = 1;
      stack.push(p);
    }
  }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
    for (const q of next) {
      if (q >= 0 && !seen[q] && open(q)) {
        seen[q] = 1;
        stack.push(q);
      }
    }
  }
  return seen;
}

/**
 * The edge band's coverage: every see-through pixel joined to the card's
 * outline. Throws when it reaches an art seed ([fx, fy] fractions of the
 * card) — the window must never turn black.
 */
export function edgeCoverage(rgba, width, height, seeds) {
  const open = (p) => rgba[p * 4 + 3] < SEE_THROUGH_BELOW;
  const starts = [];
  for (let x = 0; x < width; x += 1) starts.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) starts.push(y * width, y * width + width - 1);
  const seen = flood(open, width, height, starts);
  for (const [fx, fy] of seeds) {
    const p = Math.round(height * fy) * width + Math.round(width * fx);
    if (seen[p]) throw new Error(`the edge band reaches the art seed ${fx},${fy}: the window would turn black`);
  }
  const cov = new Float32Array(width * height);
  for (let p = 0; p < cov.length; p += 1) cov[p] = seen[p];
  return cov;
}

/**
 * The footer's coverage: every see-through pixel (α < 255) NOT in the art
 * window — the window being every α < 250 pixel joined to an art seed
 * ([fx, fy] fractions of the card).
 */
export function outsideCoverage(rgba, width, height, seeds) {
  const starts = seeds.map(([fx, fy]) => Math.round(height * fy) * width + Math.round(width * fx));
  const win = flood((p) => rgba[p * 4 + 3] < 250, width, height, starts);
  const cov = new Float32Array(width * height);
  for (let p = 0; p < cov.length; p += 1) cov[p] = !win[p] && rgba[p * 4 + 3] < SEE_THROUGH_BELOW ? 1 : 0;
  return cov;
}

/** The coverage cut at the one card corner (alpha only). */
export function cutAtCardCorner(cov, width, height) {
  const a = new Uint8Array(width * height * 4);
  for (let p = 0; p < cov.length; p += 1) a[p * 4 + 3] = 255;
  applyCardCornerMask(a, width, height);
  const out = new Float32Array(cov.length);
  for (let p = 0; p < cov.length; p += 1) out[p] = cov[p] * (a[p * 4 + 3] / 255);
  return out;
}

/** Paint `rgb` at `cov` UNDER the drawing (in place, straight RGBA). */
export function paintUnder(rgba, cov, rgb) {
  let painted = 0;
  for (let p = 0; p < cov.length; p += 1) {
    const c = cov[p];
    if (c <= 0) continue;
    const o = p * 4;
    const a = rgba[o + 3] / 255;
    const outA = a + c * (1 - a);
    if (outA <= 0) continue;
    for (let k = 0; k < 3; k += 1) rgba[o + k] = Math.round((rgba[o + k] * a + rgb[k] * c * (1 - a)) / outA);
    const before = rgba[o + 3];
    rgba[o + 3] = Math.round(outA * 255);
    if (rgba[o + 3] !== before) painted += 1;
  }
  return painted;
}

/** Paint `rgb` at `cov` OVER the image (in place, straight RGBA): a layer
 *  above what is there (the anime footer over its translucent boxes). */
export function paintOver(rgba, cov, rgb) {
  for (let p = 0; p < cov.length; p += 1) {
    const c = cov[p];
    if (c <= 0) continue;
    const o = p * 4;
    const b = rgba[o + 3] / 255;
    const outA = c + b * (1 - c);
    for (let k = 0; k < 3; k += 1) rgba[o + k] = Math.round((rgb[k] * c + rgba[o + k] * b * (1 - c)) / outA);
    rgba[o + 3] = Math.round(outA * 255);
  }
}

/** The copper rim layer (straight RGBA, W×H) for a stroke alpha (0–255,
 *  W×H): ANIME_RIM's rings around the strokes' upper edges. Composite it
 *  OVER the strokes. Pure. */
export function copperRimLayer(alpha, width, height, spec = ANIME_RIM) {
  const n = width * height;
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p += 1) mask[p] = alpha[p] > 128 ? 1 : 0;
  // 4-neighbour rings: depth inside (1 = the edge pixel) and outside.
  const ringIn = new Uint8Array(n);
  const ringOut = new Uint8Array(n);
  let cur = mask;
  for (let k = 1; k <= spec.inside; k += 1) {
    const next = new Uint8Array(n);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (!cur[p]) continue;
        const inner = x > 0 && x < width - 1 && y > 0 && y < height - 1 && cur[p - 1] && cur[p + 1] && cur[p - width] && cur[p + width];
        if (inner) next[p] = 1;
        else if (!ringIn[p]) ringIn[p] = k;
      }
    }
    cur = next;
  }
  let grown = mask;
  for (let k = 1; k <= spec.outside + spec.outsideHalf; k += 1) {
    const next = new Uint8Array(grown);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x;
        if (grown[p]) continue;
        if ((x > 0 && grown[p - 1]) || (x < width - 1 && grown[p + 1]) || (y > 0 && grown[p - width]) || (y < height - 1 && grown[p + width])) {
          next[p] = 1;
          ringOut[p] = k;
        }
      }
    }
    grown = next;
  }
  // The edge's outward normal: the alpha gradient, box-blurred.
  const a = new Float32Array(n);
  for (let p = 0; p < n; p += 1) a[p] = alpha[p] / 255;
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      gx[p] = (a[p + 1] - a[p - 1]) / 2;
      gy[p] = (a[p + width] - a[p - width]) / 2;
    }
  }
  const blur = (src) => {
    const r = spec.normalBlurPx;
    const tmp = new Float32Array(n);
    const out = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
      let acc = 0;
      for (let x = -r; x <= r; x += 1) if (x >= 0 && x < width) acc += src[y * width + x];
      for (let x = 0; x < width; x += 1) {
        tmp[y * width + x] = acc;
        const add = x + r + 1;
        const sub = x - r;
        if (add < width) acc += src[y * width + add];
        if (sub >= 0) acc -= src[y * width + sub];
      }
    }
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let y = -r; y <= r; y += 1) if (y >= 0 && y < height) acc += tmp[y * width + x];
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = acc;
        const add = y + r + 1;
        const sub = y - r;
        if (add < height) acc += tmp[add * width + x];
        if (sub >= 0) acc -= tmp[sub * width + x];
      }
    }
    return out;
  };
  const bx = blur(gx);
  const by = blur(gy);
  const layer = new Uint8Array(n * 4);
  for (let p = 0; p < n; p += 1) {
    const inR = ringIn[p];
    const outR = ringOut[p];
    if (!inR && !outR) continue;
    // Outward normal = −gradient; its angle from straight up (image y down).
    const nx = -bx[p];
    const ny = -by[p];
    const len = Math.hypot(nx, ny);
    if (len < 1e-6) continue;
    const fromUp = (Math.acos(Math.max(-1, Math.min(1, -ny / len))) * 180) / Math.PI;
    const w = fromUp <= spec.fullWithinDeg ? 1 : fromUp >= spec.zeroAtDeg ? 0 : (spec.zeroAtDeg - fromUp) / (spec.zeroAtDeg - spec.fullWithinDeg);
    const ring = outR > spec.outside ? 0.5 : 1;
    const alphaOut = Math.round(255 * w * (inR ? 1 : ring));
    if (alphaOut <= 0) continue;
    layer[p * 4] = spec.rgb[0];
    layer[p * 4 + 1] = spec.rgb[1];
    layer[p * 4 + 2] = spec.rgb[2];
    layer[p * 4 + 3] = alphaOut;
  }
  return layer;
}

/** A greyscale mask (0–255) as coverage — cut at the one card corner
 *  unless `keepCorners`. */
export function maskCoverage(grey, width, height, keepCorners = false) {
  const cov = new Float32Array(width * height);
  for (let p = 0; p < cov.length; p += 1) cov[p] = grey[p] / 255;
  return keepCorners ? cov : cutAtCardCorner(cov, width, height);
}

/** The border of `template` painted under its master (in place); its
 *  coverage back (null: the template has none). */
export function paintShowcaseBorder(template, rgba, width, height, seeds, key) {
  const spec = MSE_SHOWCASE_BORDERS[template];
  if (!spec) return null;
  if (spec.kind === "mask") throw new Error(`${template}: a "mask" border is painted by the builder's layered path`);
  const raw =
    spec.kind === "ring"
      ? ringCoverage(spec.window, width, height)
      : spec.kind === "outside"
        ? outsideCoverage(rgba, width, height, seeds)
        : edgeCoverage(rgba, width, height, seeds);
  const cov = spec.keepCorners ? raw : cutAtCardCorner(raw, width, height);
  paintUnder(rgba, cov, showcaseBorderRgb(template, key));
  return cov;
}
