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
//   node scripts/build-showcase-frames.mjs               # every family
//   node scripts/build-showcase-frames.mjs tarkirdragon  # one family
//
// A family with `plate` also gets its P/T plates: MSE paints each on a full
// card canvas, so it is upscaled like the frame and cropped to its alpha
// bounding box into public/frames/<name>/pt/<c>.png — the profile's
// pt.plateRect is that box in percent.
//
// A family with `underlays` bakes MSE's translucent box layers into the
// frame: each file is a full-card canvas that MSE draws UNDER card.png
// (lower z index) at `alpha` of its own opacity — Ghostfire's namebox /
// typebox / textbox at `set_alpha(…, 60%)`, the style's default opacity.
// Without them the frame is only card.png's outline (mean alpha ≈ 22).
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
  { name: "tarkirdragon", style: "tarkir-dragon-wing", pat: "card/{c}card.png", seeds: [[0.5, 0.28]], plate: "pt/{c}pt.png" },
  { name: "tarkirdraconic", style: "tarkir-draconic", pat: "card/{c}card.png", seeds: [[0.5, 0.28]], plate: "pt/{c}pt.png" },
  {
    name: "tarkirghostfire",
    style: "tarkir-ghostfire",
    pat: "card.png",
    seeds: [[0.5, 0.28]],
    // magic-m15-showcase-tarkir-ghostfire `style`: namebox/typebox/textbox at
    // z 220 with set_alpha(get_alpha_percentage(…, default: 60)), card.png at
    // z 230, pt.png (one plate for every colour) at z 840.
    underlays: { files: ["namebox.png", "typebox.png", "textbox.png"], alpha: 0.6 },
    plate: "pt.png",
  },
];

function srcFile(frame, color) {
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  if (frame.pat === "card.png") return path.join(base, "card.png");
  return path.join(base, frame.pat.replace("{c}", color));
}

/** A full-card MSE layer upscaled to W×H as raw RGBA, alpha scaled by `alpha`. */
async function layer(file, alpha = 1) {
  const { data } = await sharp(file)
    .resize(W, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (alpha !== 1) for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * alpha);
  return data;
}

/** The frame as raw RGBA: card art alone, or card art OVER its underlays. */
async function frameLayers(frame, color) {
  const card = await layer(srcFile(frame, color));
  if (!frame.underlays) return { data: card, info: { channels: 4 } };
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  const raw = { width: W, height: H, channels: 4 };
  const under = [];
  for (const f of frame.underlays.files) under.push(await layer(path.join(base, f), frame.underlays.alpha));
  return sharp({ create: { ...raw, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...under, card].map((input) => ({ input, raw })))
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function convert(frame, color) {
  const { data, info } = await frameLayers(frame, color);
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
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(out, `${color}.png`));
  return cut;
}

async function convertPlate(frame, color) {
  const src = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`, frame.plate.replace("{c}", color));
  const { data, info } = await sharp(src)
    .resize(W, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * ch + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const out = path.join("public/frames", frame.name, "pt");
  fs.mkdirSync(out, { recursive: true });
  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(out, `${color}.png`));
  return `${x0},${y0} ${x1 - x0 + 1}x${y1 - y0 + 1}`;
}

const only = process.argv[2];
if (only && !FRAMES.some((f) => f.name === only)) {
  console.error(`Unknown family ${only}. Known: ${FRAMES.map((f) => f.name).join(", ")}`);
  process.exit(1);
}
for (const frame of FRAMES.filter((f) => !only || f.name === only)) {
  let total = 0;
  for (const c of COLORS) total += await convert(frame, c);
  if (frame.plate) {
    const boxes = new Set();
    for (const c of COLORS) boxes.add(await convertPlate(frame, c));
    console.log(`${frame.name}: P/T plates cropped at ${[...boxes].join(" | ")}`);
  }
  console.log(
    `${frame.name}: cut ~${((total / 7 / (W * H)) * 100).toFixed(1)}% avg ← ${frame.style}`,
  );
}
console.log("done");
