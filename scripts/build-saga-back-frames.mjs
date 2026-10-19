#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-saga-back-frames.mjs — the double-faced saga BACK's masters (TODO
// 5.5 (b), PR 2): PipGlyph's own composite of masters the frames bucket
// already publishes, toned onto print (the recipe and every number:
// scripts/lib/saga-back.mjs).
//
//   sagadfcback/<w u b r g m c>   saga/<k> + m15dfcback/<k>'s title bar and ▼
//                                 well (CC 'Transform (Back) (New)' title
//                                 mask) and its type bar (CC's M15 type mask,
//                                 moved down 593 px onto the saga's type row);
//                                 the rail's paper and both bars toned onto
//                                 the printed saga backs (SAGA_BACK_TONES)
//
//   node scripts/build-saga-back-frames.mjs                # → .frames-build
//   node scripts/build-saga-back-frames.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only sagadfcback --write
//
// The masters are local copies of the PUBLISHED ones, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build); Card
// Conjurer's MASKS come from the pinned commit (CC_CACHE, default
// ~/.cache/pipglyph-cc/<commit>) and are never published. The output is
// gitignored and NEVER committed. Provenance → lib/cards/frame-sources.json.
//
// Each WebP's ALPHA must equal its PNG's exactly: the run decodes every
// WebP it wrote and refuses a difference.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { CC_COMMIT, CC_RAW, WEBP, describeSourceToneTable, toneSourceRegions } from "./lib/cc-frames.mjs";
import {
  H,
  SAGA_BACK_KEYS,
  SAGA_BACK_MASKS,
  SAGA_BACK_READ_REGIONS,
  SAGA_BACK_TONES,
  SAGA_TYPE_DY,
  TITLE_TONE_FADE_PX,
  W,
  blendThrough,
  planeL1,
  paperToneMask,
  readTone,
  shiftPlane,
  shiftRgba,
  titleToneMask,
} from "./lib/saga-back.mjs";

const TEMPLATE = "sagadfcback";
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const cacheDir = process.env.CC_CACHE ?? path.join(os.homedir(), ".cache", "pipglyph-cc", CC_COMMIT);
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const BODY_WEBP = { ...WEBP, alphaQuality: 100 };

const sourceDirs = [
  ...(flag("--masters") ? [path.resolve(flag("--masters"))] : []),
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.resolve(".frames-cache"),
  path.resolve(".frames-build"),
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A published master's local copy, at the manifest's sha256. */
function published(rel) {
  const want = MANIFEST[`${rel}.png`]?.sha256;
  if (!want) throw new Error(`${rel}.png is not in lib/frames/frame-manifest.json`);
  for (const dir of sourceDirs) {
    const file = path.join(dir, `${rel}.png`);
    if (!fs.existsSync(file)) continue;
    if (sha(fs.readFileSync(file)) === want) return { file, sha: want };
  }
  throw new Error(`no copy of ${rel}.png at the manifest's sha256 (${want.slice(0, 12)}) under ${sourceDirs.join(", ")}`);
}

async function ccFile(rel) {
  const file = path.join(cacheDir, rel);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(`${CC_RAW}/${rel}`, { headers: { "User-Agent": "PipGlyph-cc-import/1.0" } });
  if (!res.ok) throw new Error(`${res.status} fetching ${rel}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function rgba(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error(`${file}: ${info.width}×${info.height}, not ${W}×${H}`);
  return data;
}
/** A Card Conjurer mask's alpha at 1500 × 2100 (the M15 masks are drawn at
 *  2010 × 2814: resized once, lanczos3, as the importer reads them). */
async function maskPlane(rel) {
  const file = await ccFile(rel);
  const { data } = await sharp(file).resize(W, H, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const plane = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) plane[i] = data[i * 4 + 3];
  return { plane, sha: sha(fs.readFileSync(file)) };
}

const masks = {};
for (const [name, rel] of Object.entries(SAGA_BACK_MASKS)) masks[name] = await maskPlane(rel);
const typeMask = shiftPlane(masks.type.plane, W, H, SAGA_TYPE_DY);
// The saga pack's own type mask is M15's moved down SAGA_TYPE_DY px: a
// different move would put m15dfcback's bar off the saga's row.
// (Their edges are anti-aliased apart — the M15 mask is resampled from
// 2010 × 2814 — so the check is that no other move within ±2 rows fits
// better.)
const typeFit = (dy) => planeL1(shiftPlane(masks.type.plane, W, H, dy), masks.sagaType.plane);
const typeDrift = typeFit(SAGA_TYPE_DY);
for (const dy of [SAGA_TYPE_DY - 2, SAGA_TYPE_DY - 1, SAGA_TYPE_DY + 1, SAGA_TYPE_DY + 2]) {
  if (typeFit(dy) <= typeDrift) throw new Error(`the M15 type mask moved ${dy} px fits the saga's better than ${SAGA_TYPE_DY}`);
}
const toneRegions = {
  title: titleToneMask(masks.title.plane, W, TITLE_TONE_FADE_PX),
  type: typeMask,
  paper: paperToneMask(masks.sagaText.plane, masks.sagaBanner.plane),
};

const provenance = JSON.parse(fs.readFileSync(PROVENANCE, "utf8"));
const record = {
  source: "pipglyph",
  repo: "Investigamer/cardconjurer",
  commit: CC_COMMIT,
  converter: "scripts/build-saga-back-frames.mjs",
  derivedFrom:
    "the published saga/<k> masters (the 4.21c saga, Card Conjurer imports: see \"saga\") with the published m15dfcback/<k> masters' title bar + ▼ well and type bar (Card Conjurer imports: see \"m15dfcback\") laid over them through Card Conjurer's masks; the rail's paper and both bars toned onto the printed saga backs (scripts/lib/saga-back.mjs SAGA_BACK_TONES)",
  output: "1500x2100, the saga master's corners, webp q90 with the PNG's alpha exactly",
  recipe: {
    masks: Object.fromEntries(Object.entries(SAGA_BACK_MASKS).map(([k, rel]) => [k, `cc:${rel}@${masks[k].sha.slice(0, 12)}`])),
    typeDy: `${SAGA_TYPE_DY} px (the moved M15 type mask's best fit to the saga pack's own: L1 ${typeDrift}, its anti-aliased edges)`,
    titleToneFade: `x ${TITLE_TONE_FADE_PX.from} → ${TITLE_TONE_FADE_PX.to} px (the ▼ well untoned)`,
    tones: {},
  },
  colors: {},
  changedPixels: {},
  sourceFiles: [],
  notes: [
    "TODO 5.5 (b) PR 2: the back of a card whose back face is a Saga — MOM's five praetors (#12, #65, #125, #169, #213 and their prerelease promos), LCI #189 Roar of the Fifth People (and #296); no Card Conjurer pack draws it (owner-approved mock 2026-10-17, design-backup/dfc-sagas/back-proposal.jpg)",
    "toned onto print before the first tick (owner 2026-10-17): the rail's paper to the printed backs' greyed box, the title and type bars per key; `from` is re-read on every run and must match the table within 2 levels a channel",
    "c = the saga's land frame under m15dfcback/c's bronze bars, untoned (no print); FIN's saga CREATURE backs (a P/T plate) are TODO 4.5d, not this body",
  ],
};
const files = new Set(Object.values(SAGA_BACK_MASKS).map((rel) => `cc:${rel}`));
let written = 0;
for (const key of SAGA_BACK_KEYS) {
  const saga = published(`saga/${key}`);
  const dfc = published(`m15dfcback/${key}`);
  const out = Buffer.from(await rgba(saga.file));
  const dfcPixels = await rgba(dfc.file);
  const changes = {
    title: blendThrough(out, dfcPixels, masks.title.plane),
    type: blendThrough(out, shiftRgba(dfcPixels, W, H, SAGA_TYPE_DY), typeMask),
  };
  let toned = out;
  const tones = SAGA_BACK_TONES[key];
  if (tones) {
    // The table's `from` is what the composite reads: refuse a drift.
    for (const [region, tone] of Object.entries(tones)) {
      const read = readTone(out, SAGA_BACK_READ_REGIONS[region]);
      const drift = Math.max(...read.map((v, c) => Math.abs(v - tone.from[c])));
      if (drift > 2) throw new Error(`${TEMPLATE}/${key}: the ${region} reads ${read.join(",")}, the table's from is ${tone.from.join(",")}`);
    }
    toned = toneSourceRegions(out, W, H, Object.fromEntries(Object.keys(tones).map((r) => [r, toneRegions[r]])), tones);
    for (const [region, tone] of Object.entries(tones)) {
      const read = readTone(toned, SAGA_BACK_READ_REGIONS[region]);
      changes[`${region} (toned)`] = `${tone.from.join(",")} → ${read.join(",")} (print ${tone.to.join(",")})`;
    }
    record.recipe.tones[key] = describeSourceToneTable(tones);
  }
  record.colors[key] = [`saga/${key}.png@${saga.sha.slice(0, 12)}`, `m15dfcback/${key}.png@${dfc.sha.slice(0, 12)} (title bar, ▼ well, type bar)`];
  record.changedPixels[key] = changes;
  files.add(`saga/${key}.png`).add(`m15dfcback/${key}.png`);
  if (!dryRun) {
    const pngFile = path.join(outDir, TEMPLATE, `${key}.png`);
    fs.mkdirSync(path.dirname(pngFile), { recursive: true });
    const image = sharp(toned, { raw: { width: W, height: H, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
    const webpFile = pngFile.replace(/\.png$/, ".webp");
    await image.clone().webp(BODY_WEBP).toFile(webpFile);
    const a = await sharp(pngFile).ensureAlpha().raw().toBuffer();
    const b = await sharp(webpFile).ensureAlpha().raw().toBuffer();
    for (let i = 3; i < a.length; i += 4) {
      if (a[i] !== b[i]) throw new Error(`${TEMPLATE}/${key}: WebP alpha differs from the PNG's at px ${(i - 3) / 4}`);
    }
    written += 1;
  }
  console.log(`✓ ${TEMPLATE}/${key}  ${Object.entries(changes).map(([g, n]) => `${g} ${n}`).join("; ")}`);
}
record.sourceFiles = [...files].sort();
if (!dryRun) {
  provenance[TEMPLATE] = record;
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
}
console.log(`${written} masters → ${outDir}`);
