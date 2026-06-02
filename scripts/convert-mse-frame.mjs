// ---------------------------------------------------------------------------
// convert-mse-frame.mjs — turn Full-Magic-Pack MSE frame art into app frames.
//
// The MSE source frames are 375×523 JPGs whose art window is a solid black box
// enclosed by the painted plates. This script upscales a frame set to the app's
// 1500×2100 and flood-fills the black art window to transparent so the user's
// art renders behind the frame (the painted slot border stays on top). The
// outer black card border is never touched because the cream plates isolate the
// art window from it.
//
// HOW TO ADD A FRAME
//   1. Point PACK at your Full-Magic-Pack `.mse-include/cards/<set>` dir.
//   2. Set OUT to public/frames/<name> and fill MAP with color → source file.
//   3. If the frame's art window isn't near (50%,33%), adjust SEEDS. For frames
//      with two cut-outs (planeswalker), add a second seed point.
//   4. node scripts/convert-mse-frame.mjs
//   5. Add the frame to FRAME_TEMPLATE_VALUES (types/card.ts) + a profile in
//      lib/cards/template-layout.ts.
//
// Requires `sharp` (already a dependency). Run from the project root.
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

// ── Config: edit these for each frame set ──────────────────────────────────
const PACK =
  "/Users/redjester/Projects/other/Full-Magic-Pack/data/magic-modules.mse-include/cards/375 m15 cut";
const OUT = "public/frames/m15land";
const MAP = {
  w: "wlcard.jpg",
  u: "ulcard.jpg",
  b: "blcard.jpg",
  r: "rlcard.jpg",
  g: "glcard.jpg",
  c: "clcard.jpg",
  m: "mlcard.jpg",
};
// Seed point(s) inside each art window, as fractions of the card (x, y).
const SEEDS = [[0.5, 0.33]];
// ───────────────────────────────────────────────────────────────────────────

const W = 1500;
const H = 2100;
const NEAR_BLACK = 60; // r+g+b ≤ this counts as the black art fill

fs.mkdirSync(OUT, { recursive: true });

async function convert(colorKey, srcFile) {
  const { data, info } = await sharp(path.join(PACK, srcFile))
    .resize(W, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const idx = (x, y) => (y * W + x) * ch;
  const isBlack = (i) =>
    data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] <= NEAR_BLACK;

  const seen = new Uint8Array(W * H);
  let cut = 0;
  // Scanline flood fill from each seed over connected near-black pixels.
  for (const [fx, fy] of SEEDS) {
    const stack = [[Math.round(W * fx), Math.round(H * fy)]];
    while (stack.length) {
      const [sx, sy] = stack.pop();
      let x = sx;
      while (x >= 0 && isBlack(idx(x, sy))) x--;
      x++;
      let up = false;
      let down = false;
      while (x < W && isBlack(idx(x, sy))) {
        const p = sy * W + x;
        if (!seen[p]) {
          seen[p] = 1;
          data[idx(x, sy) + 3] = 0;
          cut++;
        }
        if (sy > 0) {
          const a = isBlack(idx(x, sy - 1));
          if (a && !up) stack.push([x, sy - 1]);
          up = a;
        }
        if (sy < H - 1) {
          const b = isBlack(idx(x, sy + 1));
          if (b && !down) stack.push([x, sy + 1]);
          down = b;
        }
        x++;
      }
    }
  }

  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .png()
    .toFile(path.join(OUT, `${colorKey}.png`));
  console.log(
    `${colorKey}.png  cut ${((cut / (W * H)) * 100).toFixed(1)}% ← ${srcFile}`,
  );
}

for (const [key, file] of Object.entries(MAP)) await convert(key, file);
console.log(`done → ${OUT}`);
