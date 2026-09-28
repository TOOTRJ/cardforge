// ---------------------------------------------------------------------------
// build-adventure-frame.mjs — composite the M15 Adventure (Eldraine) frame.
//
// Unlike the simple frames (one per-color JPG), MSE's adventure style has no
// static frame: "Mainframe" composites it at render time from the base m15
// frame plus two "page" panels overlaid on the text area —
//   • double_page (a mini name+type+textbox panel) on the LEFT  = the adventure
//   • null_page   (a plain textbox panel)          on the RIGHT = the creature
// This script reproduces that composite onto our existing art-cut m15 frame, so
// the adventure frame is pixel-consistent with the standalone m15 frame and the
// art window stays transparent (it lives above the panels, untouched).
//
// Geometry is the MSE 375×523 spec scaled to our 1500×2100 canvas
// (X ×4.0, Y ×2100/523), matching scripts/convert-mse-frame.mjs's fit:"fill".
//
// BASE is the MSE m15 master, which left git when 4.4 swapped the M15 family
// to Card Conjurer (cd2ffcc): restore it from history before a rebuild
// (`git show cd2ffcc^:public/frames/m15/<key>.png`), never from the Card
// Conjurer m15 — a CC-derived master never enters the repo. Restore it
// outside public/frames and point BASE there: m15 is bucket-hosted now, and
// a copy left under public/frames/m15 turns frame-manifest.test.ts red. A
// rebuild changes the whole frame slightly (today's master was
// palette-quantised by 42b1126), so compare it before committing. The card
// corners are normalised before the write (Phase B, TODO 3.26; adventure
// joined the allow-list on 2026-09-28), so a rebuild can't bring back the
// grey paper rim inside the cut.
//
//   node scripts/build-adventure-frame.mjs
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
// Phase B (TODO 3.26): normalise the card corners before the write, so a
// rebuild can't bring the paper rim back.
import { normaliseMasterCorners } from "./lib/frame-corners.mjs";

const PAGES =
  "/Users/redjester/Projects/other/Full-Magic-Pack/data/magic-modules.mse-include/pages";
const BASE = "public/frames/m15";
const OUT = "public/frames/adventure";

// app color key → MSE page-panel filename stem (wpage.png, upage.png, …).
const MAP = { w: "w", u: "u", b: "b", r: "r", g: "g", c: "c", m: "m" };

const SX = 1500 / 375; // 4.0
const SY = 2100 / 523; // ≈4.0153

// MSE box: card color 2 / color page — left, top 327, width 170, height 156.5.
const px = (n) => Math.round(n * SX);
const py = (n) => Math.round(n * SY);
const BOX_W = px(170);
const BOX_H = py(156.5);
const BOX_TOP = py(327);
const ADV_LEFT = px(18); // double_page (adventure) on the left
const MAIN_LEFT = px(188); // null_page (creature textbox) on the right

fs.mkdirSync(OUT, { recursive: true });

async function panel(dir, stem) {
  return sharp(path.join(PAGES, dir, `${stem}page.png`))
    .resize(BOX_W, BOX_H, { fit: "fill" })
    .toBuffer();
}

async function build(colorKey, stem) {
  const adventure = await panel("double_page", stem);
  const creature = await panel("null_page", stem);

  const composed = await sharp(path.join(BASE, `${colorKey}.png`))
    .composite([
      { input: adventure, left: ADV_LEFT, top: BOX_TOP },
      { input: creature, left: MAIN_LEFT, top: BOX_TOP },
    ])
    .png()
    .toBuffer();
  const { data, info } = await sharp(composed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;

  // Written truecolour, never a palette: sharp's `effort` (like `palette`,
  // `quality`, `colours`) quantises AFTER the gate, which moved every pixel
  // of the cut's alpha ramp (by up to 52) and brought repainted pixels back
  // lighter.
  normaliseMasterCorners(path.basename(OUT), colorKey, data, W, H);
  await sharp(data, { raw: { width: W, height: H, channels: ch } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, `${colorKey}.png`));
  console.log(`${colorKey}.png  ← m15 + double_page(${stem}) + null_page(${stem})`);
}

for (const [key, stem] of Object.entries(MAP)) await build(key, stem);
console.log(`done → ${OUT}`);
