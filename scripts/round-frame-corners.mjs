// Make the outer card corners of every frame PNG transparent.
//
// Why: several MSE-derived frame families (m15*, agclassic/alpha*, saga,
// adventure, flip) ship with OPAQUE WHITE pixels in the four corners — the area
// *outside* the card's painted rounded black border. On the web the card tiles
// clip with a CSS border-radius; when that radius doesn't exactly match each
// frame's painted corner, those white pixels peek out as light wedges and the
// corners read as "cut off". The showcase frames (avatar/battle/bloomanime/
// tarkirghostfire) already ship transparent corners — this normalises the rest
// to match, so every card rounds cleanly on any background (preview AND bake).
//
// How: a bounded flood-fill from each of the 4 corners. We only clear pixels
// that are (a) light — min(R,G,B) ≥ LIGHT_MIN — and (b) reachable from the
// corner without crossing the dark painted border. The fill is capped to a
// corner box (REACH_PCT of the smaller dimension) as a runaway guard, and the
// dark border naturally stops it well before the card interior. Frames whose
// corners are already transparent / dark / saturated are left untouched (no
// light pixels to fill → file unchanged, not rewritten).
//
// Run: `node scripts/round-frame-corners.mjs`  (idempotent — re-running is a
// no-op once corners are transparent). Add `--dry` to only report.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const FRAMES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "frames",
);

// A pixel is "clearable corner background" when every channel is at least this
// bright. 230 catches pure white (255) and the near-white token plate (235)
// while leaving Bloomburrow's pale-blue (195) and all dark/colored corners be.
const LIGHT_MIN = 230;
const ALPHA_MIN = 200; // only clear currently-opaque pixels
const REACH_PCT = 0.16; // runaway guard: fill no further than 16% from a corner
const DRY = process.argv.includes("--dry");

async function listFramePngs() {
  const out = [];
  for (const entry of await readdir(FRAMES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(FRAMES_DIR, entry.name);
    for (const file of await readdir(dir)) {
      if (file.toLowerCase().endsWith(".png")) out.push(join(dir, file));
    }
  }
  return out.sort();
}

// Flood-fill light, opaque pixels from (sx,sy) → alpha 0. Returns pixels cleared.
function clearCorner(data, width, height, sx, sy, reach) {
  const idx = (x, y) => (y * width + x) * 4;
  const start = idx(sx, sy);
  // Nothing to do if the corner itself isn't a light/opaque pixel.
  if (
    data[start + 3] < ALPHA_MIN ||
    Math.min(data[start], data[start + 1], data[start + 2]) < LIGHT_MIN
  ) {
    return 0;
  }
  const stack = [[sx, sy]];
  let cleared = 0;
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (Math.abs(x - sx) > reach || Math.abs(y - sy) > reach) continue;
    const i = idx(x, y);
    if (data[i + 3] < ALPHA_MIN) continue; // already transparent → boundary
    if (Math.min(data[i], data[i + 1], data[i + 2]) < LIGHT_MIN) continue; // dark border → boundary
    data[i + 3] = 0; // clear alpha
    cleared++;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return cleared;
}

async function processFile(path) {
  const input = await readFile(path);
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const reach = Math.round(Math.min(width, height) * REACH_PCT);
  let cleared = 0;
  for (const [sx, sy] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]) {
    cleared += clearCorner(data, width, height, sx, sy, reach);
  }
  if (cleared === 0) return { path, cleared: 0 };
  if (!DRY) {
    const out = await sharp(data, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9, effort: 10 })
      .toBuffer();
    await writeFile(path, out);
  }
  return { path, cleared };
}

const files = await listFramePngs();
let changed = 0;
for (const file of files) {
  const { cleared } = await processFile(file);
  if (cleared > 0) {
    changed++;
    const rel = file.slice(FRAMES_DIR.length + 1);
    console.log(`  ${DRY ? "would clear" : "cleared"} ${cleared} px  ${rel}`);
  }
}
console.log(
  `\n${DRY ? "[dry] " : ""}${changed}/${files.length} frame PNGs ${
    DRY ? "would be" : ""
  } updated (transparent corners).`,
);
