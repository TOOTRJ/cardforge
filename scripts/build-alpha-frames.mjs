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
//   text box (outer)  185–1314 × 1252–1853         130–1370 × 1260–1903
//   P/T strip         1853–2000 (147 px)           1903–2040 (137 px)
//
// On the print the text box is NARROWER than the art box (it lines up with
// the art opening); MSE draws both boxes the same width. The aspect-ratio
// stretch of the old conversion (374 × 522 → 1500 × 2100, 0.3 %) is ~6 px —
// the difference is the source art, not the resize.
//
// THE RE-CUT: a piecewise-linear warp that sends every MSE feature line to
// the print's (numbers below; HD px, measured as the strongest luminance edge
// on 19 Scryfall LEA/LEB/2ED scans — the medians of the clean detections).
//   • y: one map for every column (the bands are full-width).
//   • x: two maps — ART rows (title band + art box) and TEXT rows (text box +
//     P/T strip) — blended with a smoothstep across the type band, where the
//     frame is plain texture. Both maps send the outer pinstripe to the same
//     place, so the frame's edges stay straight.
// The black border is left black, the art opening is cut to alpha 0 as an
// exact rectangle (lib/cards/template-layout.ts AGCLASSIC.artSlot covers it),
// and the card corners are an anti-aliased r = 60 px rounded rect (the old
// masters' corner, without its light fringe).
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
// MSE source (374 × 522): black 0–14; pinstripe 15–19; art box bevel line
// x 32–34 / y 40–42, bevel face to the 1 px black line at x 39 / y 47, white
// opening from x 40 / y 48 to x 333 / y 284; text box outer line x 32 & 341,
// y 313 & 472, its textured area x 40–332 / y 322–463; bottom pinstripe
// 502–506; black from 507 (x from 359).
export const Y_MAP = [
  [0, 0],
  [89, 15], //      frame top (black → pinstripe)
  [197, 40], //     art box outer edge (top)
  [219, 48], //     art opening top
  [1138, 285], //   art opening bottom
  [1159, 293], //   art box outer edge (bottom)
  [1252, 313], //   text box outer edge (top)
  [1273, 322], //   text box inner edge — MSE's 9 px bevel at ~2.3 px/px,
  [1832, 464], //   like the art box's (the print's bevels are ~10–20 px)
  [1853, 473], //   text box outer edge (bottom)
  [2000, 507], //   frame bottom (pinstripe → black)
  [OUT_H, 522],
];
// The pinstripe inner edge (source 20 / 354) lands at the same x in both
// maps: 5 source px at the art map's outer scale.
const PIN_L = 80 + (5 * (159 - 80)) / (32 - 15);
const PIN_R = 1421 - (5 * (1421 - 1347)) / (359 - 342);
export const X_MAP_ART = [
  [0, 0],
  [80, 15], //      frame left
  [PIN_L, 20],
  [159, 32], //     art box outer edge
  [178, 40], //     art opening left
  [1319, 334], //   art opening right
  [1347, 342], //   art box outer edge
  [PIN_R, 354],
  [1421, 359], //   frame right
  [OUT_W, 374],
];
export const X_MAP_TEXT = [
  [0, 0],
  [80, 15],
  [PIN_L, 20],
  [185, 32], //     text box outer edge (left)
  [204, 40], //     text box inner edge
  [1293, 333], //   text box inner edge
  [1314, 342], //   text box outer edge (right)
  [PIN_R, 354],
  [1421, 359],
  [OUT_W, 374],
];
// Type band rows where the two x maps blend (strictly between the art box's
// bottom edge and the text box's top edge, so neither box bends).
const BLEND_Y0 = 1166;
const BLEND_Y1 = 1245;
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

function blendWeight(y) {
  if (y <= BLEND_Y0) return 0;
  if (y >= BLEND_Y1) return 1;
  const t = (y - BLEND_Y0) / (BLEND_Y1 - BLEND_Y0);
  return t * t * (3 - 2 * t);
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
    const v = piecewise(Y_MAP, yc) - 0.5; // source pixel-centre coordinate
    const w = blendWeight(yc);
    const vy = Math.floor(v);
    const wy = [cubic(v - (vy - 1)), cubic(v - vy), cubic(v - (vy + 1)), cubic(v - (vy + 2))];
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
      const ua = piecewise(X_MAP_ART, xc);
      const u = (w === 0 ? ua : ua + (piecewise(X_MAP_TEXT, xc) - ua) * w) - 0.5;
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
