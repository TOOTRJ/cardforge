// ---------------------------------------------------------------------------
// build-variation-frames.mjs — convert the five 2026-07 variation frames from
// Full-Magic-Pack MSE sources into app frames (public/frames/<name>/{7}.png,
// 1500×2100):
//
//   extendedart  magic-extended-art            *card.jpg,  WHITE art window
//   expedition   magic-m15-expedition          *lcard.jpg, BLACK art window
//   nyx          …showcase-theros-constellation card/*.png, already alpha-cut
//   fullart      …showcase-zendikar            *card.png,  already alpha-cut
//   fullartland  …full-art-basic-land-symbol   composite: shadow + pinline +
//                name + basictype pieces (the big mana symbol is deliberately
//                NOT baked in — the app's basic-land watermark renders it, so
//                it stays tint- and override-able)
//
//   node scripts/build-variation-frames.mjs
//
// All five start UNVERIFIED — they surface to users only after the owner
// checks them in /admin/frame-compare.
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const DATA = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const W = 1500;
const H = 2100;
const NEAR_BLACK = 60;
const NEAR_WHITE = 235;

/** Flood-fill the art window (seeded inside it) to alpha=0. Same approach as
 *  convert-mse-frame.mjs: BFS from the seed over near-fill pixels. maxYFrac
 *  clamps the fill vertically — extended-art's textbox is the same white as
 *  its art window and connected to it, so the flood must stop at the box. */
async function cutWindow(buf, fill, seeds, maxYFrac = 1) {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const matches = (i) =>
    fill === "black"
      ? data[i] + data[i + 1] + data[i + 2] <= NEAR_BLACK * 3
      : data[i] >= NEAR_WHITE && data[i + 1] >= NEAR_WHITE && data[i + 2] >= NEAR_WHITE;
  const queue = [];
  for (const [fx, fy] of seeds) {
    queue.push(Math.floor(height * fy) * width + Math.floor(width * fx));
  }
  const seen = new Uint8Array(width * height);
  let cut = 0;
  while (queue.length > 0) {
    const p = queue.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    if (Math.floor(p / width) > height * maxYFrac) continue;
    const i = p * 4;
    if (data[i + 3] === 0 || !matches(i)) continue;
    data[i + 3] = 0;
    cut++;
    const x = p % width;
    if (x > 0) queue.push(p - 1);
    if (x < width - 1) queue.push(p + 1);
    if (p >= width) queue.push(p - width);
    if (p < width * (height - 1)) queue.push(p + width);
  }
  return {
    png: await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer(),
    cutPct: ((cut / (width * height)) * 100).toFixed(1),
  };
}

async function writeOut(outDir, key, buf) {
  fs.mkdirSync(outDir, { recursive: true });
  await sharp(buf).resize(W, H, { fit: "fill" }).png().toFile(path.join(outDir, `${key}.png`));
}

const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

// 1+2. JPG families with a fill-colored art window ---------------------------
const JPG_SETS = [
  {
    out: "public/frames/extendedart",
    pack: `${DATA}/magic-extended-art.mse-style`,
    file: (k) => `${k}card.jpg`,
    fill: "white",
    seeds: [[0.5, 0.3]],
    // Stop at the textbox (white paper, connected to the window).
    maxYFrac: 0.6,
  },
  {
    out: "public/frames/expedition",
    pack: `${DATA}/magic-m15-expedition.mse-style`,
    file: (k) => `${k}lcard.jpg`,
    fill: "black",
    seeds: [[0.5, 0.3]],
  },
];

for (const set of JPG_SETS) {
  for (const key of COLORS) {
    const src = path.join(set.pack, set.file(key));
    const { png, cutPct } = await cutWindow(
      fs.readFileSync(src),
      set.fill,
      set.seeds,
      set.maxYFrac ?? 1,
    );
    await writeOut(set.out, key, png);
    console.log(`${path.basename(set.out)}/${key}.png  cut ${cutPct}% ← ${set.file(key)}`);
  }
}

// 3+4. PNG families already alpha-cut ----------------------------------------
const PNG_SETS = [
  {
    out: "public/frames/nyx",
    pack: `${DATA}/magic-m15-showcase-theros-constellation.mse-style/card`,
    file: (k) => `${k}card.png`,
  },
  {
    out: "public/frames/fullart",
    pack: `${DATA}/magic-m15-showcase-zendikar.mse-style`,
    file: (k) => `${k}card.png`,
  },
  // M15 Textless full art — the plain M15 border with an edge-to-edge art
  // window (no type plate, no text box painted). Already alpha-cut; the
  // creature/spell art (`{c}card.png`) and land (`{c}lcard.png`) variants
  // share the same border.
  {
    out: "public/frames/m15textless",
    pack: `${DATA}/magic-m15-textless.mse-style`,
    file: (k) => `${k}card.png`,
  },
  {
    out: "public/frames/m15textlessland",
    pack: `${DATA}/magic-m15-textless.mse-style`,
    file: (k) => `${k}lcard.png`,
  },
];

for (const set of PNG_SETS) {
  for (const key of COLORS) {
    await writeOut(set.out, key, fs.readFileSync(path.join(set.pack, set.file(key))));
    console.log(`${path.basename(set.out)}/${key}.png ← ${set.file(key)}`);
  }
}

// 5. Full-art basic land — composite the floating pieces ---------------------
{
  const pack = `${DATA}/magic-m15-full-art-basic-land-symbol.mse-style`;
  const out = "public/frames/fullartland";
  const shadow = path.join(pack, "shadow_card_basic_pinline.png");
  for (const key of COLORS) {
    // No multicolor basic exists — the m key wears the colorless dress.
    // NOTE: the pinline/ pieces are opaque full-card color underlays (MSE
    // masks them elsewhere) — compositing one would fill the whole card, so
    // only the floating bars + their shadows go in.
    const pieceKey = (dir, k) =>
      fs.existsSync(path.join(pack, dir, `${k}${dir}.png`)) ? k : "c";
    const pieces = [
      path.join(pack, "name", `${pieceKey("name", key)}name.png`),
      path.join(pack, "basictype", `${pieceKey("basictype", key)}basictype.png`),
    ];
    const base = await sharp(shadow).ensureAlpha().toBuffer();
    const composed = await sharp(base)
      .composite(pieces.map((p) => ({ input: p, left: 0, top: 0 })))
      .png()
      .toBuffer();
    await writeOut(out, key, composed);
    console.log(`fullartland/${key}.png ← shadow + pinline + name + basictype`);
  }
}

console.log("done");
