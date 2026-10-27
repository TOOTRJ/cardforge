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
// (`lotrscroll` left this builder with TODO 4.11, layout v62: Card Conjurer's
// 'Scroll' pack through scripts/import-cc-frames.mjs, frames bucket — it must
// never come back to public/frames. `lotr` left with it too, layout v65:
// Card Conjurer's 'Ring' pack, the same way — and `tarkirdragon`, layout
// v67: Card Conjurer's 'Tarkir' pack.)
//
//   node scripts/build-showcase-frames.mjs               # every family
//   node scripts/build-showcase-frames.mjs tarkirdraconic  # one family
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
//
// A family listed in MSE_SHOWCASE_BORDERS (scripts/lib/mse-showcase-
// borders.mjs; TODO 4.11 / 4.35, layout v68) gets the border MSE paints at
// render time and its PNGs leave out — painted UNDER the drawing in the
// border black, cut at the one card corner: Tarkir draconic's band below
// and beside its dragons, Tarkir ghostfire's black ring and footer.
//
// A family with `stampNotch` also gets the holofoil stamp's notch as MSE
// draws it on a stamped card (TODO 4.11, an opt-in per card): the style's
// `card stamp border` (the border colour through stamp_border_mask.png —
// the black well) under its `card stamp rim` (stamp/<c>stamp.png — the text
// box's rim arched over the well), on one full-card canvas upscaled like
// the frame and cropped to its box into public/frames/<name>holostamp/
// <c>.png — the profile's holoStamp rect is that box in percent.
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
import { MSE_SHOWCASE_BORDERS, PALETTE_PNG_OPTIONS, borderLost, paintShowcaseBorder } from "./lib/mse-showcase-borders.mjs";

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
  {
    name: "tarkirdraconic",
    style: "tarkir-draconic",
    pat: "card/{c}card.png",
    seeds: [[0.5, 0.28]],
    plate: "pt/{c}pt.png",
    // magic-m15-showcase-tarkir-draconic `style`: the `card stamp border`
    // (border colour through stamp_border_mask.png) under the `card stamp
    // rim` (stamp/<c>stamp.png), both full-card canvases.
    stampNotch: { well: "stamp_border_mask.png", rim: "stamp/{c}stamp.png" },
    // The colourless dress as the run prints it (TODO 4.11, layout v68;
    // raw scan medians against MSE's files over the same pixels): the
    // colourless ARTIFACTS (TDM #323 Boulderborn Dragon, #324 Dragonfire
    // Blade, #325 Mox Jasper) wear MSE's steel `a` drawing — its dragons
    // 78,94,99 against print's 75,91,97, its paper and bars within 3 levels
    // — written as the master `a` (the profile's artifactMasterKeys c → a);
    // the run's one colourless non-artifact (#326 Maelstrom of the Spirit
    // Dragon, a land) wears the GOLD frame — MSE's `m`: dragons 140,104,51
    // against 139,101,46, paper and bars within 5 — written as `c`. MSE's own
    // brown `c` (dragons 116,71,47, 53 levels off the steel) is no print's.
    // The plate follows the colour key, and the only colourless card that
    // prints a P/T is an artifact (#323): `c`'s plate is the steel `a`'s.
    // The stamp notch follows the master drawn: `a` the steel rim, `c` the
    // gold (#326 is a stamped rare).
    keys: ["w", "u", "b", "r", "g", "c", "m", "a"],
    sourceKeys: {
      card: { c: "m", a: "a" },
      plate: { c: "a", a: "a" },
      stamp: { c: "m", a: "a" },
    },
  },
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

/** The MSE file key a master / plate / notch key is drawn from (`kind`
 *  card | plate | stamp): its own unless the family maps it. */
function sourceKey(frame, kind, color) {
  return frame.sourceKeys?.[kind]?.[color] ?? color;
}

function srcFile(frame, color) {
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  if (frame.pat === "card.png") return path.join(base, "card.png");
  return path.join(base, frame.pat.replace("{c}", sourceKey(frame, "card", color)));
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

  const bordered = Boolean(MSE_SHOWCASE_BORDERS[frame.name]);
  let cov = null;
  if (bordered) {
    if (ch !== 4) throw new Error(`${frame.name}/${color}: expected RGBA`);
    cov = paintShowcaseBorder(frame.name, data, W, H, frame.seeds);
  }

  const out = path.join("public/frames", frame.name);
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${color}.png`);
  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .png(bordered ? PALETTE_PNG_OPTIONS : { compressionLevel: 9, effort: 10 })
    .toFile(file);
  if (bordered) {
    const { data: written } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const lost = borderLost(cov, written);
    if (lost) throw new Error(`${file}: the palette encode left ${lost} pixels of the border see-through`);
  }
  return cut;
}

/** The stamp notch: the black well (the border colour through the well
 *  mask) under the rim piece, on one W×H canvas, cropped to its alpha box
 *  (α > 8) into public/frames/<name>holostamp/<c>.png. */
async function convertStampNotch(frame, color) {
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  const { data: well } = await sharp(path.join(base, frame.stampNotch.well))
    .resize(W, H, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rim = await layer(path.join(base, frame.stampNotch.rim.replace("{c}", sourceKey(frame, "stamp", color))));
  const data = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p += 1) data[p * 4 + 3] = well[p];
  // The rim OVER the well (straight alpha).
  for (let p = 0; p < W * H; p += 1) {
    const o = p * 4;
    const a = rim[o + 3] / 255;
    const b = data[o + 3] / 255;
    const outA = a + b * (1 - a);
    if (outA <= 0) continue;
    for (let k = 0; k < 3; k += 1) data[o + k] = Math.round((rim[o + k] * a + data[o + k] * b * (1 - a)) / outA);
    data[o + 3] = Math.round(outA * 255);
  }
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const out = path.join("public/frames", `${frame.name}holostamp`);
  fs.mkdirSync(out, { recursive: true });
  await sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .png({ compressionLevel: 9, effort: 10 })
    .toFile(path.join(out, `${color}.png`));
  return `${x0},${y0} ${x1 - x0 + 1}x${y1 - y0 + 1}`;
}

async function convertPlate(frame, color) {
  const src = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`, frame.plate.replace("{c}", sourceKey(frame, "plate", color)));
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
  const keys = frame.keys ?? COLORS;
  for (const c of keys) total += await convert(frame, c);
  if (frame.plate) {
    const boxes = new Set();
    for (const c of keys) boxes.add(await convertPlate(frame, c));
    console.log(`${frame.name}: P/T plates cropped at ${[...boxes].join(" | ")}`);
  }
  if (frame.stampNotch) {
    const boxes = new Set();
    for (const c of keys) boxes.add(await convertStampNotch(frame, c));
    console.log(`${frame.name}: stamp notches cropped at ${[...boxes].join(" | ")}`);
  }
  console.log(
    `${frame.name}: cut ~${((total / keys.length / (W * H)) * 100).toFixed(1)}% avg ← ${frame.style}`,
  );
}
console.log("done");
