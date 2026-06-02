// ---------------------------------------------------------------------------
// build-showcase-frames.mjs — convert the popular-set SHOWCASE frames.
//
// Recent MTG sets share the m15 base; their distinctive frame is the per-set
// SHOWCASE treatment. The Full-Magic-Pack stores these as per-color pieces in
// each style's `card/` subdir (or a single color-agnostic `card.png` for
// borderless treatments) plus masks. This upscales each to 1500×2100 and
// flood-fills the (white) art window(s) to alpha — the art window shape varies
// per frame (rectangular art-forward, or LOTR's circle), but the flood fill
// handles any shape from a seed.
//
//   node scripts/build-showcase-frames.mjs
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const PACK = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const W = 1500;
const H = 2100;
const NEAR_WHITE = 232;
const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

// pat: "{c}" → file is card/<c>card.png; "{c}." → card/<c>.png; "single" → card.png
const FRAMES = [
  { name: "avatar", style: "avatar-elemental", pat: "card/{c}.png", seeds: [[0.5, 0.24]] },
  { name: "bloomburrow", style: "bloomburrow-woodland", pat: "card/{c}card.png", seeds: [[0.5, 0.24]] },
  { name: "bloomanime", style: "bloomburrow-borderless-anime", pat: "card.png", seeds: [[0.5, 0.3]] },
  { name: "lotr", style: "lotr", pat: "card/{c}card.png", seeds: [[0.5, 0.36]] },
  { name: "lotrscroll", style: "lotr-scroll", pat: "card/{c}card.png", seeds: [[0.5, 0.3]] },
  { name: "tarkirdragon", style: "tarkir-dragon-wing", pat: "card/{c}card.png", seeds: [[0.5, 0.28]] },
  { name: "tarkirdraconic", style: "tarkir-draconic", pat: "card/{c}card.png", seeds: [[0.5, 0.28]] },
  { name: "tarkirghostfire", style: "tarkir-ghostfire", pat: "card.png", seeds: [[0.5, 0.28]] },
];

function srcFile(frame, color) {
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  if (frame.pat === "card.png") return path.join(base, "card.png");
  return path.join(base, frame.pat.replace("{c}", color));
}

async function convert(frame, color) {
  const { data, info } = await sharp(srcFile(frame, color))
    .resize(W, H, { fit: "fill" })
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
  for (const [fx, fy] of frame.seeds) {
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

  const out = path.join("public/frames", frame.name);
  fs.mkdirSync(out, { recursive: true });
  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .png()
    .toFile(path.join(out, `${color}.png`));
  return cut;
}

for (const frame of FRAMES) {
  let total = 0;
  for (const c of COLORS) total += await convert(frame, c);
  console.log(
    `${frame.name}: cut ~${((total / 7 / (W * H)) * 100).toFixed(1)}% avg ← ${frame.style}`,
  );
}
console.log("done");
