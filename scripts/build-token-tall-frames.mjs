#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-token-tall-frames.mjs — the 2014–19 arch token's TALL text box
// (TODO 4.55): PipGlyph's OWN derivation from the text-box masters already
// published in the frames bucket. No Card Conjurer file and no scan is read;
// the recipe, the measurements behind it and the cut are
// scripts/lib/token-tall.mjs (TOKEN_TALL_RECIPE, recutTokenTall).
//
//   m15tokentall/<w u b r g m c>          from the published m15tokentext/<key>
//   m15tokenartifacttall/<w u b r g m c>  from the published m15tokenartifacttext/<key>
//
// One cut: the window's lower rows, the type pill and the box's top edge move
// 238 px up as one piece; the box is 238 px taller (its paper continued, the
// frame's sides from the rows beside the window). Every other pixel is the
// parent master's.
//
//   node scripts/build-token-tall-frames.mjs                # → .frames-build
//   node scripts/build-token-tall-frames.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only m15tokentall,m15tokenartifacttall --write
//
// The sources are local copies of the PUBLISHED masters, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build). The output is
// gitignored: a master derived from a Card Conjurer-derived master never
// enters git. Provenance → lib/cards/frame-sources.json.
//
// The WebP sibling's ALPHA must equal the PNG's exactly (the browser preview
// reads the WebP, the bake the PNG): the run decodes every WebP it wrote and
// refuses a difference.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { WEBP } from "./lib/cc-frames.mjs";
import { TOKEN_TALL_RECIPE as RECIPE, recutTokenTall } from "./lib/token-tall.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const { width: W, height: H, up, fromY, toY, boxLeft, boxRight, blendTop, blendSide, blendBottom } = RECIPE;
const TALL_WEBP = { ...WEBP, alphaQuality: 100 };

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

const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
for (const [template, from] of Object.entries(RECIPE.templates)) {
  const colors = {};
  for (const key of RECIPE.keys) {
    const src = published(`${from}/${key}`);
    const data = await raw(src.file);
    const out = recutTokenTall(data);
    // Nothing outside the cut's rows changes.
    for (let y = 0; y < H; y += 1) {
      if (y >= fromY - up && y < toY) continue;
      const o = y * W * 4;
      if (Buffer.compare(out.subarray(o, o + W * 4), data.subarray(o, o + W * 4)) !== 0) throw new Error(`${template}/${key}: row ${y} changed outside the cut`);
    }
    colors[key] = [`${from}/${key}.png (published, sha256 ${src.sha.slice(0, 12)})`];
    if (dryRun) {
      console.log(`${template}/${key}: cut (dry run)`);
      continue;
    }
    const png = path.join(outDir, template, `${key}.png`);
    fs.mkdirSync(path.dirname(png), { recursive: true });
    const image = sharp(out, { raw: { width: W, height: H, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(png);
    const webp = png.replace(/\.png$/, ".webp");
    await image.clone().webp(TALL_WEBP).toFile(webp);
    const back = await raw(webp);
    for (let i = 0; i < W * H; i += 1) {
      if (back[i * 4 + 3] !== out[i * 4 + 3]) throw new Error(`${webp}: alpha differs from the PNG's at ${i % W},${Math.floor(i / W)} (${back[i * 4 + 3]} ≠ ${out[i * 4 + 3]})`);
    }
    console.log(`wrote ${path.relative(process.cwd(), png)} (+ .webp, alpha equal) from ${from}/${key}`);
  }
  provenance[template] = {
    source: "pipglyph",
    converter: "scripts/build-token-tall-frames.mjs",
    derivedFrom: `the published ${from}/<key> masters of the frames bucket (themselves Card Conjurer imports, re-cut onto the prints: see "${from}")`,
    output: `${W}x${H}, the parent's corners, webp q${WEBP.quality} with the PNG's alpha exactly`,
    recipe: {
      move: `rows ${fromY}–${toY - 1} (the window's straight sides through the box's top edge and first paper rows) ${up} px UP as one piece, faded in from the original rows over ${blendTop} rows`,
      box: `the ${up} rows gained (${toY - up}–${toY - 1}): the box's paper columns x ${boxLeft}–${boxRight - 1} continue the moved band (rows ${toY}–${toY + up - 1}); the side columns take the rows ${up} px above them (beside the window's straight sides), faded from the moved band over ${blendSide} rows; every column into the original rows over ${blendBottom} rows at ${toY}`,
      untouched: `every row above ${fromY - up} and from ${toY} on is the parent's, byte for byte`,
    },
    colors,
    sourceFiles: RECIPE.keys.map((key) => `${from}/${key}.png`).sort(),
    notes: [
      "PipGlyph's own derivation (TODO 4.55; owner 2026-09-29, round 10): Card Conjurer has no source for the arch token's tall box. Nothing is drawn or synthesised: every pixel is the parent master's, moved or cross-faded.",
      "The numbers are scripts/lib/token-tall.mjs (the 21 tall-box printings measured 2026-10-18: the pill, the window's bottom edge and the box's top 238 px above the regular box's; the title, arch, box bottom, plate and border where the master draws them; the box's tone the regular box's); no scan is read by the build.",
    ],
  };
}

if (!dryRun) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
