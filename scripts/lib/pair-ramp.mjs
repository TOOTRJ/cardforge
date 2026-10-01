// ---------------------------------------------------------------------------
// pair-ramp.mjs — the two-colour split, the ONE place both builders read it:
// the pair frame masters (TODO 4.6b, scripts/lib/cc-frames.mjs
// pairMasterLayers) and the pair crown bands (4.6a / 4.6b). Pure, no I/O,
// no imports: raw 8-bit RGBA buffers in, raw 8-bit RGBA out.
//
// Design 2026-09-29 (§1.2), measured on the prints:
//   • every ramp is UNTILTED — the 50 % point moves 0.00 ± 0.36 %W between
//     10.8 and 55.9 %H, where Card Conjurer's maskRightHalf.png tilts
//     +1.35 %W — so one mask row serves every row;
//   • the second colour's share goes 0 → 1 linearly between two x positions
//     in % of the CARD's width (a crown band spans the full card width, so
//     the same numbers serve it);
//   • two colours meet in a premultiplied LERP, left · (1 − t) + right · t,
//     never CC's stacking (the right colour through a half mask drawn over
//     the left): opaque pixels come out the same, but stacking doubles a
//     translucent edge — the crown's soft shadow over the art reads α 160
//     where one crown reads 99.
// ---------------------------------------------------------------------------

/** The ten colour pairs in printed order, the first colour on the LEFT
 *  (lib/cards/frame-reference-registry.ts TWO_COLOR_PAIRS). */
export const TWO_COLOR_PAIRS = ["wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"];

/** The split ramps, [from, to] in % of the card's width — the second
 *  colour's share is 0 left of `from` and 1 right of `to`. 10/50/90 on the
 *  prints, each print pixel de-shaded against the SAME pixel of the two
 *  single-colour prints of its set (the share s that best explains it as
 *  (1 − s)·A + s·B, so the region's own texture and shading cancel; the
 *  4.6 review's re-measure, 2026-09-29), medians:
 *   • pinline 42.1 / 50.1 / 57.9 (20 FDN + TLA pairs) → 40→60 (42 / 50 / 58);
 *   • a hybrid's OUTER frame band above the title bar 45.1 / 50.3 / 55.6
 *     (TLA ×10, four row bands; FDN #656 / #668, BLB #226, GRN #216 agree)
 *     — steeper than its own pinline → 44→57 (45.3 / 50.5 / 55.7);
 *   • text box, text-free rows only, 45.9 / 50.6 / 55.3 (FDN, the 8 prints
 *     with ≥ 10 clean rows; MKM lands 45.7 / 50.8 / 55.8) → 45→57
 *     (46.2 / 51.0 / 55.8);
 *   • crown, rows 4.42–4.66 %H, 45.5 / 49.3 / 53.6 (gold: FDN #122 #123
 *     #115 #651 #126 #119 #245, MKM #238) and 46.4 / 49.4 / 53.6 (hybrid:
 *     TLA ×9) → 45→55 (46 / 50 / 54).
 *  The design's first figures (text box 47.2 / 51.3 / 56.8, crown 42.7 /
 *  48.5 / 53.0) came from a column profile the text and the crown's own
 *  shading skew; the frame band had been folded into the pinline's ramp.
 *   • the borderless FLOATING crown (TODO 4.6f, wave 2a) splits wider than
 *     the standard band: FDN's seven crowned borderless pairs (#343 B|R,
 *     #346 W|B, #347 G|U, #348 W|U, #349 B|G, #350 U|R, #351 G|U), each
 *     pixel de-shaded against the set's crowned monos (#294 / #309 / #324 /
 *     #330 / #336) inside the crown's own alpha, fit an untilted ramp of
 *     41.6 / 50.0 / 58.4 on the crown's top band (1.9–4.2 %H) and 41.6 /
 *     50.2 / 58.8 on its wrap under the title bar (9.6–11.9 %H) → 40→60
 *     (42 / 50 / 58), the pinline's ramp; the same borderless pairs' pinline
 *     (title and type rings) measures 42.0–43.4 / 50.2–51.2 / 58.4–59.0 on
 *     the uncrowned FDN #344 / #345 — 40→60 holds there too. */
export const PAIR_RAMPS = Object.freeze({
  pinline: Object.freeze([40, 60]),
  frame: Object.freeze([44, 57]),
  rules: Object.freeze([45, 57]),
  crown: Object.freeze([45, 55]),
  crownFloating: Object.freeze([40, 60]),
});

/** How provenance names a ramp (never a Card Conjurer file). */
export function rampName([from, to]) {
  return `procedural:ramp(${from}→${to} %W)`;
}

/** The second colour's share at `pct` % of the width (0..1). */
export function rampShare(pct, [from, to]) {
  if (!(to > from)) throw new Error(`pair-ramp: bad ramp ${from}→${to}`);
  return Math.min(1, Math.max(0, (pct - from) / (to - from)));
}

/**
 * An untilted horizontal ramp as an 8-bit RGBA mask of `width` × `height`
 * (black, alpha only): 0 left of `from` %W, 255 right of `to` %W, linear
 * between, measured at pixel centres; every row the same.
 */
export function rampMask(width, height, ramp) {
  const row = Buffer.alloc(width * 4);
  for (let x = 0; x < width; x += 1) {
    row[x * 4 + 3] = Math.round(rampShare(((x + 0.5) / width) * 100, ramp) * 255);
  }
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) row.copy(out, y * width * 4);
  return out;
}

/**
 * The premultiplied lerp of two 8-bit RGBA layers by a ramp mask's alpha t:
 * left · (1 − t) + right · t, in premultiplied space. Where both are opaque
 * it equals drawing `right` through the ramp over `left` (CC's stacking);
 * where both are translucent to the same alpha it keeps that alpha, which
 * stacking would raise. Returns 8-bit RGBA.
 */
export function lerpLayers(left, right, ramp) {
  if (left.length !== right.length || ramp.length !== left.length) {
    throw new Error("pair-ramp: layers and ramp must be the same size");
  }
  const out = Buffer.alloc(left.length);
  for (let o = 0; o < left.length; o += 4) {
    const t = ramp[o + 3] / 255;
    const al = (left[o + 3] / 255) * (1 - t);
    const ar = (right[o + 3] / 255) * t;
    const alpha = al + ar;
    for (let c = 0; c < 3; c += 1) {
      out[o + c] = alpha === 0 ? 0 : Math.round((left[o + c] * al + right[o + c] * ar) / alpha);
    }
    out[o + 3] = Math.round(alpha * 255);
  }
  return out;
}

/**
 * ONE call for a pair: `left` (the pair's first colour) and `right` (its
 * second), both `width` × `height` 8-bit RGBA covering the full card width,
 * blended across `ramp` (a PAIR_RAMPS entry). The pair masters blend each
 * split region's source this way before masking it; a pair crown band is
 * blendPair(leftBand, rightBand, 1500, 410, PAIR_RAMPS.crown) — or the same
 * on the 2010 × 2814 composites before the downscale.
 */
export function blendPair(left, right, width, height, ramp) {
  return lerpLayers(left, right, rampMask(width, height, ramp));
}

/** A pair's two colour letters, left first ("wu" → ["w", "u"]); throws on
 *  anything but one of the ten pairs in printed order. */
export function pairSides(pair) {
  if (!TWO_COLOR_PAIRS.includes(pair)) throw new Error(`pair-ramp: not a pair in printed order: ${pair}`);
  return [pair[0], pair[1]];
}

/**
 * Where a ramp's split sits on a row, for the checks and the print
 * measurement: given the second colour's share per pixel (0..1, one row or a
 * row profile), the first x (in % of the width, pixel centres) whose share
 * reaches each level. The builders' tests and the 4.6b pair sheet read the
 * masters' 10 / 50 / 90 % points with it.
 */
export function shareCrossings(shares, levels = [0.1, 0.5, 0.9]) {
  const width = shares.length;
  return levels.map((level) => {
    for (let x = 0; x < width; x += 1) if (shares[x] >= level) return ((x + 0.5) / width) * 100;
    return null;
  });
}
