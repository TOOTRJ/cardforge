// ---------------------------------------------------------------------------
// build-era-frames.mjs — convert the older-border standard frames (1997 retro,
// 2003 modern, Future Sight) from the Full-Magic-Pack MSE styles into the app's
// 1500×2100 per-color frame PNGs, flood-filling the art window to transparent.
//
// Same flood-fill engine as scripts/convert-mse-frame.mjs, but driven by a
// config TABLE so the three eras (+ their land/token variants) convert in one
// run and the conversion is reproducible/documented. Run from the project root:
//
//   node scripts/build-era-frames.mjs [name ...]   # all, or just the named sets
//
// Each FRAMES entry:
//   out    public/frames/<name>
//   pack   absolute dir holding the MSE source JPG/PNGs
//   map    { colorKey: sourceFile }  (app contract w/u/b/r/g/c/m)
//   fill   "white" | "black"  — the art-window fill to cut to transparent
//   seeds  [[xFrac, yFrac], …] — point(s) inside the art window
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const PACK_ROOT = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const OUT_W = 1500;
const OUT_H = 2100;
const NEAR_BLACK = 60;
const NEAR_WHITE = 232;

// 1997 retro (magic-old): white art window, brown artifact frame for colorless,
// gold for multicolor. Land + token are separate MSE styles.
const oldMap = {
  w: "wcard.jpg",
  u: "ucard.jpg",
  b: "bcard.jpg",
  r: "rcard.jpg",
  g: "gcard.jpg",
  c: "acard.jpg",
  m: "mcard.jpg",
};
const oldLandMap = {
  w: "wlcard.jpg",
  u: "ulcard.jpg",
  b: "blcard.jpg",
  r: "rlcard.jpg",
  g: "glcard.jpg",
  c: "clcard.jpg",
  m: "mlcard.jpg",
};

// 2003 modern (magic-new): white art window (the standard frame's window is the
// light card stock), artifact frame for colorless, gold for multicolor.
const newMap = {
  w: "wcard.jpg",
  u: "ucard.jpg",
  b: "bcard.jpg",
  r: "rcard.jpg",
  g: "gcard.jpg",
  c: "acard.jpg",
  m: "mcard.jpg",
};
const newLandMap = {
  w: "wlcard.jpg",
  u: "ulcard.jpg",
  b: "blcard.jpg",
  r: "rlcard.jpg",
  g: "glcard.jpg",
  c: "clcard.jpg",
  m: "mlcard.jpg",
};

// Future Sight (magic-future): the standard frames are JPGs; the textbox /
// typeline / P/T overlays ship as pre-cut PNGs (handled separately if needed).
const futureMap = {
  w: "wcard.jpg",
  u: "ucard.jpg",
  b: "bcard.jpg",
  r: "rcard.jpg",
  g: "gcard.jpg",
  c: "acard.jpg",
  m: "mcard.jpg",
};

const FRAMES = {
  retro: {
    out: "public/frames/retro",
    pack: `${PACK_ROOT}/magic-old.mse-style`,
    map: oldMap,
    fill: "white",
    seeds: [[0.5, 0.27]],
  },
  retroland: {
    out: "public/frames/retroland",
    pack: `${PACK_ROOT}/magic-old.mse-style`,
    map: oldLandMap,
    fill: "white",
    seeds: [[0.5, 0.27]],
  },
  modern: {
    out: "public/frames/modern",
    pack: `${PACK_ROOT}/magic-new.mse-style`,
    map: newMap,
    fill: "white",
    seeds: [[0.5, 0.3]],
  },
  modernland: {
    out: "public/frames/modernland",
    pack: `${PACK_ROOT}/magic-new.mse-style`,
    map: newLandMap,
    fill: "white",
    seeds: [[0.5, 0.3]],
  },
  future: {
    out: "public/frames/future",
    pack: `${PACK_ROOT}/magic-future.mse-style`,
    map: futureMap,
    fill: "black",
    seeds: [[0.5, 0.33]],
  },
};

async function convert(out, pack, colorKey, srcFile, fill, seeds) {
  const W = OUT_W;
  const H = OUT_H;
  const { data, info } = await sharp(path.join(pack, srcFile))
    .resize(W, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const idx = (x, y) => (y * W + x) * ch;
  const isTarget = (i) =>
    data[i + 3] > 0 &&
    (fill === "white"
      ? data[i] >= NEAR_WHITE &&
        data[i + 1] >= NEAR_WHITE &&
        data[i + 2] >= NEAR_WHITE
      : data[i] + data[i + 1] + data[i + 2] <= NEAR_BLACK);

  const seen = new Uint8Array(W * H);
  let cut = 0;
  for (const [fx, fy] of seeds) {
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
    .toFile(path.join(out, `${colorKey}.png`));
  return ((cut / (W * H)) * 100).toFixed(1);
}

const only = process.argv.slice(2);
for (const [name, cfg] of Object.entries(FRAMES)) {
  if (only.length && !only.includes(name)) continue;
  fs.mkdirSync(cfg.out, { recursive: true });
  for (const [key, file] of Object.entries(cfg.map)) {
    const pct = await convert(cfg.out, cfg.pack, key, file, cfg.fill, cfg.seeds);
    console.log(`${name}/${key}.png  cut ${pct}%  ← ${file}`);
  }
}
console.log("done");
