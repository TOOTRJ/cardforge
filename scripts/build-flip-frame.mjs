// ---------------------------------------------------------------------------
// build-flip-frame.mjs — convert the M15 Flip (Kamigawa) per-color frames.
//
// Unlike Adventure (a composite), the flip frame IS a static per-color JPG: a
// top creature (name → text box → type bar, upright) and a bottom creature
// (type → text → name, printed UPSIDE-DOWN) sharing one art window in the
// middle. So this is a straight convert — upscale 375×523 → 1500×2100 and
// flood-fill the single black art window to transparent (the bottom face's
// text is rendered rotated 180° by the layout profile, not the frame).
//
//   node scripts/build-flip-frame.mjs
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const PACK =
  "/Users/redjester/Projects/other/Full-Magic-Pack/data/magic-m15-flip.mse-style";
const OUT = "public/frames/flip";
const MAP = {
  w: "wcard.jpg",
  u: "ucard.jpg",
  b: "bcard.jpg",
  r: "rcard.jpg",
  g: "gcard.jpg",
  c: "ccard.jpg",
  m: "mcard.jpg",
};
const W = 1500;
const H = 2100;
const NEAR_BLACK = 60;
// The single shared art window is the middle black block (MSE y 162–346).
const SEEDS = [[0.5, 0.48]];

fs.mkdirSync(OUT, { recursive: true });

async function convert(colorKey, srcFile) {
  const { data, info } = await sharp(path.join(PACK, srcFile))
    .resize(W, H, { fit: "fill" })
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
  console.log(`${colorKey}.png  cut ${((cut / (W * H)) * 100).toFixed(1)}% ← ${srcFile}`);
}

for (const [key, file] of Object.entries(MAP)) await convert(key, file);
console.log(`done → ${OUT}`);
