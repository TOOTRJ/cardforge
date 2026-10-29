#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-mdfc-colourless-frames.mjs — the modal double-faced bodies'
// SEE-THROUGH colourless masters (TODO 5.11a, STX #6 Wandering Archaic):
// PipGlyph's own composite of masters the frames bucket already publishes,
// laid through Card Conjurer's modal masks (the recipe and every number:
// scripts/lib/mdfc-colourless.mjs).
//
//   m15mdfcfront/c          m15mdfcfront/a's housing, outline and strip
//                           (toned onto print's warm grey tab) over m15/c's
//                           see-through frame field, bars and box
//   m15mdfcback/c           m15mdfcback/a's housing (▲▼), outline and light
//                           strip over m15/c's pieces at print's back ÷
//                           front luma
//   m15mdfcfront/strip/c    each master's tab, cut as the importer cuts the
//   m15mdfcback/strip/c     strip riders (MDFC_STRIP_CUTS: the Flipside
//                           mask's interior eroded 1 px, 2 × 2 blocks)
//
//   node scripts/build-mdfc-colourless-frames.mjs                # → .frames-build
//   node scripts/build-mdfc-colourless-frames.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only m15mdfcfront,m15mdfcback --write
//
// The masters are local copies of the PUBLISHED ones, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build); Card
// Conjurer's MASKS come from the pinned commit (CC_CACHE, default
// ~/.cache/pipglyph-cc/<commit>) and are never published. The output is
// gitignored and NEVER committed. Provenance → lib/cards/frame-sources.json
// ("mdfccolourless"); the importer leaves these two `c` keys out
// (scripts/lib/cc-frames.mjs MDFC_COLOURLESS_EXCLUDED).
//
// Each WebP's ALPHA must equal its PNG's exactly: the run decodes every WebP
// it wrote and refuses a difference.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { CC_COMMIT, CC_RAW, MDFC_STRIP_CUTS, WEBP, cutStripRider, stripRiderFindings, stripRiderInterior } from "./lib/cc-frames.mjs";
import {
  BACK_LUMA_GAINS,
  BAR_X,
  FRONT_STRIP_TONE,
  H,
  MDFC_COLOURLESS_BODIES,
  MDFC_COLOURLESS_MASKS,
  PINLINE_TONE,
  READ_REGIONS,
  ROW_FILL_X,
  SEE_THROUGH_MASTER,
  SEE_THROUGH_READS,
  STRIP_TONE_LUMA_RAMP,
  W,
  blendThrough,
  readOpaqueTone,
  readPinline,
  scaleThrough,
  titleLayer,
  toneThrough,
} from "./lib/mdfc-colourless.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const cacheDir = process.env.CC_CACHE ?? path.join(os.homedir(), ".cache", "pipglyph-cc", CC_COMMIT);
const PROVENANCE = "lib/cards/frame-sources.json";
const RECORD = "mdfccolourless";
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
/** A Card Conjurer mask at 1500 × 2100, rasterised as the importer does
 *  (sharp at density 300, lanczos3): its RGBA and its alpha plane. */
async function mask(rel) {
  const file = await ccFile(rel);
  const { data } = await sharp(file, { density: 300 }).resize(W, H, { fit: "fill", kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const plane = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) plane[i] = data[i * 4 + 3];
  return { rgba: data, plane, sha: sha(fs.readFileSync(file)) };
}

const masks = {};
for (const [name, rel] of Object.entries(MDFC_COLOURLESS_MASKS)) masks[name] = await mask(rel);

const see = published(SEE_THROUGH_MASTER);
const seePixels = await rgba(see.file);
// m15/c as the table read it: a re-published see-through master is a new
// look, never taken silently.
for (const [region, want] of Object.entries(SEE_THROUGH_READS)) {
  const read = readOpaqueTone(seePixels, READ_REGIONS[region]);
  const drift = Math.max(...read.map((v, c) => Math.abs(v - want[c])));
  if (drift > 2) throw new Error(`${SEE_THROUGH_MASTER}: the ${region} reads ${read.join(",")}, the table says ${want.join(",")}`);
}

const provenance = JSON.parse(fs.readFileSync(PROVENANCE, "utf8"));
const record = {
  source: "pipglyph",
  repo: "Investigamer/cardconjurer",
  commit: CC_COMMIT,
  converter: "scripts/build-mdfc-colourless-frames.mjs",
  derivedFrom:
    "the published m15/c master (the see-through colourless 'Eldrazi' frame, TODO 4.17; Card Conjurer imports: see \"m15\") laid over the published m15mdfcfront/a and m15mdfcback/a masters (the 'Modal Regular' artifact frames, Card Conjurer imports: see \"m15mdfcfront\" / \"m15mdfcback\") through Card Conjurer's modal masks — the frame field, box, type bar and title bar m15/c's (the housing's drop filled with m15/c's bar row by row, the ▲ / ▲▼ the modal master's), the lines and the strip the modal master's, toned (scripts/lib/mdfc-colourless.mjs)",
  output: "1500x2100, the modal master's border and corners, webp q90 with the PNG's alpha exactly; strip/c.png the tab at 1:1",
  recipe: {
    masks: Object.fromEntries(Object.entries(MDFC_COLOURLESS_MASKS).map(([k, rel]) => [k, `cc:${rel}@${masks[k].sha.slice(0, 12)}`])),
    layers:
      "base = the modal artifact master; frame.svg ← m15/c; textbox.svg ← m15/c (back: × the box gain); m15MaskType.png ← m15/c (back: × the type gain); title.svg ← m15/c's bar from x " +
      `${BAR_X} px, the housing's drop m15/c's bar row by row (median of x ${ROW_FILL_X.join("–")}) with the modal master's glyph and inner edge over it (back: × the title gain, before the glyph); pinline.svg ← the modal master's lines toned onto m15/c's; reminder.svg ← the modal master's strip (front: toned onto print's tab, luma ramp ${STRIP_TONE_LUMA_RAMP.join("–")})`,
    backLumaGains: { ...BACK_LUMA_GAINS },
    frontStripTone: `${FRONT_STRIP_TONE.from.join(",")} → ${FRONT_STRIP_TONE.to.join(",")} (STX #6 Wandering Archaic's tab)`,
    pinlineTone: {},
  },
  colors: {},
  changedPixels: {},
  sourceFiles: [],
  notes: [
    "TODO 5.11a: STX #6 Wandering Archaic // Explore the Vastlands (and PSTX #6s) — the one modal card whose faces are colourless with no Artifact word; both print the SEE-THROUGH colourless frame with the modal housing and strip. No Card Conjurer pack draws it ('Modal Regular' has Artifact and Land frames only). Before it, the bodies' `c` was the artifact master standing in (design D2), which a colourless ARTIFACT face never drew (it wears `a`: FrameProfile.artifactMasterKeys)",
    "the back's bars and box at print's back ÷ front LUMA (BACK_LUMA_GAINS), m15/c's neutral grey kept — both faces show the same card's art through them, so the ratio leaves the art's cast out; the back strip is the modal back's as published (STX #6's back tab 226,220,230 against 223,225,229)",
    "no crown, pair, stamp or nickname piece of its own: a legendary colourless non-artifact modal face was never printed (the crown overlay keeps its `c` → `a` band)",
  ],
};
const files = new Set([`${SEE_THROUGH_MASTER}.png`, ...Object.values(MDFC_COLOURLESS_MASKS).map((rel) => `cc:${rel}`)]);

async function writeMaster(pixels, pngFile, width, height) {
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  const image = sharp(pixels, { raw: { width, height, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
  const webpFile = pngFile.replace(/\.png$/, ".webp");
  await image.clone().webp(BODY_WEBP).toFile(webpFile);
  const a = await sharp(pngFile).ensureAlpha().raw().toBuffer();
  const b = await sharp(webpFile).ensureAlpha().raw().toBuffer();
  for (let i = 3; i < a.length; i += 4) {
    if (a[i] !== b[i]) throw new Error(`${pngFile}: WebP alpha differs from the PNG's at px ${(i - 3) / 4}`);
  }
}

let written = 0;
for (const [template, body] of Object.entries(MDFC_COLOURLESS_BODIES)) {
  const base = published(body.base);
  const modal = await rgba(base.file);
  const back = body.face === "back";

  // The lines: the modal master's, toned onto m15/c's (re-read: ±2).
  const pinFrom = readPinline(modal, masks.pinline.plane);
  const pinTo = readPinline(seePixels, masks.pinline.plane);
  const pinTable = PINLINE_TONE[body.face];
  for (const [what, read, want] of [["from", pinFrom, pinTable.from], ["to", pinTo, pinTable.to]]) {
    const drift = Math.max(...read.map((v, c) => Math.abs(v - want[c])));
    if (drift > 2) throw new Error(`${template}/c: the pinline's ${what} reads ${read.join(",")}, the table says ${want.join(",")}`);
  }
  record.recipe.pinlineTone[body.face] = `${pinTable.from.join(",")} → ${pinTable.to.join(",")}`;

  // m15/c as this face shows it: the back's bars and box at print's luma.
  const seen = Buffer.from(seePixels);
  if (back) {
    scaleThrough(seen, masks.title.plane, BACK_LUMA_GAINS.title);
    scaleThrough(seen, masks.type.plane, BACK_LUMA_GAINS.type);
    scaleThrough(seen, masks.rules.plane, BACK_LUMA_GAINS.rules);
  }
  const lines = Buffer.from(modal);
  for (let p = 0; p < W * H; p += 1) {
    if (masks.pinline.plane[p] === 0) continue;
    for (let c = 0; c < 3; c += 1) lines[p * 4 + c] = Math.min(255, Math.round(lines[p * 4 + c] * (pinTable.to[c] / pinTable.from[c])));
  }
  const strip = Buffer.from(modal);
  if (!back) toneThrough(strip, masks.reminder.plane, FRONT_STRIP_TONE);

  const out = Buffer.from(modal);
  const changes = {
    frame: blendThrough(out, seePixels, masks.frame.plane),
    box: blendThrough(out, seen, masks.rules.plane),
    type: blendThrough(out, seen, masks.type.plane),
    title: blendThrough(out, titleLayer(seen, modal), masks.title.plane),
    pinline: blendThrough(out, lines, masks.pinline.plane),
    strip: blendThrough(out, strip, masks.reminder.plane),
  };
  const reads = Object.fromEntries(
    ["title", "type", "rules", "strip"].map((region) => [region, readOpaqueTone(out, READ_REGIONS[region]).join(",")]),
  );
  record.colors[`${template}/c`] = [
    `${body.base}.png@${base.sha.slice(0, 12)} (base: border, housing outline, lines, strip)`,
    `${SEE_THROUGH_MASTER}.png@${see.sha.slice(0, 12)} (frame field, box, bars, housing fill)`,
  ];
  record.changedPixels[`${template}/c`] = { ...changes, reads };
  files.add(`${body.base}.png`);

  // The strip rider piece `c` (TODO 5.1c's cut).
  const spec = MDFC_STRIP_CUTS[template];
  const inside = stripRiderInterior(masks.reminder.rgba, W, H, spec);
  const piece = cutStripRider(out, inside, W, spec.box);
  const findings = stripRiderFindings(piece, out, inside, W, H, spec.box);
  if (findings.failures.length > 0) throw new Error(`${template}/strip/c: ${findings.failures.join("; ")}`);
  record.colors[`${template}/strip/c`] = [`${template}/c.png (this run), the tab through ${spec.mask} eroded ${spec.erode} px, ${spec.snap} × ${spec.snap} blocks, box ${spec.box.x},${spec.box.y} ${spec.box.width}×${spec.box.height}`];

  if (!dryRun) {
    await writeMaster(out, path.join(outDir, template, "c.png"), W, H);
    await writeMaster(piece, path.join(outDir, template, "strip", "c.png"), spec.box.width, spec.box.height);
    written += 2;
  }
  console.log(`✓ ${template}/c  ${Object.entries(changes).map(([g, n]) => `${g} ${n}`).join("; ")}  reads ${JSON.stringify(reads)}`);
  console.log(`✓ ${template}/strip/c  ${findings.opaque} opaque px`);
}
record.sourceFiles = [...files].sort();
if (!dryRun) {
  provenance[RECORD] = record;
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
}
console.log(`${written} files → ${outDir}`);
