#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-station-frames.mjs — the station frame's masters (TODO 4.27a):
// PipGlyph's OWN derivation from M15 masters already published in the frames
// bucket. No Card Conjurer file and no scan is read; every number is DATA in
// scripts/lib/station-2025.mjs (STATION_RECIPE).
//
//   m15station/<w u b r g m c>      from the published m15artifact/<key>
//   m15stationland/<w u b r g>      from the published m15land/<key>
//
// Two cuts:
//   1. the frame FIELD → alpha 0 (the picture runs under the whole card). Its
//      shape is read off the masters themselves: m15/<k> and m15artifact/<k>
//      paint the same bars, pinlines and boxes over two different fields, so
//      the pixels where they differ ARE the field (union over six keys, 1 px
//      holes closed). The run refuses a mask whose bounding box is not the
//      recorded one — a re-sourced M15 master means a new look at the recipe.
//   2. the TEXT BOX interior → alpha × washAlpha: the box's own colour,
//      texture and top shadow stay, see-through.
//
//   node scripts/build-station-frames.mjs                # → .frames-build
//   node scripts/build-station-frames.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only m15station,m15stationland --write
//
// The sources are local copies of the PUBLISHED masters, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build). The output is
// gitignored: a master derived from a bucket master never enters git.
// Provenance → lib/cards/frame-sources.json.
//
// The WebP sibling's ALPHA must equal the PNG's exactly (the browser preview
// reads the WebP, the bake the PNG; a one-level alpha step over bright art is
// a visible tone step): the run decodes every WebP it wrote and refuses a
// difference.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { WEBP } from "./lib/cc-frames.mjs";
import { STATION_RECIPE } from "./lib/station-2025.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const W = 1500;
const H = 2100;
const STATION_WEBP = { ...WEBP, alphaQuality: 100 };

const sourceDirs = [
  ...(flag("--masters") ? [path.resolve(flag("--masters"))] : []),
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.resolve(".frames-cache"),
  path.resolve(".frames-build"),
];

/** A published master's local copy, at the manifest's sha256. */
function published(rel) {
  const want = MANIFEST[`${rel}.png`]?.sha256;
  if (!want) throw new Error(`${rel}.png is not in lib/frames/frame-manifest.json`);
  for (const dir of sourceDirs) {
    const file = path.join(dir, `${rel}.png`);
    if (!fs.existsSync(file)) continue;
    if (createHash("sha256").update(fs.readFileSync(file)).digest("hex") === want) return { file, sha: want };
  }
  throw new Error(`no copy of ${rel}.png at the manifest's sha256 (${want.slice(0, 12)}) under ${sourceDirs.join(", ")} — node scripts/frames-fetch.mjs`);
}

async function raw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error(`${file}: ${info.width}×${info.height}, expected ${W}×${H}`);
  return data;
}

// ---- 1. the field mask ------------------------------------------------------
const { field: FIELD, box: BOX, washAlpha: WASH } = STATION_RECIPE;
const mask = new Uint8Array(W * H);
const maskSources = [];
for (const key of FIELD.keys) {
  const a = published(`m15/${key}`);
  const b = published(`m15artifact/${key}`);
  maskSources.push(`m15/${key}.png@${a.sha.slice(0, 12)}`, `m15artifact/${key}.png@${b.sha.slice(0, 12)}`);
  const pa = await raw(a.file);
  const pb = await raw(b.file);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const d = Math.abs(pa[o] - pb[o]) + Math.abs(pa[o + 1] - pb[o + 1]) + Math.abs(pa[o + 2] - pb[o + 2]) + Math.abs(pa[o + 3] - pb[o + 3]);
    if (d > FIELD.threshold) mask[i] = 1;
  }
}
const closed = new Uint8Array(mask);
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    if (mask[i]) continue;
    let n = 0;
    for (const o of [-1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1]) n += mask[i + o];
    if (n >= 6) closed[i] = 1;
  }
}
const found = { x0: W, x1: 0, y0: H, y1: 0, px: 0 };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (!closed[y * W + x]) continue;
    found.px++;
    found.x0 = Math.min(found.x0, x);
    found.x1 = Math.max(found.x1, x);
    found.y0 = Math.min(found.y0, y);
    found.y1 = Math.max(found.y1, y);
  }
}
for (const side of ["x0", "x1", "y0", "y1"]) {
  if (found[side] !== FIELD.expectBox[side]) {
    throw new Error(`the field mask's box is ${JSON.stringify(found)}, the recipe recorded ${JSON.stringify(FIELD.expectBox)} — the M15 masters moved; look at the recipe again`);
  }
}
console.log(`field mask: ${found.px} px, box ${found.x0}..${found.x1} × ${found.y0}..${found.y1}`);

// ---- 2. the masters -----------------------------------------------------------
const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
for (const [template, def] of Object.entries(STATION_RECIPE.templates)) {
  const colors = {};
  for (const key of def.keys) {
    const src = published(`${def.from}/${key}`);
    const data = await raw(src.file);
    const out = Buffer.from(data);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (closed[i]) out[i * 4 + 3] = 0;
        else if (x >= BOX.left && x <= BOX.right && y >= BOX.top && y <= BOX.bottom) out[i * 4 + 3] = Math.round(data[i * 4 + 3] * WASH);
      }
    }
    colors[key] = [`${def.from}/${key}.png (published, sha256 ${src.sha.slice(0, 12)})`];
    if (dryRun) continue;
    const png = path.join(outDir, template, `${key}.png`);
    fs.mkdirSync(path.dirname(png), { recursive: true });
    const image = sharp(out, { raw: { width: W, height: H, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(png);
    const webp = png.replace(/\.png$/, ".webp");
    await image.clone().webp(STATION_WEBP).toFile(webp);
    const back = await raw(webp);
    for (let i = 0; i < W * H; i++) {
      if (back[i * 4 + 3] !== out[i * 4 + 3]) throw new Error(`${webp}: alpha differs from the PNG's at ${i % W},${Math.floor(i / W)} (${back[i * 4 + 3]} ≠ ${out[i * 4 + 3]})`);
    }
    console.log(`wrote ${path.relative(process.cwd(), png)} (+ .webp, alpha equal) from ${def.from}/${key}`);
  }
  provenance[template] = {
    source: "pipglyph",
    converter: "scripts/build-station-frames.mjs",
    derivedFrom: `the published ${def.from}/<key> masters of the frames bucket (themselves Card Conjurer imports: see "${def.from}")`,
    output: `${W}x${H}, the parent's corners, webp q${WEBP.quality} with the PNG's alpha exactly`,
    recipe: {
      field: `alpha 0 where m15/<k> and m15artifact/<k> differ by more than ${FIELD.threshold} (|dR|+|dG|+|dB|+|dA|), union over ${FIELD.keys.join(" ")}, 1 px holes closed: ${found.px} px, box ${found.x0}..${found.x1} x ${found.y0}..${found.y1}`,
      box: `alpha x ${WASH} inside ${BOX.left}..${BOX.right} x ${BOX.top}..${BOX.bottom}`,
      maskSources,
    },
    colors,
    sourceFiles: [...def.keys.map((key) => `${def.from}/${key}.png`), ...FIELD.keys.flatMap((key) => [`m15/${key}.png`, `m15artifact/${key}.png`])].filter((file, at, all) => all.indexOf(file) === at).sort(),
    notes: [
      "PipGlyph's own derivation (TODO 4.27a; owner 2026-10-13): neither Card Conjurer nor MSE has a station frame at print size. Nothing is drawn or synthesised in the master: every painted pixel is the parent master's, with its alpha cut.",
      "The numbers are scripts/lib/station-2025.mjs (30 printed station cards measured 2026-10-13); no scan is read by the build.",
      "Tier bands, badges and the P/T plate are DRAWN by both renderers (lib/cards/station.ts, lib/cards/station-art.ts) — not in the master.",
    ],
  };
}
if (!dryRun) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
