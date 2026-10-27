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
import {
  ANIME_NAMEBOX,
  ANIME_STROKE_RGB,
  ANIME_TEXTBOX,
  BORDERED_PNG_ATTEMPTS,
  MSE_SHOWCASE_BORDERS,
  borderLost,
  maskCoverage,
  paintOver,
  paintShowcaseBorder,
  showcaseBorderRgb,
} from "./lib/mse-showcase-borders.mjs";

const PACK = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const W = 1500;
const H = 2100;
const NEAR_WHITE = 232;
const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

// pat: "{c}" → file is card/<c>card.png; "{c}." → card/<c>.png; "single" → card.png
const FRAMES = [
  {
    name: "avatar",
    style: "avatar-elemental",
    pat: "card/{c}.png",
    seeds: [[0.5, 0.24]],
    // magic-m15-showcase-avatar-elemental `style` (TODO 4.11, layout v69):
    // the ornate title bar is the `crown` layer (z 190, crown/<c>.png),
    // drawn UNDER the card (z 200) — and every printing wears it, legendary
    // or not (TLA #336–353, TLE #305–317; MSE's `noncrown` plain bar has no
    // print), so it is part of every master. The border (z 150, through
    // border_borderless_mask.png: the black footer) is painted under both by
    // MSE_SHOWCASE_BORDERS.
    underlays: { files: ["crown/{c}.png"], alpha: 1 },
    plate: "pt/{c}.png",
    // Every colourless printing of the run is an ARTIFACT (TLE #315 Arcane
    // Signet, #316 Sol Ring, #317 Swiftfoot Boots) and wears MSE's silver
    // `a` drawing (its frame 136,152,160 against print's 136,153,160); MSE's
    // own `c` is brown (138,98,30), no print's. So `c` is built from `a` —
    // frame, title bar and plate alike.
    sourceKeys: { card: { c: "a" }, underlay: { c: "a" }, plate: { c: "a" } },
  },
  {
    name: "bloomburrow",
    style: "bloomburrow-woodland",
    pat: "card/{c}card.png",
    seeds: [[0.5, 0.24]],
    // magic-m15-showcase-bloomburrow-woodland `style` (TODO 4.11, layout
    // v69): the footer in the colour's own tone is MSE's `card colored
    // border` (MSE_SHOWCASE_BORDERS), the legendary crown its `crown` layer
    // (z 800, crown/<c>crown.png, over the card: an overlay band), the
    // stamp its `card stamp rim` (stamp/<c>stamp.png) over the coloured well
    // (`card stamp colored border` through border_stamp_mask.png).
    plate: "pt/{c}pt.png",
    crown: "crown/{c}crown.png",
    stampNotch: { well: "border_stamp_mask.png", rim: "stamp/{c}stamp.png" },
  },
  {
    name: "bloomanime",
    style: "bloomburrow-borderless-anime",
    pat: "card.png",
    seeds: [[0.5, 0.3]],
    // magic-m15-showcase-bloomburrow-borderless-anime `style` (TODO 4.11 /
    // 4.35, layout v70): a RECOLOUR template (flat red strokes MSE recolours
    // at render), drawn as ONE master for every key in MSE's z order — the
    // name and text boxes (z 150, set_alpha(recolor_image(…), 70 %)), the
    // border colour through border_pt_mask.png (z 200: the footer), the
    // strokes (card.png z 210, the P/T dress's nonptpt.png z 840) — with
    // print's numbers (scripts/lib/mse-showcase-borders.mjs ANIME_*). Every
    // print has a P/T, so the master is the P/T dress (textbox_pt.png's tab,
    // nonptpt.png's shorter stroke); the P/T box's outline (pt.png) is the
    // plate.
    layered: {
      boxes: [
        { file: "namebox.png", ...ANIME_NAMEBOX },
        { file: "textbox_pt.png", ...ANIME_TEXTBOX },
      ],
      footer: "border_pt_mask.png",
      strokes: ["card.png", "nonptpt.png"],
    },
    tone: ANIME_STROKE_RGB,
    plate: "pt.png",
    crown: "crown.png",
    stampNotch: { well: "border_stamp_mask.png", rim: "stamp.png" },
  },
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
    // raw scan medians against MSE's files over the same pixels): every
    // colourless printing of the run is an ARTIFACT (TDM #323 Boulderborn
    // Dragon, #324 Dragonfire Blade, #325 Mox Jasper) and wears MSE's STEEL
    // `a` drawing — its dragons 78,94,99 against print's 75,91,97, its paper
    // and bars within 3 levels — so `c` is built from it, with the steel
    // plate and the steel stamp rim. MSE's own brown `c` (dragons 116,71,47,
    // 53 levels off the steel) is no print's. (#326 Maelstrom of the Spirit
    // Dragon, a land that taps for any colour, prints the GOLD frame: the
    // importer's land rule reads it as gold, the `m` master — not `c`.)
    sourceKeys: {
      card: { c: "a" },
      plate: { c: "a" },
      stamp: { c: "a" },
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

/** A full-card MSE layer upscaled to W×H as raw RGBA, alpha scaled by
 *  `alpha`; `rgb` recolours it flat (a recolour template's red). */
async function layer(file, alpha = 1, rgb = null) {
  const { data } = await sharp(file)
    .resize(W, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (alpha !== 1) for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * alpha);
  if (rgb) for (let i = 0; i < data.length; i += 4) [data[i], data[i + 1], data[i + 2]] = rgb;
  return data;
}

/** Straight-alpha source-over of `top` onto `base` (in place). */
function over(base, top) {
  for (let o = 0; o < base.length; o += 4) {
    const a = top[o + 3] / 255;
    if (a <= 0) continue;
    const b = base[o + 3] / 255;
    const outA = a + b * (1 - a);
    for (let k = 0; k < 3; k += 1) base[o + k] = Math.round((top[o + k] * a + base[o + k] * b * (1 - a)) / outA);
    base[o + 3] = Math.round(outA * 255);
  }
}

/** A `layered` family's ONE master (every key the same bytes), in MSE's z
 *  order: the recoloured boxes, the footer over them through the style's
 *  border mask (cut at the card corner), the strokes in the flat tone. */
const layeredCache = new Map();
async function layeredMaster(frame) {
  if (layeredCache.has(frame.name)) return layeredCache.get(frame.name);
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  const data = Buffer.alloc(W * H * 4);
  for (const box of frame.layered.boxes) over(data, await layer(path.join(base, box.file), box.alpha, box.rgb));
  const { data: grey } = await sharp(path.join(base, frame.layered.footer)).resize(W, H, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const cov = maskCoverage(grey, W, H, Boolean(MSE_SHOWCASE_BORDERS[frame.name]?.keepCorners));
  paintOver(data, cov, showcaseBorderRgb(frame.name, "w"));
  for (const f of frame.layered.strokes) over(data, await layer(path.join(base, f), 1, frame.tone));
  const out = { data, cov };
  layeredCache.set(frame.name, out);
  return out;
}

/** The frame as raw RGBA: card art alone, or card art OVER its underlays. */
async function frameLayers(frame, color) {
  const card = await layer(srcFile(frame, color));
  if (!frame.underlays) return { data: card, info: { channels: 4 } };
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  const raw = { width: W, height: H, channels: 4 };
  const under = [];
  for (const f of frame.underlays.files) under.push(await layer(path.join(base, f.replace("{c}", sourceKey(frame, "underlay", color))), frame.underlays.alpha));
  return sharp({ create: { ...raw, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...under, card].map((input) => ({ input, raw })))
    .raw()
    .toBuffer({ resolveWithObject: true });
}

async function convert(frame, color) {
  if (frame.layered) {
    const { data, cov } = await layeredMaster(frame);
    const out = path.join("public/frames", frame.name);
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `${color}.png`);
    for (const [i, opts] of BORDERED_PNG_ATTEMPTS.entries()) {
      const buf = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png(opts).toBuffer();
      const { data: written } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const lost = borderLost(cov, written);
      if (lost) {
        console.log(`${file}: encoding ${i} left ${lost} border pixels see-through — next`);
        continue;
      }
      fs.writeFileSync(file, buf);
      if (i > 0) console.log(`${file}: written with encoding ${i}`);
      return 0;
    }
    throw new Error(`${file}: no encoding kept the border whole`);
  }
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
    cov = paintShowcaseBorder(frame.name, data, W, H, frame.seeds, color);
  }

  const out = path.join("public/frames", frame.name);
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `${color}.png`);
  if (!bordered) {
    await sharp(data, { raw: { width: W, height: H, channels: ch } }).png({ compressionLevel: 9, effort: 10 }).toFile(file);
  } else {
    // The first encoding whose decoded border is whole (BORDERED_PNG_ATTEMPTS).
    let done = false;
    for (const [i, opts] of BORDERED_PNG_ATTEMPTS.entries()) {
      const buf = await sharp(data, { raw: { width: W, height: H, channels: ch } }).png(opts).toBuffer();
      const { data: written } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const lost = borderLost(cov, written);
      if (lost) {
        console.log(`${file}: encoding ${i} left ${lost} border pixels see-through — next`);
        continue;
      }
      fs.writeFileSync(file, buf);
      if (i > 0) console.log(`${file}: written with encoding ${i}`);
      done = true;
      break;
    }
    if (!done) throw new Error(`${file}: no encoding kept the border whole`);
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
  const rim = await layer(path.join(base, frame.stampNotch.rim.replace("{c}", sourceKey(frame, "stamp", color))), 1, frame.tone ?? null);
  // The well in the border's own colour (black, or the woodland's coloured
  // footer: MSE's `colored border` under the rim).
  const rgb = showcaseBorderRgb(frame.name, color) ?? [0, 0, 0];
  const data = Buffer.alloc(W * H * 4);
  for (let p = 0; p < W * H; p += 1) {
    data[p * 4] = rgb[0];
    data[p * 4 + 1] = rgb[1];
    data[p * 4 + 2] = rgb[2];
    data[p * 4 + 3] = well[p];
  }
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

/** The legendary crown: MSE's full-card `crown` layer, upscaled like the
 *  frame and cropped to its alpha box (α > 8) into public/frames/
 *  <name>crown/<c>.png — the profile's crown overlay rect is that box. */
async function convertCrown(frame, color) {
  const base = path.join(PACK, `magic-m15-showcase-${frame.style}.mse-style`);
  const data = await layer(path.join(base, frame.crown.replace("{c}", sourceKey(frame, "crown", color))), 1, frame.tone ?? null);
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
  const out = path.join("public/frames", `${frame.name}crown`);
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
  if (frame.tone) for (let i = 0; i < data.length; i += ch) [data[i], data[i + 1], data[i + 2]] = frame.tone;
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
  if (frame.crown) {
    const boxes = new Set();
    for (const c of keys) boxes.add(await convertCrown(frame, c));
    console.log(`${frame.name}: crowns cropped at ${[...boxes].join(" | ")}`);
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
