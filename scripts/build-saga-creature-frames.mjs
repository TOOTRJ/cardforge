#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-saga-creature-frames.mjs — the SAGA CREATURE body's masters (TODO
// 4.5d: FIN's "Summon:" cards): PipGlyph's own composite of Card
// Conjurer's textured saga and the published m15nyx masters (the recipe
// and every number: scripts/lib/saga-creature.mjs).
//
//   sagacreature/<w u b r g m c>   CC's textured saga (saga/nyx/<k>; `c` its
//                                  artifact silver) with 173 rows cut, the
//                                  reminder widened into a band over the
//                                  window, and m15nyx/<k>'s rows from the
//                                  box down (frame field and paper redrawn
//                                  from the textured saga's own)
//
//   node scripts/build-saga-creature-frames.mjs                # → .frames-build
//   node scripts/build-saga-creature-frames.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only sagacreature --write
//
// The m15nyx masters are local copies of the PUBLISHED ones, sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache, .frames-build, or the shared frame store); Card Conjurer's
// textured saga comes from the pinned commit (CC_CACHE, default
// ~/.cache/pipglyph-cc/<commit>) and are never published as they are. The
// output is gitignored and NEVER committed. Provenance →
// lib/cards/frame-sources.json. Each WebP's ALPHA must equal its PNG's.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { CC_COMMIT, CC_RAW, WEBP } from "./lib/cc-frames.mjs";
import { frameObjectKey } from "./lib/frame-objects.mjs";
import {
  BAND_CUT,
  BAND_FILL,
  BAND_PAPER_SPAN,
  BOX_PAPER,
  BOX_TOP,
  H,
  LOWER_FROM,
  RAIL_CUT,
  ROWS_CUT,
  SAGA_CREATURE_KEYS,
  TEMPLATE,
  TEXTURED_SAGA_FILE,
  W,
  WINDOW_TOP_RULE,
  FOLD_SQUEEZE,
  composeLower,
  cutRows,
  layFold,
  drawRule,
  paintBand,
} from "./lib/saga-creature.mjs";

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
const store = process.env.PIPGLYPH_FRAMES_CACHE && process.env.PIPGLYPH_FRAMES_CACHE !== "off"
  ? path.resolve(process.env.PIPGLYPH_FRAMES_CACHE)
  : path.join(os.homedir(), ".cache", "pipglyph", "frames");

const sourceDirs = [
  ...(flag("--masters") ? [path.resolve(flag("--masters"))] : []),
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.resolve(".frames-cache"),
  path.resolve(".frames-build"),
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A published master's local copy, at the manifest's sha256 (a checkout's
 *  folders by manifest key, then the shared store by object key). */
function published(rel) {
  const want = MANIFEST[`${rel}.png`]?.sha256;
  if (!want) throw new Error(`${rel}.png is not in lib/frames/frame-manifest.json`);
  const candidates = [
    ...sourceDirs.map((dir) => path.join(dir, `${rel}.png`)),
    path.join(store, frameObjectKey(`${rel}.png`, want.slice(0, 12))),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    if (sha(fs.readFileSync(file)) === want) return { file, sha: want };
  }
  throw new Error(`no copy of ${rel}.png at the manifest's sha256 (${want.slice(0, 12)}) — run npm run frames:fetch`);
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

const provenance = JSON.parse(fs.readFileSync(PROVENANCE, "utf8"));
const record = {
  source: "pipglyph",
  repo: "Investigamer/cardconjurer",
  commit: CC_COMMIT,
  converter: "scripts/build-saga-creature-frames.mjs",
  derivedFrom:
    "Card Conjurer's textured saga ('Nyx Frames', packSagaNyx.js: img/frames/saga/nyx/<k>.png, `c` = its 'Artifact Frame' a.png) with rows cut and the reminder widened into a band, over the published m15nyx/<k> masters' rows from the text box down (Card Conjurer imports: see \"m15nyx\"), its box's top rim moved up under the raised bar and its paper taken from the textured saga's own (scripts/lib/saga-creature.mjs)",
  output: "1500x2100, the masters' corners, webp q90 with the PNG's alpha exactly",
  recipe: {
    rowsCut: `${BAND_CUT[1]} rows from ${BAND_CUT[0]} (the reminder box's straight middle) + ${RAIL_CUT[1]} from ${RAIL_CUT[0]} (the rail's) = ${ROWS_CUT}: the type bar 1759–1895 → ${1759 - ROWS_CUT}–${1895 - ROWS_CUT} px`,
    fold: `x 0–${FOLD_SQUEEZE.x1 - 1}: rows ${FOLD_SQUEEZE.from}–${FOLD_SQUEEZE.to - 1} resampled (lanczos3) into ${FOLD_SQUEEZE.from}–${FOLD_SQUEEZE.to - BAND_CUT[1] - 1}, faded into the cut over ${FOLD_SQUEEZE.fade} px`,
    band: `x ${BAND_FILL.x0}–${BAND_FILL.x1 - 1} × y ${BAND_FILL.y0}–${BAND_FILL.y1 - 1}: the box's paper mirrored from x ${BAND_PAPER_SPAN[0]}–${BAND_PAPER_SPAN[1]}; the window's top rule x ${WINDOW_TOP_RULE.x0}–${WINDOW_TOP_RULE.x1 - 1} × y ${WINDOW_TOP_RULE.y0}–${WINDOW_TOP_RULE.y1 - 1}`,
    lower: `rows ${LOWER_FROM}–${H - 1} from m15nyx/<k>; its box's top rim + inner shadow (rows ${BOX_TOP.from}–${BOX_TOP.to - 1}, x ${BOX_TOP.x0}–${BOX_TOP.x1 - 1}) copied to ${LOWER_FROM}–${LOWER_FROM + BOX_TOP.to - BOX_TOP.from - 1}; its paper (x ${BOX_PAPER.rect.x0}–${BOX_PAPER.rect.x1 - 1} × y ${BOX_PAPER.rect.y0}–${BOX_PAPER.rect.y1 - 1}) from the saga's chapter column (rows ${BOX_PAPER.fromRow}+, x mirrored into ${BOX_PAPER.span.join("–")})`,
  },
  colors: {},
  changedPixels: {},
  sourceFiles: [],
  notes: [
    "TODO 4.5d: the saga creature — FIN / FIC / PFIN's \"Summon:\" cards (2025); no Card Conjurer or MSE pack draws it",
    "c = the textured saga pack's artifact silver over m15nyx/c (FIN #1 Summon: Bahamut's frame); the prints' see-through rail and box are not drawn",
  ],
};
const files = new Set();
let written = 0;
for (const key of SAGA_CREATURE_KEYS) {
  const textured = await ccFile(TEXTURED_SAGA_FILE[key]);
  const m15 = published(`m15nyx/${key}`);
  const source = await rgba(textured);
  const out = cutRows(source, W, H, [BAND_CUT, RAIL_CUT]);
  const saga = Buffer.from(out);
  const squeezed = await sharp(source, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: 0, top: FOLD_SQUEEZE.from, width: FOLD_SQUEEZE.x1, height: FOLD_SQUEEZE.to - FOLD_SQUEEZE.from })
    .resize(FOLD_SQUEEZE.x1, FOLD_SQUEEZE.to - FOLD_SQUEEZE.from - BAND_CUT[1], { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  const changes = {
    fold: layFold(out, squeezed, W),
    band: paintBand(out, W),
    rule: drawRule(out, W),
    ...composeLower(out, saga, await rgba(m15.file)),
  };
  record.colors[key] = [`cc:${TEXTURED_SAGA_FILE[key]}@${sha(fs.readFileSync(textured)).slice(0, 12)}`, `m15nyx/${key}.png@${m15.sha.slice(0, 12)} (rows ${LOWER_FROM}+)`];
  record.changedPixels[key] = changes;
  files.add(`cc:${TEXTURED_SAGA_FILE[key]}`).add(`m15nyx/${key}.png`);
  if (!dryRun) {
    const pngFile = path.join(outDir, TEMPLATE, `${key}.png`);
    fs.mkdirSync(path.dirname(pngFile), { recursive: true });
    const image = sharp(out, { raw: { width: W, height: H, channels: 4 } });
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
