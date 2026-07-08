// ---------------------------------------------------------------------------
// remove-battle-circles.mjs — erase the baked indicator circles from the
// battle frame's title-bar ends. The "375 m15 battle" module bakes an MSE
// icon/indicator disc at each end of the floating name bar; until we render
// real transform-icon furniture, empty circles just look broken. Each disc
// is a solid color-tinted fill inside a dark rim, floating over TRANSPARENT
// art area — so we flood the fill from the disc center (the dark rim bounds
// the flood), then sweep the rim ring itself, setting alpha to 0.
//
//   node scripts/remove-battle-circles.mjs
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";

const DIR = "public/frames/battle";
const KEYS = ["w", "u", "b", "r", "g", "c", "m"];
// Disc centers as fractions of the 2100×1500 canvas (from the w scan).
const SEEDS = [
  [0.123, 0.079],
  [0.887, 0.079],
];
const TOL = 60; // per-channel distance from the seed fill color
const RIM_SWEEP = 4; // px of dark rim to clear around the flooded fill

for (const k of KEYS) {
  const file = path.join(DIR, `${k}.png`);
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const idx = (x, y) => (y * W + x) * 4;
  let cleared = 0;

  for (const [fx, fy] of SEEDS) {
    const sx = Math.round(W * fx);
    const sy = Math.round(H * fy);
    const si = idx(sx, sy);
    if (data[si + 3] === 0) continue; // already transparent (re-run safety)
    const seed = [data[si], data[si + 1], data[si + 2]];
    const near = (i) =>
      data[i + 3] > 0 &&
      Math.abs(data[i] - seed[0]) <= TOL &&
      Math.abs(data[i + 1] - seed[1]) <= TOL &&
      Math.abs(data[i + 2] - seed[2]) <= TOL;

    const flooded = new Set();
    const stack = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      const p = y * W + x;
      if (flooded.has(p)) continue;
      const i = p * 4;
      if (!near(i)) continue;
      flooded.add(p);
      if (x > 0) stack.push([x - 1, y]);
      if (x < W - 1) stack.push([x + 1, y]);
      if (y > 0) stack.push([x, y - 1]);
      if (y < H - 1) stack.push([x, y + 1]);
    }
    // Clear the fill, then the rim ring around it. The bar's parchment is a
    // different color family, so the flood never enters it; the rim sweep is
    // small enough to only nip the disc outline.
    for (const p of flooded) data[p * 4 + 3] = 0;
    for (const p of flooded) {
      const x = p % W;
      const y = (p / W) | 0;
      for (let dy = -RIM_SWEEP; dy <= RIM_SWEEP; dy++) {
        for (let dx = -RIM_SWEEP; dx <= RIM_SWEEP; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || xx >= W || yy < 0 || yy >= H) continue;
          const i = idx(xx, yy);
          // Only clear DARK pixels (the rim/outline), never the parchment bar.
          if (data[i + 3] > 0 && data[i] + data[i + 1] + data[i + 2] < 220) {
            data[i + 3] = 0;
          }
        }
      }
    }
    cleared += flooded.size;
  }

  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(file + ".tmp");
  await sharp(file + ".tmp").toFile(file);
  const fs = await import("node:fs");
  fs.rmSync(file + ".tmp");
  console.log(`${k}.png cleared ${cleared}px`);
}
