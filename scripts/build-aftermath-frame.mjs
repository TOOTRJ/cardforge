// ---------------------------------------------------------------------------
// build-aftermath-frame.mjs — stack the M15 Aftermath frame.
//
// An aftermath card: a normal TOP half (cast from hand) plus a BOTTOM half
// rotated 90° (cast from the graveyard). MSE stores the two halves as separate
// per-color pieces already in their final orientation — wcard.png (375×285,
// top, upright) and wcard2.png (375×238, bottom, pre-rotated sideways). This
// stacks them into the 1500×2100 card and flood-fills BOTH art windows (white
// boxes, like the Alpha frames) to alpha: the top half's, and the bottom
// half's sideways window (MSE "image 2" at 314,295 183×108 angle 270 → card
// space x 54.9–83.7%, y 56.4–91.4%). The bottom text renders rotated 270°.
//
//   node scripts/build-aftermath-frame.mjs
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const PACK =
  "/Users/redjester/Projects/other/Full-Magic-Pack/data/magic-m15-aftermath.mse-style";
const OUT = "public/frames/aftermath";
const MAP = {
  w: "wcard",
  u: "ucard",
  b: "bcard",
  r: "rcard",
  g: "gcard",
  c: "ccard",
  m: "mcard",
};
const W = 1500;
const H = 2100;
const NEAR_WHITE = 235;
const TOP_H = 1144; // 285 × 2100/523
const BOT_H = H - TOP_H; // 956
// Art window centers as canvas fractions: top (MSE 29,59–346,176) and the
// bottom half's sideways window (MSE image 2).
const SEEDS = [
  [0.5, 0.2],
  [0.693, 0.739],
];

fs.mkdirSync(OUT, { recursive: true });

async function build(colorKey, stem) {
  const top = await sharp(path.join(PACK, `${stem}.png`))
    .resize(W, TOP_H, { fit: "fill" })
    .toBuffer();
  const bottom = await sharp(path.join(PACK, `${stem}2.png`))
    .resize(W, BOT_H, { fit: "fill" })
    .toBuffer();
  const stacked = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: top, left: 0, top: 0 },
      { input: bottom, left: 0, top: TOP_H },
    ])
    .png()
    .toBuffer();

  const { data, info } = await sharp(stacked)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const idx = (x, y) => (y * W + x) * ch;
  const isTarget = (i) =>
    data[i + 3] > 0 &&
    data[i] >= NEAR_WHITE &&
    data[i + 1] >= NEAR_WHITE &&
    data[i + 2] >= NEAR_WHITE;

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
  console.log(`${colorKey}.png  cut ${((cut / (W * H)) * 100).toFixed(1)}% ← ${stem}.png + ${stem}2.png`);
}

for (const [key, stem] of Object.entries(MAP)) await build(key, stem);
console.log(`done → ${OUT}`);
