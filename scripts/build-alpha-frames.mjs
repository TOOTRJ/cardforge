// ---------------------------------------------------------------------------
// build-alpha-frames.mjs — the Alpha (1993) masters, re-cut to the printed
// card's proportions and line widths.
//
//   node scripts/build-alpha-frames.mjs          # agclassic + alphaland
//   npm run assets:frame-webp                    # then the browser .webp twins
//
// SOURCE: MSE's Full-Magic-Pack `magic-agclassic.mse-style` — {k}card.jpg for
// agclassic, {k}lcard.jpg for alphaland (374 × 522, identical geometry in all
// 15 files). agclassic's colourless master is acard.jpg, MSE's ARTIFACT card
// (TODO 4.31): every colourless Alpha card is an artifact, printed on a dark
// warm-brown border with a light crackle text box (Sol Ring, Juggernaut,
// Clockwork Beast, Rod of Ruin, Jayemdae Tome, Obsianus Golem); ccard.jpg is
// MSE's flat grey for a colourless NON-artifact, which Alpha never printed.
// alphaland keeps clcard.jpg: Alpha printed no colourless land, the old-border
// colourless lands (Library of Alexandria, Urza's lands, Mishra's Factory)
// print on the same brown land frame as the basics, and MSE has no artifact
// land card. MSE drew that art on a SYMMETRIC 15 px black border (60 px at
// 1500 × 2100) with its own box proportions, so a plain 4× upscale (what
// scripts/convert-mse-frame.mjs did in 2026-06) is not the printed card:
//
//                    printed LEA/LEB (19 scans)   plain MSE upscale
//   black border      80 sides · 89 top · 100 bottom   60 · 60 · 60
//   art window        178–1319 × 219–1138          167–1332 × 199–1139
//   text box (outer)  186–1318 × 1247–1855         130–1370 × 1260–1903
//   P/T strip         1855–1991 (136 px)           1903–2040 (137 px)
//
// On the print the text box is NARROWER than the art box (it lines up with
// the art opening); MSE draws both boxes the same width. The aspect-ratio
// stretch of the old conversion (374 × 522 → 1500 × 2100, 0.3 %) is ~6 px —
// the difference is the source art, not the resize.
//
// THE RE-CUT: a piecewise-linear warp that sends every MSE line to the
// print's (HD px; the dark lines' centres are medians of luminance minima,
// the boxes' edges medians of half-maximum crossings). Every line has its own
// knots — one source px per ~1.5–3 HD px on a dark line, more on a land's
// coloured one — and a knot may CUT source pixels out, so MSE's structure can
// be re-drawn the print's way:
//
//   agclassic (19 LEA/LEB non-land scans)
//     pinstripe   the print: a light band, then ONE ~3 px dark line
//                 (L 88 · T 98 · R 1412.5 · B 1992.5). MSE: two mid-tone px,
//                 then dark · light · dark → its light px is cut.
//     art box     one ~3 px outline (L 157.5 · T 199.5 · R 1345.5 ·
//                 B 1162.5), then the bevel face: MSE's light centre is cut.
//     text box    one ~3 px outline (L 186 · T 1247 · R 1318.5 · B 1855
//                 outer edges), then a shaded bevel in the box's own colour
//                 to the textured area (L 201 · T 1265 · R 1299.5 · B 1835).
//                 MSE rings the box in a band of saturated frame colour
//                 between two dark lines, then a 3 px bevel; the print has no
//                 ring, so the ring and its inner line are cut and MSE's
//                 bevel takes the print's 12–20 px.
//   alphaland (7 LEA/LEB basic-land scans) — the land print keeps MSE's
//   structure, in the land's colour:
//     pinstripe   light band, then dark · colour · dark (~8 px: L 85.5–94 ·
//                 T 98–106 · R 1405–1414 · B 1984.5–1993)
//     art box     dark · colour · dark (~13 px) OUTSIDE the non-land
//                 outline: 145–158 · 189.5–202 · 1344.5–1356.5 · 1161–1172
//     text box    outline, a 12–17 px coloured ring, inner line (outer edges
//                 187 · 1249 · 1318 · 1854.5; inner line L 202.75 ·
//                 T 1267.75 · R 1296.75 · B 1836.25)
//
// Outside a box the same source pixels are plain marble, where a box's knots
// would leave a seam. So each map has an OUTER twin for the plain bands (the
// title band, the type band and the P/T strip for x; the side borders for y):
// it matches the box map up to the box's outer edge, then crosses the box's
// span on a smooth (C1) ramp, so the marble changes scale without a kink.
// The switch between a map and its twin is hard and sits on the box's outer
// outline, which hides it. In the type band the art and text twins blend
// with a smoothstep.
//
// The black border is left black, the art opening is cut to alpha 0 as an
// exact rectangle (lib/cards/template-layout.ts AGCLASSIC.artSlot covers it),
// and the card corners are an anti-aliased r = 60 px rounded rect (the old
// masters' corner, without its light fringe).
//
// Nothing here is Card Conjurer-derived: every pixel is interpolated from
// MSE's (the same source every other MSE frame in public/frames uses).
// ---------------------------------------------------------------------------
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const PACK =
  process.env.MSE_AGCLASSIC_DIR ??
  "/Users/redjester/Projects/other/Full-Magic-Pack/data/magic-agclassic.mse-style";
const OUT_W = 1500;
const OUT_H = 2100;
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
// ALPHA_OUT_ROOT writes somewhere else (a scratch folder) for a dry run.
const OUT_ROOT = process.env.ALPHA_OUT_ROOT ?? "public/frames";
// ALPHA_FULL_COLOUR=1 skips the palette (dry runs only): the exact values
// the committed palette masters approximate, which
// tests/unit/frames/alpha-master-specks.test.ts probes at the ring corners.
const FULL_COLOUR = process.env.ALPHA_FULL_COLOUR === "1";

// ── Knots: [print HD px, MSE source px] (pixel-EDGE coordinates) ───────────
// MSE source (374 × 522), identical in all 15 files:
//   pinstripe   x 15–19 / 354–358, y 15–19 / 502–506: two mid-tone px on the
//               black side, then dark · light · dark (black outside 15 / 359)
//   art box     outline dark · light · dark at x 32–34 / 339–341, y 40–42 /
//               290–292; bevel face x 35–38 / 335–338, y 43–46 / 286–289;
//               1 px black line x 39 / 334, y 47 / 285 around the opening
//               (x 40–333, y 48–284)
//   text box    outline x 32 / 341, y 313 / 472; ring x 33–36 / 337–340,
//               y 314–317 / 468–471; inner line x 37 / 336, y 318 / 467;
//               bevel x 38–40 / 333–335, y 319–321 / 464–466; textured
//               area x 41–332, y 322–463
// On {k}lcard the pinstripe's and the art outline's light px and the text
// box's ring are the land's colour.
// A knot [t, a, b] is a CUT: source pixels a … b − 1 are skipped at t, and
// the sampler reads a − 1 and b as neighbours, so nothing cut bleeds in.
const AGCLASSIC = {
  y: [
    [0, 0],
    [89, 15], //         frame top
    [96.5, 17], //       mid-tone band (the print's light band)
    [98, 18, 19], //     one dark line (print 97.8), MSE's light px cut
    [99.5, 20], //       title band (print 99.6)
    [198, 40], //        art box outline (print 198.0–201.8)
    [199.5, 41, 42],
    [201, 43],
    [216.5, 47], //      black line above the opening
    [219, 48], //        art opening top
    [1138, 285], //      art opening bottom
    [1140.5, 286],
    [1161, 290], //      art box outline (print 1160.5–1163.4)
    [1162.5, 291, 292],
    [1164, 293],
    [1247, 313], //      text box outline (print 1247.0–1249.5)
    [1250, 314, 319], // ring + inner line cut
    [1265, 322], //      bevel → textured area (print 1265)
    [1835, 464], //      textured area → bevel (print 1835)
    [1852, 467, 472],
    [1855, 473], //      text box outline (print 1852.3–1855.2)
    [1991, 502], //      P/T strip → pinstripe (print 1990.7)
    [1992.5, 503, 504], // one dark line (print 1992.8)
    [1994, 505],
    [2000, 507], //      frame bottom
    [OUT_H, 522],
  ],
  xArt: [
    [0, 0],
    [80, 15], //         frame left
    [86.5, 17],
    [88, 18, 19], //     one dark line (print 87.8)
    [89.5, 20], //       (print pinstripe end 90.2)
    [156, 32], //        art box outline (print 156.0–158.8)
    [157.5, 33, 34],
    [159, 35],
    [176, 39], //        black line
    [178, 40], //        art opening left
    [1319, 334], //      art opening right
    [1321.5, 335],
    [1344, 339], //      art box outline (print 1343.1–1347.2)
    [1345.5, 340, 341],
    [1347, 342],
    [1411, 354], //      pinstripe (print end 1411.1, dark line 1412.5)
    [1412.5, 355, 356],
    [1414, 357],
    [1421, 359], //      frame right
    [OUT_W, 374],
  ],
  xText: [
    [0, 0],
    [80, 15],
    [86.5, 17],
    [88, 18, 19],
    [89.5, 20],
    [186, 32], //        text box outline (print 186.0–188.6)
    [189, 33, 38], //    ring + inner line cut
    [201, 41], //        bevel → textured area (print 201)
    [1299.5, 333], //    textured area → bevel (print 1299.5)
    [1315.5, 336, 341],
    [1318.5, 342], //    text box outline (print 1315.5–1318.4)
    [1411, 354],
    [1412.5, 355, 356],
    [1414, 357],
    [1421, 359],
    [OUT_W, 374],
  ],
  /** The boxes' outer edges, HD px [x0, y0, x1, y1). */
  art: [156, 198, 1347, 1164],
  text: [186, 1247, 1318.5, 1855],
};
// Land print medians (7 basics): outer dark line / coloured band / inner
// dark line — pinstripe L 86.5 / 88–91 / 93.5 · R 1413 / 1408–1412 / 1406.5 ·
// T 99.5 / 100–104.5 / 105.5 · B 1992.5 / 1987–1990 / 1985.5; art box border
// L 145.5 / 148–154 / 157.5 · R 1355.5 / 1349–1353 / 1345.5 · T 190.5 /
// 192–198 / 201.5 · B 1171.5 / 1163–1169 / 1162.5; text box (outline / ring /
// inner line) L 188.5 / 191.5–201.5 / 202.5 · R 1317.5 / 1298–1313 / 1296.5 ·
// T 1250.5 / 1253–1267 / 1268.5 · B 1853.5 / 1838–1850.5 / 1836.5.
const ALPHALAND = {
  y: [
    [0, 0],
    [89, 15],
    [98, 17], //         pinstripe: dark · colour · dark
    [100, 18],
    [103.5, 19],
    [106, 20],
    [189.5, 40], //      art box border
    [191.5, 41],
    [199.5, 42],
    [202, 43],
    [216.5, 47],
    [219, 48],
    [1138, 285],
    [1140.5, 286],
    [1161, 290], //      art box border
    [1163.5, 291],
    [1169.5, 292],
    [1172, 293],
    [1249, 313], //      text box outline
    [1252, 314], //      coloured ring
    [1266.5, 318], //    inner line
    [1269, 319],
    [1272, 322],
    [1832, 464],
    [1835, 467], //      inner line
    [1837.5, 468], //    coloured ring
    [1851.5, 472], //    outline
    [1854.5, 473],
    [1984.5, 502], //    pinstripe
    [1986.5, 503],
    [1990.5, 504],
    [1993, 505],
    [2000, 507],
    [OUT_H, 522],
  ],
  xArt: [
    [0, 0],
    [80, 15],
    [85.5, 17], //       pinstripe
    [87.5, 18],
    [91.5, 19],
    [94, 20],
    [145, 32], //        art box border
    [147.5, 33],
    [155.5, 34],
    [158, 35],
    [176, 39],
    [178, 40],
    [1319, 334],
    [1321.5, 335],
    [1344.5, 339], //    art box border
    [1347, 340],
    [1354, 341],
    [1356.5, 342],
    [1405, 354], //      pinstripe
    [1407.5, 355],
    [1411.5, 356],
    [1414, 357],
    [1421, 359],
    [OUT_W, 374],
  ],
  xText: [
    [0, 0],
    [80, 15],
    [85.5, 17],
    [87.5, 18],
    [91.5, 19],
    [94, 20],
    [187, 32], //        text box outline
    [190, 33], //        coloured ring
    [201.5, 37], //      inner line
    [204, 38],
    [207, 41],
    [1292.5, 333],
    [1295.5, 336], //    inner line
    [1298, 337], //      coloured ring
    [1314.5, 341], //    outline
    [1318, 342],
    [1405, 354],
    [1407.5, 355],
    [1411.5, 356],
    [1414, 357],
    [1421, 359],
    [OUT_W, 374],
  ],
  art: [145, 189.5, 1356.5, 1172],
  text: [187, 1249, 1318, 1854.5],
};
const SETS = [
  // c ← acard.jpg: the Alpha colourless card is the artifact card (see SOURCE).
  { out: path.join(OUT_ROOT, "agclassic"), file: (k) => `${k === "c" ? "a" : k}card.jpg`, maps: AGCLASSIC },
  { out: path.join(OUT_ROOT, "alphaland"), file: (k) => `${k}lcard.jpg`, maps: ALPHALAND },
];
/** The transparent art opening, HD px [x0, y0, x1, y1). */
export const ART_OPENING = [178, 219, 1319, 1138];
/** The coloured frame (outside it: black border), HD px [x0, y0, x1, y1). */
export const FRAME = [80, 89, 1421, 2000];
const CORNER_R = 60;

function piecewise(map, t) {
  for (let i = 1; i < map.length; i += 1) {
    const [t1, s1] = map[i];
    if (t <= t1 || i === map.length - 1) {
      const [t0, s0] = map[i - 1];
      return s0 + ((t - t0) * (s1 - s0)) / (t1 - t0);
    }
  }
  return map[map.length - 1][1];
}

/** Smoothstep from 0 at `a` to 1 at `b` (either direction). */
function ramp(t, a, b) {
  const s = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return s * s * (3 - 2 * s);
}

/**
 * `map` with the span (t0, t1) — a box, seen from the plain bands beside it —
 * replaced by a C1 ramp: it leaves t0 and reaches t1 at the slopes the map has
 * just outside them, easing (over `rampLen` px) to the constant slope that
 * covers the same source span. Returned as dense plain knots (every 2 px).
 */
function smoothSpan(map, t0, t1, rampLen = 120) {
  const i0 = map.findIndex(([t]) => t === t0);
  const i1 = map.findIndex(([t]) => t === t1);
  const plain = (k) => map[k].length === 2;
  if (i0 < 1 || i1 < 0 || i1 + 1 >= map.length || !plain(i0 - 1) || !plain(i0) || !plain(i1) || !plain(i1 + 1)) {
    throw new Error(`smoothSpan: ${t0}–${t1} must sit between plain knots`);
  }
  const [a, sa] = map[i0];
  const [b, sb] = map[i1];
  const slopeIn = (sa - map[i0 - 1][1]) / (a - map[i0 - 1][0]);
  const slopeOut = (map[i1 + 1][1] - sb) / (map[i1 + 1][0] - b);
  const len = b - a;
  const r = Math.min(rampLen, len / 4);
  const mid = (sb - sa - (r * (slopeIn + slopeOut)) / 2) / (len - r);
  const slope = (t) =>
    t < a + r ? slopeIn + (mid - slopeIn) * ramp(t, a, a + r) : t > b - r ? mid + (slopeOut - mid) * ramp(t, b - r, b) : mid;
  const knots = [];
  let s = sa;
  const dt = 0.05;
  for (let t = a; t < b - 1e-9; t += dt) {
    s += slope(t + dt / 2) * dt;
    const at = Math.round((t + dt) * 20) / 20;
    if (at < b && Math.abs(at / 2 - Math.round(at / 2)) < 1e-6) knots.push([at, s]);
  }
  // Numerical drift (≪ 0.01 source px) is spread evenly so t1 lands exactly.
  const err = s - sb;
  const fixed = knots.map(([t, v]) => [t, v - (err * (t - a)) / len]);
  return [...map.slice(0, i0 + 1), ...fixed, ...map.slice(i1)];
}

/**
 * A map in COMPACT source coordinates (every cut closed up) plus the table
 * back to real source pixels, so the sampler's taps never land on a cut px.
 */
function compile(map) {
  const knots = [];
  const cuts = []; // [compact px index where the gap sits, width]
  let removed = 0;
  for (const [t, a, b] of map) {
    knots.push([t, a - removed]);
    if (b !== undefined) {
      cuts.push([a - removed, b - a]);
      removed += b - a;
    }
  }
  const real = (k) => {
    let r = k;
    for (const [at, width] of cuts) if (k >= at) r += width;
    return r;
  };
  return { knots, real, key: JSON.stringify(cuts) };
}

// Catmull-Rom cubic — sharper than bilinear, less ringing than Lanczos on
// the 1 px lines (every output scale here is a 1.5–8× upscale). What little
// it still rings is clamped away in build() (see "Anti-ringing").
function cubic(t) {
  const a = Math.abs(t);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}

/** The 4 taps (real source px, clamped) and weights around compact coord `c`. */
function taps(map, c, size) {
  const u = c - 0.5; // pixel-centre coordinate
  const k = Math.floor(u);
  const idx = [];
  const w = [];
  for (let i = -1; i <= 2; i += 1) {
    idx.push(Math.min(size - 1, Math.max(0, map.real(k + i))));
    w.push(cubic(u - (k + i)));
  }
  return { idx, w };
}

function roundedCornerAlpha(x, y) {
  // Coverage of the pixel centre by the card's rounded rect (1 px AA ramp).
  const cx = x < CORNER_R ? CORNER_R : x > OUT_W - CORNER_R ? OUT_W - CORNER_R : null;
  const cy = y < CORNER_R ? CORNER_R : y > OUT_H - CORNER_R ? OUT_H - CORNER_R : null;
  if (cx === null || cy === null) return 1;
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, CORNER_R - d + 0.5));
}

/** Every map a set samples, compiled, plus the per-column / per-row taps. */
function plan(maps, SW, SH) {
  const [artL, artT, artR, artB] = maps.art;
  const [textL, textT, textR, textB] = maps.text;
  const yBox = compile(maps.y);
  const ySide = compile(smoothSpan(smoothSpan(maps.y, artT, artB), textT, textB));
  const xArt = compile(maps.xArt);
  const xText = compile(maps.xText);
  const xArtOuter = compile(smoothSpan(maps.xArt, artL, artR));
  const xTextOuter = compile(smoothSpan(maps.xText, textL, textR));
  // The type band blends the two outer x maps, so they must share their cuts.
  if (xArtOuter.key !== xTextOuter.key) throw new Error("outer x maps differ in their cuts");
  const columns = (m) => Array.from({ length: OUT_W }, (_, X) => taps(m, piecewise(m.knots, X + 0.5), SW));
  const col = { art: columns(xArt), text: columns(xText) };
  const outerArt = Array.from({ length: OUT_W }, (_, X) => piecewise(xArtOuter.knots, X + 0.5));
  const outerText = Array.from({ length: OUT_W }, (_, X) => piecewise(xTextOuter.knots, X + 0.5));
  // Type band rows where the outer x maps blend (clear of both boxes).
  const blend0 = artB + 2;
  const blend1 = textT - 2;
  const typeMid = (artB + textT) / 2;
  return {
    /** Per row: how to sample x (per column) and y (box or side column). */
    row(Y) {
      const yc = Y + 0.5;
      const inArt = Y >= artT && Y < artB;
      const inText = Y >= textT && Y < textB;
      let xs;
      if (inArt) xs = col.art;
      else if (inText) xs = col.text;
      else {
        const w = ramp(yc, blend0, blend1);
        xs = outerArt.map((ua, X) => taps(xArtOuter, w === 0 ? ua : ua + (outerText[X] - ua) * w, SW));
      }
      const [x0, x1] = Y < typeMid ? [artL, artR] : [textL, textR];
      return {
        xs,
        box: taps(yBox, piecewise(yBox.knots, yc), SH),
        side: taps(ySide, piecewise(ySide.knots, yc), SH),
        /** The box's own y map only between its outer outlines. */
        yFor: (X) => X >= x0 && X < x1,
      };
    },
  };
}

async function build(srcFile, outFile, maps) {
  const { data: src, info } = await sharp(srcFile)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const SW = info.width;
  const SH = info.height;
  const SC = info.channels;
  if (SW !== 374 || SH !== 522) throw new Error(`${srcFile}: expected 374×522, got ${SW}×${SH}`);
  const sampler = plan(maps, SW, SH);
  const out = Buffer.alloc(OUT_W * OUT_H * 4);
  const [ax0, ay0, ax1, ay1] = ART_OPENING;
  for (let Y = 0; Y < OUT_H; Y += 1) {
    const yc = Y + 0.5;
    const rowPlan = sampler.row(Y);
    for (let X = 0; X < OUT_W; X += 1) {
      const o = (Y * OUT_W + X) * 4;
      if (X >= ax0 && X < ax1 && Y >= ay0 && Y < ay1) {
        out[o + 3] = 0; // art opening
        continue;
      }
      const xc = X + 0.5;
      out[o + 3] = Math.round(255 * roundedCornerAlpha(xc, yc));
      // The black border is painted, not sampled: the warp stretches MSE's
      // own corner (white outside its r = 15 px curve) far past its edge.
      if (X < FRAME[0] - 2 || X >= FRAME[2] + 2 || Y < FRAME[1] - 2 || Y >= FRAME[3] + 2) continue;
      const ty = rowPlan.yFor(X) ? rowPlan.box : rowPlan.side;
      const tx = rowPlan.xs[X];
      let r = 0;
      let g = 0;
      let b = 0;
      // Each channel's range over the 16 taps (see "Anti-ringing" below).
      let rLo = 255;
      let rHi = 0;
      let gLo = 255;
      let gHi = 0;
      let bLo = 255;
      let bHi = 0;
      for (let j = 0; j < 4; j += 1) {
        const rowOff = ty.idx[j] * SW;
        for (let i = 0; i < 4; i += 1) {
          const k = ty.w[j] * tx.w[i];
          const s = (rowOff + tx.idx[i]) * SC;
          const sr = src[s];
          const sg = src[s + 1];
          const sb = src[s + 2];
          r += sr * k;
          g += sg * k;
          b += sb * k;
          if (sr < rLo) rLo = sr;
          if (sr > rHi) rHi = sr;
          if (sg < gLo) gLo = sg;
          if (sg > gHi) gHi = sg;
          if (sb < bLo) bLo = sb;
          if (sb > bHi) bHi = sb;
        }
      }
      // Anti-ringing: Catmull-Rom's negative lobes overshoot a hard edge —
      // by up to ~20 levels where two of MSE's lines meet at a ring corner
      // (30 at worst), a colour none of the 16 taps has. That alone is
      // invisible, but the palette encode below then snaps those few rare
      // colours to whatever palette entry is nearest, which can be a
      // different hue: unclamped, alphaland/u's ring corners came out as
      // 159,177,189 specks in a 78,123,170 ring and w's as cream dots.
      // Clamping each channel to its taps' range removes the overshoot and
      // with it every ring-corner speck; the lines stay as sharp (the clamp
      // only acts beyond the taps' own extremes).
      out[o] = Math.round(Math.max(rLo, Math.min(rHi, r)));
      out[o + 1] = Math.round(Math.max(gLo, Math.min(gHi, g)));
      out[o + 2] = Math.round(Math.max(bLo, Math.min(bHi, b)));
    }
  }
  // `effort: 10` turns on sharp's palette mode (≤ 256 colours, dithered).
  // Kept on purpose: a full-colour master is ~4× the bytes (~3 MB vs
  // ~0.7 MB), and with the clamp above the ring corners hold no colour the
  // palette maps to a speck.
  await sharp(out, { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
    .png(FULL_COLOUR ? { compressionLevel: 9, palette: false } : { compressionLevel: 9, effort: 10 })
    .toFile(outFile);
}

// Run only as a script, never on import.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  for (const set of SETS) {
    fs.mkdirSync(set.out, { recursive: true });
    for (const k of KEYS) {
      const src = path.join(PACK, set.file(k));
      const dst = path.join(set.out, `${k}.png`);
      await build(src, dst, set.maps);
      console.log(`${dst} ← ${set.file(k)}`);
    }
  }
  console.log("done — now run `npm run assets:frame-webp`");
}
