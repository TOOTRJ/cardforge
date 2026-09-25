#!/usr/bin/env node
// ---------------------------------------------------------------------------
// import-cc-frames.mjs — build the M15-era frame masters from Card Conjurer's
// frame packs into .frames-build/ (frames plan 4.3; owner decision
// 2026-09-25: Card Conjurer art for the M15 era, MSE for showcase families
// and the old borders).
//
//   node scripts/import-cc-frames.mjs                 # every template
//   node scripts/import-cc-frames.mjs --only m15,m15land
//   node scripts/import-cc-frames.mjs --dry-run       # print the recipe only
//   CC_CACHE=/path  (source cache; default ~/.cache/pipglyph-cc/<commit>)
//   --out <dir>     (default .frames-build — gitignored)
//
// For each template × colour it downloads the pack files from the PINNED
// commit (cached outside the repo), composites layers through their masks
// where a real frame is a blend, resizes 2010×2814 → 1500×2100 with Lanczos,
// rounds the corners, and writes <out>/<template>/<colour>.png + .webp, plus
// P/T plates at native size under pt/. Provenance (which source files made
// which frame, and every substitution) goes to lib/cards/frame-sources.json.
//
// Nothing here touches public/frames or any bucket. Next:
//   npm run frames:publish -- --source .frames-build [--only …] --write
// (docs/FRAMES.md). The converted frames are never committed — see
// scripts/lib/cc-frames.mjs for why.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  CC_COMMIT,
  CC_RAW,
  CC_REPO,
  CC_TEMPLATES,
  COLORS,
  CORNER_RADIUS,
  OUT_H,
  OUT_W,
  WEBP,
  compositeLayers,
  roundCorners,
  sourceFilesFor,
  toRgba8,
} from "./lib/cc-frames.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? "") : null;
};
const dryRun = args.includes("--dry-run");
const only = flag("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const cacheDir = process.env.CC_CACHE ?? path.join(os.homedir(), ".cache", "pipglyph-cc", CC_COMMIT);
const PROVENANCE = "lib/cards/frame-sources.json";

if (only) {
  const unknown = only.filter((t) => !CC_TEMPLATES[t]);
  if (unknown.length) {
    console.error(`✗ Unknown template(s): ${unknown.join(", ")}. Known: ${Object.keys(CC_TEMPLATES).join(", ")}`);
    process.exit(1);
  }
}

async function fetchCached(rel) {
  const file = path.join(cacheDir, rel);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const res = await fetch(`${CC_RAW}/${rel}`, { headers: { "User-Agent": "PipGlyph-cc-import/1.0" } });
  if (!res.ok) throw new Error(`${res.status} fetching ${rel} from ${CC_REPO}@${CC_COMMIT.slice(0, 7)}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Raw RGBA of an image resized to the output grid (SVG masks rasterise). */
async function rgba(file) {
  const { data } = await sharp(file, { density: 300 })
    .resize(OUT_W, OUT_H, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function writeMaster(bytes, pngFile) {
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  const image = sharp(bytes, { raw: { width: OUT_W, height: OUT_H, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
  await image.clone().webp(WEBP).toFile(pngFile.replace(/\.png$/, ".webp"));
}

async function writePlate(src, pngFile) {
  fs.mkdirSync(path.dirname(pngFile), { recursive: true });
  // Plates keep their native size; the renderer scales them into the slot.
  const image = sharp(await fetchCached(src));
  await image.clone().png({ compressionLevel: 9 }).toFile(pngFile);
  await image.clone().webp(WEBP).toFile(pngFile.replace(/\.png$/, ".webp"));
}

const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
for (const [template, def] of Object.entries(CC_TEMPLATES)) {
  if (only && !only.includes(template)) continue;
  const recipe = {};
  for (const key of COLORS) {
    recipe[key] = def.colors[key].map((l) => (l.mask ? `${l.src} through ${l.mask}` : l.src));
    const out = path.join(outDir, template, `${key}.png`);
    if (dryRun) {
      console.log(`${path.relative(process.cwd(), out)} ← ${recipe[key].join(" + ")}`);
      continue;
    }
    const images = [];
    for (const l of def.colors[key]) {
      images.push({
        data: await rgba(await fetchCached(l.src)),
        mask: l.mask ? await rgba(await fetchCached(l.mask)) : undefined,
      });
    }
    const acc = compositeLayers(images, OUT_W, OUT_H);
    roundCorners(acc, OUT_W, OUT_H, CORNER_RADIUS);
    await writeMaster(toRgba8(acc), out);
    console.log(`wrote ${path.relative(process.cwd(), out)} (+ .webp)`);
  }
  const plates = def.plates ? { ...def.plates } : undefined;
  if (plates && !dryRun) {
    for (const key of COLORS) await writePlate(plates[key], path.join(outDir, template, "pt", `${key}.png`));
    console.log(`wrote ${template} plates`);
  }
  provenance[template] = {
    source: "cardconjurer",
    repo: CC_REPO,
    commit: CC_COMMIT,
    converter: "scripts/import-cc-frames.mjs",
    output: `${OUT_W}x${OUT_H}, corners rounded to ${CORNER_RADIUS}px, webp q${WEBP.quality}`,
    colors: recipe,
    ...(plates ? { plates } : {}),
    sourceFiles: sourceFilesFor(def),
    notes: def.notes,
  };
}
if (!dryRun) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
