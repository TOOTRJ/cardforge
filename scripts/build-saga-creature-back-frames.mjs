#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-saga-creature-back-frames.mjs — the saga creature's BACK masters
// (TODO 4.5d, part B: FIN's Dominants' summons): PipGlyph's own composite of
// masters the frames bucket already publishes, toned onto print (the recipe
// and every number: scripts/lib/saga-creature-back.mjs).
//
//   sagacreaturedfcback/<w u b r g m c>   sagacreature/<k> + m15dfcback/<k>'s
//                                         title bar and ▼ well (CC 'Transform
//                                         (Back) (New)' title mask) and its
//                                         type bar (CC's M15 type mask moved
//                                         down 420 px onto the raised type
//                                         row); the paper and both bars toned
//                                         onto FIN's printed backs
//   sagacreaturedfcback/pt/<k>            m15dfcback/pt/<k> toned onto FIN's
//                                         plates (`c` as published)
//   m15nyxdfccrownright/<w u b r g m a>   the published m15nyxcrown band cut
//                                         round the ▼ well (m15dfccrownright's
//                                         cut, cc-frames.mjs cutCrownBand)
//
//   node scripts/build-saga-creature-back-frames.mjs                # → .frames-build
//   node scripts/build-saga-creature-back-frames.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only sagacreaturedfcback,m15nyxdfccrownright --write
//
// The masters are local copies of the PUBLISHED ones, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache, .frames-build, or the shared frame store — never a fresh
// download); Card Conjurer's MASKS come from the pinned commit (CC_CACHE,
// default ~/.cache/pipglyph-cc/<commit>) and are never published. The output
// is gitignored and NEVER committed. Provenance → lib/cards/frame-sources.json.
//
// Each WebP's ALPHA must equal its PNG's exactly: the run decodes every WebP
// it wrote and refuses a difference.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  CC_COMMIT,
  CC_RAW,
  CROWN_BAND,
  DFC_CROWN_TWIN_SIZE,
  DFC_CROWN_WELLS,
  WEBP,
  cutCrownBand,
  cutCrownFindings,
  describeSourceToneTable,
  placeTwin,
  toneSourceRegions,
  twinLetterFor,
} from "./lib/cc-frames.mjs";
import { frameObjectKey } from "./lib/frame-objects.mjs";
import { blendThrough, planeL1, readTone, shiftPlane, shiftRgba, titleToneMask } from "./lib/saga-back.mjs";
import { ROWS_CUT } from "./lib/saga-creature.mjs";
import {
  CROWN_FOLDER,
  CROWN_KEYS,
  CROWN_TWIN_DIR,
  H,
  PLATE_KEYS,
  PLATE_PLACEMENT,
  PLATE_READ_REGIONS,
  PLATE_TONES,
  SAGA_CREATURE_BACK_KEYS,
  SAGA_CREATURE_BACK_MASKS,
  SAGA_CREATURE_BACK_READ_REGIONS,
  SAGA_CREATURE_BACK_TONES,
  TEMPLATE,
  TITLE_TONE_FADE_PX,
  TYPE_DY,
  W,
  paperPlane,
} from "./lib/saga-creature-back.mjs";

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
const store =
  process.env.PIPGLYPH_FRAMES_CACHE && process.env.PIPGLYPH_FRAMES_CACHE !== "off"
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
  const candidates = [...sourceDirs.map((dir) => path.join(dir, `${rel}.png`)), path.join(store, frameObjectKey(`${rel}.png`, want.slice(0, 12)))];
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
for (const [name, rel] of Object.entries(SAGA_CREATURE_BACK_MASKS)) masks[name] = await maskPlane(rel);
const typeMask = shiftPlane(masks.type.plane, W, H, TYPE_DY);
// The saga creature's type row is the saga pack's raised ROWS_CUT px, and
// that is M15's type mask moved TYPE_DY: no other move within ±2 rows may fit
// better (their edges are anti-aliased apart — the M15 mask is resampled from
// 2010 × 2814).
const raisedSagaType = shiftPlane(masks.sagaType.plane, W, H, -ROWS_CUT);
const typeFit = (dy) => planeL1(shiftPlane(masks.type.plane, W, H, dy), raisedSagaType);
const typeDrift = typeFit(TYPE_DY);
for (const dy of [TYPE_DY - 2, TYPE_DY - 1, TYPE_DY + 1, TYPE_DY + 2]) {
  if (typeFit(dy) <= typeDrift) throw new Error(`the M15 type mask moved ${dy} px fits the raised saga type row better than ${TYPE_DY}`);
}
const toneRegions = {
  title: titleToneMask(masks.title.plane, W, TITLE_TONE_FADE_PX),
  type: typeMask,
  paper: paperPlane({ sagaText: masks.sagaText.plane, sagaBanner: masks.sagaBanner.plane, rules: masks.rules.plane }),
};

const provenance = JSON.parse(fs.readFileSync(PROVENANCE, "utf8"));
const record = {
  source: "pipglyph",
  repo: "Investigamer/cardconjurer",
  commit: CC_COMMIT,
  converter: "scripts/build-saga-creature-back-frames.mjs",
  derivedFrom:
    "the published sagacreature/<k> masters (TODO 4.5d part A, PipGlyph's own: see \"sagacreature\") with the published m15dfcback/<k> masters' title bar + ▼ well and type bar (Card Conjurer imports: see \"m15dfcback\") laid over them through Card Conjurer's masks; the paper (the band, the chapter column, the second box) and both bars toned onto FIN's printed summon backs (scripts/lib/saga-creature-back.mjs SAGA_CREATURE_BACK_TONES)",
  output: "1500x2100, the masters' corners, webp q90 with the PNG's alpha exactly",
  recipe: {
    masks: Object.fromEntries(Object.entries(SAGA_CREATURE_BACK_MASKS).map(([k, rel]) => [k, `cc:${rel}@${masks[k].sha.slice(0, 12)}`])),
    typeDy: `${TYPE_DY} px (the saga's 593 less the ${ROWS_CUT} the body raises its bar; the moved M15 type mask's best fit to the saga pack's own raised ${ROWS_CUT} px: L1 ${typeDrift}, its anti-aliased edges)`,
    titleToneFade: `x ${TITLE_TONE_FADE_PX.from} → ${TITLE_TONE_FADE_PX.to} px (the ▼ well untoned)`,
    paper: "the saga pack's text mask less its ribbon, cut and squeezed as the part A master (165 + 8 rows, the fold), the band over the window's columns whole, and M15's rules mask from row 1723 down (its top rim copied up under the raised bar)",
    tones: {},
  },
  colors: {},
  changedPixels: {},
  sourceFiles: [],
  notes: [
    "TODO 4.5d part B: the BACK of FIN's Dominants — saga CREATURE backs (FIN #13, #16, #58, #104, #133, #185, #229, #245 and PFIN's prerelease twins): the part A body under the ▼ back's dark bars; no Card Conjurer or MSE pack draws it",
    "toned onto print before the first tick (as the saga back, owner 2026-10-17): the paper to the printed backs' greyed box, the title and type bars per key; `from` is re-read on every run and must match the table within 2 levels a channel",
    "m: FIN's gold bars (#229, #245 — two-colour backs, whose pair dress is a follow-up); its paper to LCI #189's printed gold saga back (no gold summon back was printed)",
    "c = the part A master's artifact silver under m15dfcback/c's bronze bars, untoned (no colourless summon is double-faced)",
  ],
};
const files = new Set(Object.values(SAGA_CREATURE_BACK_MASKS).map((rel) => `cc:${rel}`));
let written = 0;
for (const key of SAGA_CREATURE_BACK_KEYS) {
  const body = published(`sagacreature/${key}`);
  const dfc = published(`m15dfcback/${key}`);
  const out = Buffer.from(await rgba(body.file));
  const dfcPixels = await rgba(dfc.file);
  const changes = {
    title: blendThrough(out, dfcPixels, masks.title.plane),
    type: blendThrough(out, shiftRgba(dfcPixels, W, H, TYPE_DY), typeMask),
  };
  let toned = out;
  const tones = SAGA_CREATURE_BACK_TONES[key];
  if (tones) {
    // The table's `from` is what the composite reads: refuse a drift.
    for (const [region, tone] of Object.entries(tones)) {
      const read = readTone(out, SAGA_CREATURE_BACK_READ_REGIONS[region]);
      const drift = Math.max(...read.map((v, c) => Math.abs(v - tone.from[c])));
      if (drift > 2) throw new Error(`${TEMPLATE}/${key}: the ${region} reads ${read.join(",")}, the table's from is ${tone.from.join(",")}`);
    }
    toned = toneSourceRegions(out, W, H, Object.fromEntries(Object.keys(tones).map((r) => [r, toneRegions[r]])), tones);
    for (const [region, tone] of Object.entries(tones)) {
      const read = readTone(toned, SAGA_CREATURE_BACK_READ_REGIONS[region]);
      changes[`${region} (toned)`] = `${tone.from.join(",")} → ${read.join(",")} (print ${tone.to.join(",")})`;
    }
    record.recipe.tones[key] = describeSourceToneTable(tones);
  }
  record.colors[key] = [`sagacreature/${key}.png@${body.sha.slice(0, 12)}`, `m15dfcback/${key}.png@${dfc.sha.slice(0, 12)} (title bar, ▼ well, type bar)`];
  record.changedPixels[key] = changes;
  files.add(`sagacreature/${key}.png`).add(`m15dfcback/${key}.png`);
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

// The P/T plates: m15dfcback/pt/<k> toned onto FIN's plates (PLATE_TONES),
// read where the profile draws them; `c` as published.
/** An image's RGBA at its own size. */
async function rgbaAny(file) {
  return sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}
/** The plate as the profile draws it: resized onto its box of a clear card. */
async function placedPlate(raw, info) {
  const placed = await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize(PLATE_PLACEMENT.width, PLATE_PLACEMENT.height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: placed, left: PLATE_PLACEMENT.left, top: PLATE_PLACEMENT.top }])
    .raw()
    .toBuffer();
}
/** Write a PNG — encoded from `raw`, or `pngFrom`'s bytes as they are — and
 *  its WebP (alpha checked equal). */
async function writePair(rel, raw, width, height, webp = BODY_WEBP, pngFrom = null) {
  const pngFile = path.join(outDir, `${rel}.png`);
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  const image = sharp(raw, { raw: { width, height, channels: 4 } });
  if (pngFrom) fs.copyFileSync(pngFrom, pngFile);
  else await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
  const webpFile = pngFile.replace(/\.png$/, ".webp");
  await image.clone().webp(webp).toFile(webpFile);
  const a = await sharp(pngFile).ensureAlpha().raw().toBuffer();
  const b = await sharp(webpFile).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < a.length; i += 4) {
    if (a[i] !== b[i]) throw new Error(`${rel}: WebP alpha differs from the PNG's at px ${(i - 3) / 4}`);
  }
}
record.recipe.plates = {
  placement: `${PLATE_PLACEMENT.width}×${PLATE_PLACEMENT.height} at (${PLATE_PLACEMENT.left}, ${PLATE_PLACEMENT.top}) px (M15.pt.plateRect), lanczos3 — where the profile draws the plate`,
  read: PLATE_READ_REGIONS.map(([l, t, r, b]) => `x ${l}–${r} × y ${t}–${b}`).join(", "),
  tones: {},
};
record.plates = {};
for (const key of PLATE_KEYS) {
  const source = published(`m15dfcback/pt/${key}`);
  const { data, info } = await rgbaAny(source.file);
  const tones = PLATE_TONES[key];
  let out = data;
  if (tones) {
    const before = readTone(await placedPlate(data, info), PLATE_READ_REGIONS);
    const drift = Math.max(...before.map((v, c) => Math.abs(v - tones.plate.from[c])));
    if (drift > 2) throw new Error(`${TEMPLATE}/pt/${key}: the plate reads ${before.join(",")}, the table's from is ${tones.plate.from.join(",")}`);
    out = toneSourceRegions(data, info.width, info.height, { plate: new Uint8Array(info.width * info.height).fill(255) }, tones);
    const after = readTone(await placedPlate(out, info), PLATE_READ_REGIONS);
    record.plates[key] = `m15dfcback/pt/${key}.png@${source.sha.slice(0, 12)} toned ${tones.plate.from.join(",")} → ${after.join(",")} (print ${tones.plate.to.join(",")})`;
    record.recipe.plates.tones[key] = describeSourceToneTable(tones).plate;
  } else {
    record.plates[key] = `m15dfcback/pt/${key}.png@${source.sha.slice(0, 12)} as published`;
  }
  files.add(`m15dfcback/pt/${key}.png`);
  // (Untoned: the published PNG's bytes, its WebP encoded from them.)
  if (!dryRun) await writePair(`${TEMPLATE}/pt/${key}`, out, info.width, info.height, BODY_WEBP, tones ? null : source.file);
  console.log(`✓ ${TEMPLATE}/pt/${key}  ${record.plates[key]}`);
}

// The legendary crown: the published m15nyxcrown band cut round the ▼ well
// (cc-frames.mjs cutCrownBand — m15dfccrownright's cut over the Nyx band).
const crownRecord = {
  source: "pipglyph",
  repo: "Investigamer/cardconjurer",
  commit: CC_COMMIT,
  converter: "scripts/build-saga-creature-back-frames.mjs",
  derivedFrom:
    "the published m15nyxcrown/<k> bands (the Nyx dress's crown, TODO 4.7: see \"m15nyxcrown\") cut round the ▼ back's RIGHT well exactly as m15dfccrownright cuts m15crown (scripts/lib/cc-frames.mjs cutCrownBand, DFC_CROWN_WELLS.right) through the alpha of Card Conjurer's '(Back)' crown twins (img/frames/m15/transform/crowns/regular/new/<k>.png, never published)",
  output: `1500x${CROWN_BAND.rows}, webp q90`,
  recipe: {},
  colors: {},
  sourceFiles: [],
  notes: [
    "TODO 4.5d part B: the crown of the saga creature's back (sagacreaturedfcback) — FIN #16, #58, #104, #133, #229, #245 print the Nyx crown wrapped round the ▼ well",
    "outside the well region (x 1264–1419 × y 93–225) the piece is the m15nyxcrown band byte for byte; the starfield strip (16.37–83.68 %W) ends left of it",
    "keys: w u b r g m and a (c → a); no pairs (the body has no pair masters)",
  ],
};
const crownFiles = new Set();
for (const key of CROWN_KEYS) {
  const band = published(`m15nyxcrown/${key}`);
  const { data: bandPixels, info: bandInfo } = await rgbaAny(band.file);
  if (bandInfo.width !== W || bandInfo.height !== CROWN_BAND.rows) throw new Error(`m15nyxcrown/${key}: ${bandInfo.width}×${bandInfo.height}, the band is ${W}×${CROWN_BAND.rows}`);
  const twinRel = `${CROWN_TWIN_DIR}/${twinLetterFor(key, DFC_CROWN_WELLS.right)}.png`;
  const twinFile = await ccFile(twinRel);
  const { data: twinPixels, info: twinInfo } = await rgbaAny(twinFile);
  if (twinInfo.width !== DFC_CROWN_TWIN_SIZE.width || twinInfo.height !== DFC_CROWN_TWIN_SIZE.height) throw new Error(`${twinRel} is ${twinInfo.width}×${twinInfo.height}, the twins are 1418×350`);
  const twin = placeTwin(twinPixels, CROWN_BAND.rows);
  const { piece, circle } = cutCrownBand(bandPixels, twin, DFC_CROWN_WELLS.right, W, CROWN_BAND.rows);
  const findings = cutCrownFindings(piece, bandPixels, twin, DFC_CROWN_WELLS.right, circle, W, CROWN_BAND.rows);
  if (findings.failures.length) throw new Error(`${CROWN_FOLDER}/${key}: ${findings.failures.join("; ")}`);
  crownRecord.colors[key] = [`m15nyxcrown/${key}.png@${band.sha.slice(0, 12)}`, `cc:${twinRel}@${sha(fs.readFileSync(twinFile)).slice(0, 12)} (alpha in the well region)`];
  crownRecord.recipe[key] = `the well's circle (${circle.cx.toFixed(1)}, ${circle.cy.toFixed(1)}) r ${circle.r.toFixed(1)} (fit ${circle.maxErr.toFixed(2)} px), its hole ending at row ${findings.holeBottom}`;
  crownFiles.add(`m15nyxcrown/${key}.png`).add(`cc:${twinRel}`);
  if (!dryRun) await writePair(`${CROWN_FOLDER}/${key}`, piece, W, CROWN_BAND.rows, WEBP);
  console.log(`✓ ${CROWN_FOLDER}/${key}  ${crownRecord.recipe[key]}`);
}
crownRecord.sourceFiles = [...crownFiles].sort();

record.sourceFiles = [...files].sort();
if (!dryRun) {
  provenance[TEMPLATE] = record;
  provenance[CROWN_FOLDER] = crownRecord;
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
}
console.log(`${written} masters, ${PLATE_KEYS.length} plates, ${CROWN_KEYS.length} crown pieces → ${outDir}`);
