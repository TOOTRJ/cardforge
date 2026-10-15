#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-dfc-borderless-frames.mjs — the dark ("inverted") borderless
// double-faced bodies' masters (TODO 5.7): PipGlyph's own derivation, the
// published m15borderless masters with the double-faced pieces grafted from
// Card Conjurer's LIGHT borderless DFC packs (the recipe and why:
// scripts/lib/dfc-borderless.mjs).
//
//   m15borderlessdfcfront/<key>   the icon well (left) + the reverse-P/T tab
//   m15borderlessdfcback/<key>    the ▼ well (right)
//   m15borderlessmdfcfront/<key>  the modal housing (▲) + the flipside strip
//   m15borderlessmdfcback/<key>   the modal housing (▲▼) + the light strip
// keys: w u b r g m a c, the ten split pairs, each with its `-legendary`
// twin (the floating crown, from m15borderless's own twin).
//
//   node scripts/build-dfc-borderless-frames.mjs                # → .frames-build
//   node scripts/build-dfc-borderless-frames.mjs --out <dir> [--masters <dir>] [--only a,b]
//   npm run frames:publish -- --source .frames-build --only m15borderlessdfcfront,… --write
//
// The dark sources are local copies of the PUBLISHED masters, each
// sha256-checked against lib/frames/frame-manifest.json (--masters,
// FRAMES_BUILD_DIR, .frames-cache — scripts/frames-fetch.mjs — or
// .frames-build); the light packs come from Card Conjurer at the pinned
// commit (CC_CACHE, default ~/.cache/pipglyph-cc/<commit>). The output is
// gitignored and NEVER committed: it carries Card Conjurer pixels.
// Provenance → lib/cards/frame-sources.json.
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
  DFC_BORDERLESS_TEMPLATES,
  GRAFTS,
  H,
  W,
  applyGraft,
  STRIP_RIDER_KEYS,
  bodyKeys,
  borderedBackDiscOf,
  darkBaseOf,
  lightLetterOf,
  mirrorX,
  monoBaseOf,
} from "./lib/dfc-borderless.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const only = flag("--only")?.split(",").filter(Boolean) ?? null;
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const cacheDir = process.env.CC_CACHE ?? path.join(os.homedir(), ".cache", "pipglyph-cc", CC_COMMIT);
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const BODY_WEBP = { ...WEBP, alphaQuality: 100 };

if (only) {
  const unknown = only.filter((t) => !DFC_BORDERLESS_TEMPLATES[t]);
  if (unknown.length) throw new Error(`unknown template(s) ${unknown.join(", ")}`);
}

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
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const rawCache = new Map();
async function raw(file) {
  if (rawCache.has(file)) return rawCache.get(file);
  const { data, info } = await sharp(file, { density: 300 })
    .resize(W, H, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== W || info.height !== H) throw new Error(`${file}: ${info.width}×${info.height}`);
  rawCache.set(file, data);
  return data;
}
async function maskPlane(file) {
  const data = await raw(file);
  const plane = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) plane[i] = data[i * 4 + 3];
  return plane;
}

const provenance = JSON.parse(fs.readFileSync(PROVENANCE, "utf8"));
const templates = Object.keys(DFC_BORDERLESS_TEMPLATES).filter((t) => !only || only.includes(t));
const keys = bodyKeys();
let written = 0;
for (const template of templates) {
  const def = DFC_BORDERLESS_TEMPLATES[template];
  const record = {
    source: "pipglyph",
    repo: "Investigamer/cardconjurer",
    commit: CC_COMMIT,
    converter: "scripts/build-dfc-borderless-frames.mjs",
    derivedFrom:
      "the published m15borderless / m15borderlessartifact masters of the frames bucket (Card Conjurer imports: see \"m15borderless\") with pieces of Card Conjurer's LIGHT borderless double-faced packs grafted in (and, on the ▼ back, the published m15dfcback disc)",
    output: "1500x2100, the dark master's corners, webp q90 with the PNG's alpha exactly",
    colors: {},
    changedPixels: {},
    sourceFiles: [],
  };
  const files = new Set();
  for (const key of keys) {
    const base = published(darkBaseOf(key));
    const dark = await raw(base.file);
    const out = Buffer.from(dark);
    const sources = [`${darkBaseOf(key)}.png@${base.sha.slice(0, 12)}`];
    const changes = {};
    for (const spec of def.grafts) {
      const side = GRAFTS[spec.graft].side;
      const letter = lightLetterOf(key, side);
      const lightRel = spec.light(letter);
      const lightFile = await ccFile(lightRel);
      sources.push(`cc:${lightRel}@${sha(lightFile).slice(0, 12)}${spec.mirror ? " (mirrored)" : ""}`);
      let light = await raw(lightFile);
      if (spec.mirror) light = mirrorX(light);
      const monoRel = monoBaseOf(key, side);
      const mono = await raw(published(monoRel).file);
      let disc = null;
      if (spec.borderedDisc) {
        const d = published(borderedBackDiscOf(key));
        sources.push(`${borderedBackDiscOf(key)}.png@${d.sha.slice(0, 12)} (disc)`);
        disc = await raw(d.file);
      }
      let mask = null;
      if (spec.mask) {
        const m = await ccFile(spec.mask);
        sources.push(`cc:${spec.mask}@${sha(m).slice(0, 12)} (mask)`);
        mask = await maskPlane(m);
      }
      changes[spec.graft] = applyGraft(out, dark, light, mono, spec, { disc, mask });
    }
    const pngFile = path.join(outDir, template, `${key}.png`);
    fs.mkdirSync(path.dirname(pngFile), { recursive: true });
    const image = sharp(out, { raw: { width: W, height: H, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
    const webpFile = pngFile.replace(/\.png$/, ".webp");
    await image.clone().webp(BODY_WEBP).toFile(webpFile);
    // The WebP's alpha must equal the PNG's.
    const a = await sharp(pngFile).ensureAlpha().raw().toBuffer();
    const b = await sharp(webpFile).ensureAlpha().raw().toBuffer();
    for (let i = 3; i < a.length; i += 4) {
      if (a[i] !== b[i]) throw new Error(`${template}/${key}: WebP alpha differs from the PNG's at px ${(i - 3) / 4}`);
    }
    record.colors[key] = sources;
    record.changedPixels[key] = changes;
    for (const src of sources) files.add(src.replace(/@.*/, ""));
    written++;
    console.log(`✓ ${template}/${key}  ${Object.entries(changes).map(([g, n]) => `${g} ${n}`).join(", ")}`);
  }
  record.transforms =
    "native 1500x2100, no resample: the published dark master whole; in each graft rect the light pack's pixels with its translucent interior re-coloured to the dark master's interior of the same row (shade transfer), the ▼ back's disc the bordered back's; a crowned twin's or pair's own pixels kept over a copied rim (scripts/lib/dfc-borderless.mjs)";
  record.notes = [
    `${def.label}: grafts ${def.grafts.map((g) => g.graft).join(", ")}`,
    "the dark (`inverted`) look of 98 of the 134 plain borderless transform / modal printings (Scryfall 2026-10-14); Card Conjurer draws only the light one",
    "c = a (the artifact stand-in, as on the bordered bodies); pairs = m15borderless's split pairs, the well's / housing's side in the colour on that side",
  ];
  record.sourceFiles = [...files].sort();
  // The modal bodies' flipside strip RIDERS (TODO 5.1c's model): this
  // template's own mono masters' tabs cut through CC's Flipside mask, eroded
  // 1 px and snapped to the HD grid's 2 × 2 blocks (cc-frames.mjs
  // cutStripRider) — the light pack's tab in each colour, drawn over the
  // strip the master paints in the OTHER face's colour.
  if (template.includes("mdfc")) {
    const spec = { ...MDFC_STRIP_CUTS.m15mdfcfront, keys: STRIP_RIDER_KEYS, extra: undefined };
    const inside = stripRiderInterior(await raw(await ccFile(spec.mask)), W, H, spec);
    const strip = { mask: spec.mask, box: spec.box, erodePx: spec.erode, snapPx: spec.snap, keys: STRIP_RIDER_KEYS, output: "strip/<key>.png (+ .webp), the piece's box at 1:1", colors: {} };
    for (const key of STRIP_RIDER_KEYS) {
      const masterFile = path.join(outDir, template, `${key}.png`);
      const master = await sharp(masterFile).ensureAlpha().raw().toBuffer();
      const piece = cutStripRider(master, inside, W, spec.box);
      const findings = stripRiderFindings(piece, master, inside, W, H, spec.box);
      // (A light pack's tab is not opaque everywhere a bordered master's is:
      // its few anti-aliased pixels inside the cut are kept as they are.)
      const failures = findings.failures.filter((f) => !/partial-alpha/.test(f));
      if (failures.length) throw new Error(`${template}/strip/${key}: ${failures.join("; ")}`);
      const out = path.join(outDir, template, "strip", `${key}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const image = sharp(piece, { raw: { width: spec.box.width, height: spec.box.height, channels: 4 } });
      await image.clone().png({ compressionLevel: 9 }).toFile(out);
      await image.clone().webp(BODY_WEBP).toFile(out.replace(/\.png$/, ".webp"));
      strip.colors[key] = [`${template}/${key}.png (this run) cut through ${spec.mask}, eroded ${spec.erode} px, snapped to ${spec.snap} px blocks`];
      console.log(`✓ ${template}/strip/${key}  ${findings.opaque} opaque px`);
    }
    record.strip = strip;
  }
  provenance[template] = record;
}
if (templates.length) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
}
console.log(`${written} masters → ${outDir}`);
