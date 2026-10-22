// ---------------------------------------------------------------------------
// build-variation-frames.mjs — convert the 2026-07 variation frames from
// Full-Magic-Pack MSE sources into app frames (public/frames/<name>/{7}.png,
// 1500×2100):
//
//   nyx          …showcase-theros-constellation card/*.png, already alpha-cut
//
//   node scripts/build-variation-frames.mjs
//   node scripts/build-variation-frames.mjs --only nyx     # one family
//
// nyx's type bar and text box are darkened to the THB constellation prints
// before the corner normalisation (scripts/lib/nyx-tone.mjs, TODO 4.17e:
// MSE's 50 % black → α 150 on the bar, α 171 in the box; both are far from
// the corners), and then its RIM is toned onto the M15 family's tones the
// prints wear (owner Rounds 59 / 61, scripts/lib/nyx-frame.mjs: w b r g;
// blue's is MSE's own; gold onto the gold crown's arm; colourless untouched).
//
// All of them start UNVERIFIED — they surface to users only after the owner
// checks them in /admin/frame-compare.
//
// `fullartland` used to be built here too (a composite of MSE's 744 px
// magic-m15-full-art-basic-land-symbol pieces, upscaled 2×). Frames plan 4.39
// re-sourced it from Card Conjurer's 'Fullart Basics (2022)' pack through
// scripts/import-cc-frames.mjs; it lives in the frames bucket now
// (lib/frames/frame-manifest.json) and must never come back to public/frames
// (tests/unit/frames/frame-manifest.test.ts fails on a frame in both places).
// `extendedart`, `m15textless` and `m15textlessland` went the same way (TODO
// 4.7 / 4.35 / 4.42, layout v58): Card Conjurer's 'Extended Art Frames' and
// 'Magic Fest Promos' through scripts/import-cc-frames.mjs, frames bucket.
// So did `fullart`, the Zendikar Rising hedron showcase (TODO 4.11, layout
// v63): MSE's 375 px `zendikar` masters (upscaled 4×, missing MSE's hedron
// `back` layer) gave way to Card Conjurer's 'Zendikar Rising' pack.
// `expeditionland` too (TODO 4.11 wave 1): Card Conjurer's 'ZNR Expeditions
// (2020)', beside the new `expeditionlandbfz` from 'BFZ Expeditions (2015)'.
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";
// Phase B (TODO 3.26): normalise the card corners at the final size before
// the write, so a rebuild can't bring the white paper back.
import { normaliseMasterCorners } from "./lib/frame-corners.mjs";
import { toneNyxMaster } from "./lib/nyx-tone.mjs";
import { NYX_RIM_TONES, toneNyxRim } from "./lib/nyx-frame.mjs";

// `--only a,b` rebuilds only those families (the output dir's basename).
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
const wanted = (outDir) => !ONLY || ONLY.has(path.basename(outDir));

const DATA = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const W = 1500;
const H = 2100;

async function writeOut(outDir, key, buf, transform) {
  fs.mkdirSync(outDir, { recursive: true });
  const data = await sharp(buf).resize(W, H, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  // A family's own pass (nyx's type bar and text box) — away from the
  // corners, so it runs before their normalisation and the write stays the
  // gated pixels.
  if (transform) transform(data, W, H, key);
  normaliseMasterCorners(path.basename(outDir), key, data, W, H);
  await sharp(data, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(outDir, `${key}.png`));
}

const COLORS = ["w", "u", "b", "r", "g", "c", "m"];

// PNG families already alpha-cut ---------------------------------------------
const PNG_SETS = [
  {
    out: "public/frames/nyx",
    pack: `${DATA}/magic-m15-showcase-theros-constellation.mse-style/card`,
    file: (k) => `${k}card.png`,
    transform: (data, width, height, key) => {
      toneNyxMaster(data, width, height);
      if (NYX_RIM_TONES[key]) toneNyxRim(data, width, height, NYX_RIM_TONES[key]);
    },
  },
];

for (const set of PNG_SETS) {
  if (!wanted(set.out)) continue;
  for (const key of COLORS) {
    await writeOut(set.out, key, fs.readFileSync(path.join(set.pack, set.file(key))), set.transform);
    console.log(`${path.basename(set.out)}/${key}.png ← ${set.file(key)}`);
  }
}

console.log("done");
