// ---------------------------------------------------------------------------
// build-era-frames.mjs — convert the older-border standard frames (Future
// Sight; the 1997 frame until TODO 4.10a, the 2003 frame until 4.10b) from the Full-Magic-Pack MSE styles into the app's
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
// Phase B (TODO 3.26): normalise the card corners before the write, so a
// rebuild can't bring the white paper back (an allow-listed template).
import { normaliseMasterCorners } from "./lib/frame-corners.mjs";

const PACK_ROOT = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const OUT_W = 1500;
const OUT_H = 2100;
const NEAR_BLACK = 60;
const NEAR_WHITE = 232;

// The 1997 frame (`retro`, `retroland`) left this builder with TODO 4.10a:
// its masters are built by scripts/import-cc-frames.mjs into the frames
// bucket (Card Conjurer's Seventh drawing re-cut and toned onto the
// 1996–2003 prints). The gold master's SOURCE is the MSE conversion this
// builder used to write (magic-old.mse-style/mcard.jpg → 1500×2100, window
// cut, corners normalised), kept as scripts/frame-inputs/retro-m-mse.png.

// The 2003 frame (`modern`, `modernland`) left this builder with TODO 4.10b:
// its masters and P/T plates are built by scripts/import-cc-frames.mjs into
// the frames bucket (Card Conjurer's 8th drawing re-cut and toned onto the
// 2004–2014 prints).

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
  // Future Sight (NOT yet shipped): the base {color}card.jpg is the colored
  // background + name bar + vertical mana strip; the silver frame structure,
  // type bar, textbox, and P/T box ship as SEPARATE positioned overlay PNGs
  // ({color}typeline/textbox/pt.png) that must be composited on first. The art
  // window is white. Building it faithfully also needs a vertical mana-cost
  // capability in the renderer (the cost prints down the left strip, not in the
  // name bar). Left here as the starting config for that effort.
  future: {
    out: "public/frames/future",
    pack: `${PACK_ROOT}/magic-future.mse-style`,
    map: futureMap,
    fill: "white",
    seeds: [[0.5, 0.3]],
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

  normaliseMasterCorners(path.basename(out), colorKey, data, W, H);
  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .png({ compressionLevel: 9 }) // truecolour: `effort` would palette-quantise after the corner gate
    .toFile(path.join(out, `${colorKey}.png`));
  return ((cut / (W * H)) * 100).toFixed(1);
}

// `future` is a starting config for a frame no template references yet — it
// only builds when asked for by name, so a plain run doesn't emit an unused
// public/frames/future asset set.
const OPT_IN_ONLY = new Set(["future"]);
const only = process.argv.slice(2);
for (const [name, cfg] of Object.entries(FRAMES)) {
  if (only.length ? !only.includes(name) : OPT_IN_ONLY.has(name)) continue;
  fs.mkdirSync(cfg.out, { recursive: true });
  for (const [key, file] of Object.entries(cfg.map)) {
    const pct = await convert(cfg.out, cfg.pack, key, file, cfg.fill, cfg.seeds);
    console.log(`${name}/${key}.png  cut ${pct}%  ← ${file}`);
  }
}
console.log("done");
