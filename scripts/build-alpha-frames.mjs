// ---------------------------------------------------------------------------
// build-alpha-frames.mjs — the Alpha (1993) masters, re-cut to the printed
// card's proportions.
//
//   node scripts/build-alpha-frames.mjs          # agclassic + alphaland
//   npm run assets:frame-webp                    # then the browser .webp twins
//
// SOURCE: MSE's Full-Magic-Pack `magic-agclassic.mse-style` — {k}card.jpg for
// agclassic, {k}lcard.jpg for alphaland (374 × 522, identical geometry in all
// 14 files). MSE drew that art on a SYMMETRIC 15 px black border (60 px at
// 1500 × 2100) with its own box proportions, so a plain 4× upscale (what
// scripts/convert-mse-frame.mjs did in 2026-06) is not the printed card:
//
//                    printed LEA/LEB (19 scans)   plain MSE upscale
//   black border      80 sides · 89 top · 100 bottom   60 · 60 · 60
//   art window        178–1319 × 219–1138          167–1332 × 199–1139
//   text box (outer)  186–1318 × 1247–1855         130–1370 × 1260–1903
//   P/T strip         1855–2000 (145 px)           1903–2040 (137 px)
//
// On the print the text box is NARROWER than the art box (it lines up with
// the art opening); MSE draws both boxes the same width. The aspect-ratio
// stretch of the old conversion (374 × 522 → 1500 × 2100, 0.3 %) is ~6 px —
// the difference is the source art, not the resize.
//
// THE RE-CUT: a piecewise-linear warp that sends every MSE feature line to
// the print's (numbers below; HD px, medians over 19 Scryfall LEA/LEB/2ED
// scans).
//   • y: one map for the boxes' columns, one for the side borders (below).
//   • x: two maps — ART rows (title band + art box) and TEXT rows (text box +
//     P/T strip) — blended with a smoothstep across the type band, where the
//     frame is plain texture. Both maps send the outer pinstripe to the same
//     place, so the frame's edges stay straight.
// The black border is left black, the art opening is cut to alpha 0 as an
// exact rectangle (lib/cards/template-layout.ts AGCLASSIC.artSlot covers it),
// and the card corners are an anti-aliased r = 60 px rounded rect (the old
// masters' corner, without its light fringe).
//
// THE LINES (owner decision 2026-09-25, "thin the lines to match the print"):
// a warp that only moves the box EDGES scales MSE's 1 px lines with the band
// around them, so the first release drew them ~2× the print's. Every line
// group now has its own knots, placed on the print's dark lines measured at
// half maximum on the same scans (medians; the box lines' centres vary ±4 px
// between colours on the print) — widths, first release → this cut → print:
//   outer pinstripe (frame edge → texture)   21–23 → 9–12 → 9–11
//   art box outline (MSE dark · light · dark)   7 → 3 → 2.7–3.9
//   text box outline + MSE's face ring + inner line   14–15 → 8 → 2.4–3
//     (the print has one ~3 px outline, then a shaded bevel in the box's own
//     colour; MSE rings the box in a band of frame colour between two dark
//     lines, which now take 3 + 4 + 1 px)
// The art box's face and the text box's textured area take the freed width,
// so the art opening and the frame's outer edges stay put; the text box's
// outline moves ≤ 5 px onto the print's (L 186 · R 1318 · T 1247 · B 1855).
//
// Nothing here is Card Conjurer-derived: the pixels are MSE's (the same
// source every other MSE frame in public/frames uses).
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
const SETS = [
  { out: path.join(OUT_ROOT, "agclassic"), file: (k) => `${k}card.jpg` },
  { out: path.join(OUT_ROOT, "alphaland"), file: (k) => `${k}lcard.jpg` },
];

// ── Feature lines: [print HD px, MSE source px] (pixel-EDGE coordinates) ───
// MSE source (374 × 522), identical in all 14 files:
//   pinstripe   x 15–19 / 354–358, y 15–19 / 502–506: two mid-tone px on the
//               black side, then dark · light · dark (black outside 15 / 359)
//   art box     outline dark · light · dark at x 32–34 / 339–341, y 40–42 /
//               290–292; bevel face x 35–38 / 335–338, y 43–46 / 286–289;
//               1 px black line x 39 / 334, y 47 / 285 around the opening
//               (x 40–333, y 48–284)
//   text box    outline x 32 / 341, y 313 / 472; face x 33–36 / 337–340,
//               y 314–317 / 468–471; inner line x 37 / 336, y 318 / 467;
//               shadow x 38–40 / 333–335, y 319–321 / 464–466; textured
//               area x 41–332, y 322–463
export const Y_MAP = [
  [0, 0],
  [89, 15], //      frame top (black → pinstripe)
  [99.5, 20], //    pinstripe → title band texture (print 99.6)
  [198, 40], //     art box outline, 1 px per source px (print 198.0–201.8)
  [201, 43],
  [216.5, 47], //   black line above the opening
  [219, 48], //     art opening top
  [1138, 285], //   art opening bottom
  [1140.5, 286],
  [1161, 290], //   art box outline (print 1160.5–1163.4)
  [1164, 293],
  [1247, 313], //   text box outline, 3 px (print 1247.0–1249.5)
  [1250, 314],
  [1254, 318], //   face, inner line: 1 px per source px
  [1255, 319],
  [1259, 322], //   textured area
  [1843, 464], //   textured area
  [1847, 467],
  [1848, 468], //   inner line, face: 1 px per source px
  [1852, 472], //   text box outline, 3 px (print 1852.3–1855.2)
  [1855, 473],
  [1990.5, 502], // P/T strip → pinstripe (print 1990.7)
  [2000, 507], //   frame bottom (pinstripe → black)
  [OUT_H, 522],
];
// The pinstripe lands at the same x in both maps, so the frame's sides stay
// straight across the type band.
const PIN_LEFT = [[80, 15], [90, 20]]; //          frame left, pinstripe end (print 81.2 / 90.2)
const PIN_RIGHT = [[1411, 354], [1421, 359]]; //  pinstripe end, frame right (print 1411.1 / 1422.3)
export const X_MAP_ART = [
  [0, 0],
  ...PIN_LEFT,
  [156, 32], //     art box outline (print 156.0–158.8): exactly 1 px per
  [159, 35], //     source px, so dark · light · dark resample cleanly
  [176, 39], //     black line
  [178, 40], //     art opening left
  [1319, 334], //   art opening right
  [1321.5, 335],
  [1344, 339], //   art box outline (print 1343.1–1347.2)
  [1347, 342],
  ...PIN_RIGHT,
  [OUT_W, 374],
];
export const X_MAP_TEXT = [
  [0, 0],
  ...PIN_LEFT,
  [186, 32], //     text box outline, 3 px (print 186.0–188.6)
  [189, 33],
  [193, 37], //     face, inner line: 1 px per source px
  [194, 38],
  [198, 41], //     textured area
  [1306, 333], //   textured area
  [1310, 336],
  [1311, 337], //   inner line, face: 1 px per source px
  [1315, 341], //   text box outline, 3 px (print 1315.5–1318.4)
  [1318, 342],
  ...PIN_RIGHT,
  [OUT_W, 374],
];
// Type band rows where the two x maps blend (strictly between the art box's
// bottom edge and the text box's top edge, so neither box bends).
const BLEND_Y0 = 1166;
const BLEND_Y1 = 1245;
// A box's line knots squeeze its source columns (rows) to ~1 px per source
// px; beyond the box the same source pixels are plain marble, where that
// squeeze leaves a visible seam. So each map has an OUTER twin used in the
// plain bands — the title band, the middle of the type band and the P/T
// strip for x; the side borders for y — with a smoothstep ramp onto the full
// map just outside each box (over 47 rows above the art box, 24 and 31 in
// the type band, 34 into the strip, 40 columns beside a box). The twins keep
// each box's outer edge but spread its bevel at ~2.4–3.3 px per source px,
// as the first release did everywhere, so the marble beside a box keeps the
// grain the owner approved.
const outerOf = (map, keep) => map.filter(([, s]) => keep.includes(s));
const TEXT_BEVEL = 9 * 2.4; // source 32 → 41 / 333 → 342, 313 → 322 / 464 → 473
export const X_MAP_ART_OUTER = outerOf(X_MAP_ART, [0, 15, 20, 32, 40, 334, 342, 354, 359, 374]);
export const X_MAP_TEXT_OUTER = [
  ...outerOf(X_MAP_TEXT, [0, 15, 20, 32]),
  [186 + TEXT_BEVEL, 41],
  [1318 - TEXT_BEVEL, 333],
  ...outerOf(X_MAP_TEXT, [342, 354, 359, 374]),
];
export const Y_MAP_SIDES = [
  ...outerOf(Y_MAP, [0, 15, 20, 40, 48, 285, 293, 313]),
  [1247 + TEXT_BEVEL, 322],
  [1855 - TEXT_BEVEL, 464],
  ...outerOf(Y_MAP, [473, 502, 507, 522]),
];
/** Rows below this use the text box's column span for the y ramp (the full
 *  and side y maps agree across the whole type band). */
const TYPE_BAND_MID = 1206;
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

/** The art map blended into the text map by `w` (the type band's blend). */
function xMapAt(artMap, textMap, x, w) {
  const ua = piecewise(artMap, x);
  return w === 0 ? ua : ua + (piecewise(textMap, x) - ua) * w;
}

/** Smoothstep from 0 at `a` to 1 at `b` (either direction). */
function ramp(t, a, b) {
  const s = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return s * s * (3 - 2 * s);
}

function blendWeight(y) {
  return ramp(y, BLEND_Y0, BLEND_Y1);
}

/** 1 on the rows the boxes' vertical lines run through, 0 in the plain bands. */
function xLineWeight(y) {
  if (y < TYPE_BAND_MID) return Math.min(ramp(y, 150, 197), ramp(y, 1190, 1166));
  return Math.min(ramp(y, 1215, 1246), ramp(y, 1890, 1856));
}

/** 1 on the columns the boxes' horizontal lines span, 0 in the side borders. */
function yLineWeight(x, y) {
  const [left, right] = y < TYPE_BAND_MID ? [156, 1347] : [186, 1318];
  return Math.min(ramp(x, left - 40, left - 1), ramp(x, right + 40, right + 1));
}

// Catmull-Rom cubic — sharper than bilinear, less ringing than Lanczos on
// the 1 px bevel lines (every output scale here is a 2.4–7× upscale).
function cubic(t) {
  const a = Math.abs(t);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}

function roundedCornerAlpha(x, y) {
  // Coverage of the pixel centre by the card's rounded rect (1 px AA ramp).
  const cx = x < CORNER_R ? CORNER_R : x > OUT_W - CORNER_R ? OUT_W - CORNER_R : null;
  const cy = y < CORNER_R ? CORNER_R : y > OUT_H - CORNER_R ? OUT_H - CORNER_R : null;
  if (cx === null || cy === null) return 1;
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, CORNER_R - d + 0.5));
}

async function build(srcFile, outFile) {
  const { data: src, info } = await sharp(srcFile)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const SW = info.width;
  const SH = info.height;
  const SC = info.channels;
  if (SW !== 374 || SH !== 522) throw new Error(`${srcFile}: expected 374×522, got ${SW}×${SH}`);
  const out = Buffer.alloc(OUT_W * OUT_H * 4);
  const [ax0, ay0, ax1, ay1] = ART_OPENING;
  for (let Y = 0; Y < OUT_H; Y += 1) {
    const yc = Y + 0.5;
    const vBox = piecewise(Y_MAP, yc);
    const vSide = piecewise(Y_MAP_SIDES, yc);
    const w = blendWeight(yc);
    const lw = xLineWeight(yc);
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
      // Source pixel-centre coordinates.
      const v = (vBox === vSide ? vBox : vSide + (vBox - vSide) * yLineWeight(xc, yc)) - 0.5;
      const vy = Math.floor(v);
      const wy = [cubic(v - (vy - 1)), cubic(v - vy), cubic(v - (vy + 1)), cubic(v - (vy + 2))];
      const uOuter = lw === 1 ? 0 : xMapAt(X_MAP_ART_OUTER, X_MAP_TEXT_OUTER, xc, w);
      const uBox = lw === 0 ? 0 : xMapAt(X_MAP_ART, X_MAP_TEXT, xc, w);
      const u = (lw === 1 ? uBox : lw === 0 ? uOuter : uOuter + (uBox - uOuter) * lw) - 0.5;
      const ux = Math.floor(u);
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < 4; j += 1) {
        const sy = Math.min(SH - 1, Math.max(0, vy - 1 + j));
        for (let i = 0; i < 4; i += 1) {
          const sx = Math.min(SW - 1, Math.max(0, ux - 1 + i));
          const k = wy[j] * cubic(u - (ux - 1 + i));
          const s = (sy * SW + sx) * SC;
          r += src[s] * k;
          g += src[s + 1] * k;
          b += src[s + 2] * k;
        }
      }
      out[o] = Math.max(0, Math.min(255, Math.round(r)));
      out[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      out[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  await sharp(out, { raw: { width: OUT_W, height: OUT_H, channels: 4 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(outFile);
}

// Run only as a script, never on import.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  for (const set of SETS) {
    fs.mkdirSync(set.out, { recursive: true });
    for (const k of KEYS) {
      const src = path.join(PACK, set.file(k));
      const dst = path.join(set.out, `${k}.png`);
      await build(src, dst);
      console.log(`${dst} ← ${set.file(k)}`);
    }
  }
  console.log("done — now run `npm run assets:frame-webp`");
}
