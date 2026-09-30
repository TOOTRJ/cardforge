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
// HOW TO BUILD A NEW MSE FRAME'S MASTERS WITH IT (step 2 of docs/FRAMES.md
// "Adding a frame" — that section is the whole checklist; the steps below
// are only this script's part):
//   1. Point PACK at your Full-Magic-Pack `.mse-include/cards/<set>` dir.
//   2. Set OUT to public/frames/<name> and fill MAP with color → source file.
//   3. If the frame's art window isn't near (50%,33%), adjust SEEDS. For frames
//      with two cut-outs (planeswalker), add a second seed point.
//   4. node scripts/convert-mse-frame.mjs
//      Templates on the Phase B allow-list (scripts/lib/frame-corners.mjs)
//      get their card corners normalised before the write (TODO 3.26).
//   5. npm run assets:frame-webp (the browser's WebP siblings).
// Then carry on with "Adding a frame": register the template (types/card.ts
// and the picker, lib/creator/card-kinds.ts), write its profile — a BODY
// whose kind anatomy (P/T, walker shield + rows, defense, chapter rail)
// decides the kinds it dresses (docs/FRAMES.md "Kind anatomy and bodies";
// a walker through walkerAnatomy(), and never a kind's anatomy added to a
// template that already exists) — declare its checks (edge contract, square
// corners, art window), teach the import, run the tests and the visual
// matrix, ship, and have each colour verified in /admin/frame-compare
// (combos stay hidden until checked).
//
// Requires `sharp` (already a dependency). Run from the project root.
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
// Phase B (TODO 3.26): the card corners of an allow-listed template are
// normalised before the write, so a rebuild can't bring the white paper back.
import { normaliseMasterCorners } from "./lib/frame-corners.mjs";

// ── Config: edit these for each frame set ──────────────────────────────────
// ARTIFACT TOKENS — the token style's silver acard (Treasure/Clue/Food
// et al are artifact tokens on real prints). Skin variant of m15token.
const PACK = ".artifact-blend-tmp";
const OUT = "public/frames/m15artifact";
// M15 lands from the SIMPLE set — the "cut" *lcard twins bake an MSE
// produced-mana indicator disc into the title bar's top-left corner, which
// real M15 lands don't have. The simple set is the same frame without it.
const MAP = {
  w: "wblend.png",
  u: "ublend.png",
  b: "bblend.png",
  r: "rblend.png",
  g: "gblend.png",
  c: null, // colorless keeps the pure acard build
  m: "mblend.png",
};
// Seed point(s) inside each art window, as fractions of the card (x, y).
const SEEDS = [[0.5, 0.3]];
// Which art-window fill to cut to transparent: "black" (the m15 family) or
// "white" (the agclassic / Alpha family). Ignored if the window is already
// alpha-cut in the source (battle/devoid) — the fill just finds nothing.
const FILL = "black";
// Output canvas. Portrait frames are 1500×2100; landscape (battle) is 2100×1500.
const OUT_W = 1500;
const OUT_H = 2100;
// ───────────────────────────────────────────────────────────────────────────

const W = OUT_W;
const H = OUT_H;
const NEAR_BLACK = 60; // r+g+b ≤ this counts as the black art fill
const NEAR_WHITE = 235; // each channel ≥ this counts as the white art fill

fs.mkdirSync(OUT, { recursive: true });

async function convert(colorKey, srcFile) {
  const { data, info } = await sharp(path.join(PACK, srcFile))
    .resize(W, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const idx = (x, y) => (y * W + x) * ch;
  const isTarget = (i) =>
    data[i + 3] > 0 &&
    (FILL === "white"
      ? data[i] >= NEAR_WHITE &&
        data[i + 1] >= NEAR_WHITE &&
        data[i + 2] >= NEAR_WHITE
      : data[i] + data[i + 1] + data[i + 2] <= NEAR_BLACK);

  const seen = new Uint8Array(W * H);
  let cut = 0;
  // Scanline flood fill from each seed over connected near-black pixels.
  for (const [fx, fy] of SEEDS) {
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

  normaliseMasterCorners(path.basename(OUT), colorKey, data, W, H);
  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .png({ compressionLevel: 9 }) // truecolour: `effort` would palette-quantise after the corner gate
    .toFile(path.join(OUT, `${colorKey}.png`));
  console.log(
    `${colorKey}.png  cut ${((cut / (W * H)) * 100).toFixed(1)}% ← ${srcFile}`,
  );
}

for (const [key, file] of Object.entries(MAP)) if (file) await convert(key, file);
console.log(`done → ${OUT}`);
