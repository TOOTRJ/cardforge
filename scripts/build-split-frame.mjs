// ---------------------------------------------------------------------------
// build-split-frame.mjs — composite the M15 Split frame (landscape).
//
// A split card is read with the card turned sideways: two half-cards side by
// side, each a full mini-card (name/cost → art → type → rules). MSE stores a
// per-color HALF frame (240×345); the full 523×375 landscape card is two halves
// composited with a black spine between them. Our color model has ONE color
// identity, so both halves use the same color (a two-color split renders as the
// multicolor frame on both halves — an accepted simplification).
//
// This places the half at the left + right slots on a black landscape canvas
// and flood-fills BOTH art windows to transparent (the left art comes from the
// front art, the right from the back-face art).
//
//   node scripts/build-split-frame.mjs
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const PACK =
  "/Users/redjester/Projects/other/Full-Magic-Pack/data/magic-m15-planeshifted-split.mse-style";
const OUT = "public/frames/split";
const MAP = {
  w: "wcard.jpg",
  u: "ucard.jpg",
  b: "bcard.jpg",
  r: "rcard.jpg",
  g: "gcard.jpg",
  c: "ccard.jpg",
  m: "mcard.jpg",
};
const W = 2100; // landscape canvas (523 × ~4.0)
const H = 1500; // 375 × 4.0
const NEAR_BLACK = 60;
// Half placement (MSE card color: left 15 / 268, top 15, 240×345 → ×~4).
const HALF_W = 964;
const HALF_H = 1380;
const TOP_Y = 60;
const LEFT_X = 60;
const RIGHT_X = 1076;
// One seed inside each art window (MSE image centers, as canvas fractions).
const SEEDS = [
  [0.256, 0.349],
  [0.74, 0.349],
];

fs.mkdirSync(OUT, { recursive: true });

async function build(colorKey, srcFile) {
  const half = await sharp(path.join(PACK, srcFile))
    .resize(HALF_W, HALF_H, { fit: "fill" })
    .toBuffer();
  const composited = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: half, left: LEFT_X, top: TOP_Y },
      { input: half, left: RIGHT_X, top: TOP_Y },
    ])
    .png()
    .toBuffer();

  const { data, info } = await sharp(composited)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const idx = (x, y) => (y * W + x) * ch;
  const isTarget = (i) =>
    data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] <= NEAR_BLACK;

  const seen = new Uint8Array(W * H);
  let cut = 0;
  for (const [fx, fy] of SEEDS) {
    const stack = [[Math.round(W * fx), Math.round(H * fy)]];
    while (stack.length) {
      const [sx, sy] = stack.pop();
      let x = sx;
      while (x >= 0 && isTarget(idx(x, sy))) x--;
      x++;
      let up = false;
      let down = false;
      while (x < W && isTarget(idx(x, sy))) {
        const p = sy * W + x;
        if (!seen[p]) {
          seen[p] = 1;
          data[idx(x, sy) + 3] = 0;
          cut++;
        }
        if (sy > 0) {
          const a = isTarget(idx(x, sy - 1));
          if (a && !up) stack.push([x, sy - 1]);
          up = a;
        }
        if (sy < H - 1) {
          const b = isTarget(idx(x, sy + 1));
          if (b && !down) stack.push([x, sy + 1]);
          down = b;
        }
        x++;
      }
    }
  }

  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(OUT, `${colorKey}.png`));
  console.log(`${colorKey}.png  cut ${((cut / (W * H)) * 100).toFixed(1)}% ← ${srcFile} ×2`);
}

for (const [key, file] of Object.entries(MAP)) await build(key, file);
console.log(`done → ${OUT}`);
