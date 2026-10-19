#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-token-nyx.mjs — the full-art token's Nyx dress (TODO 4.51):
// PipGlyph's OWN composite of a starfield in the NAME PILL of the full-art
// token masters already published in the frames bucket. No Card Conjurer
// file and no scan is read; the recipe and what print does are
// scripts/lib/token-nyx.mjs.
//
//   m20tokennyx/<key>             from the published m20token/<key>
//   m20tokennyxtext/<key>         from m20tokentext/<key>
//   m20tokennyxtall/<key>         from m20tokentall/<key>
//   m20tokenartifactnyx…/<key>    from m20tokenartifact…/<key>
//   (keys w u b r g c m; no pairs)
//
//   node scripts/build-token-nyx.mjs                # → .frames-build
//   node scripts/build-token-nyx.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only m20tokennyx,… --write
//
// The sources are local copies of the PUBLISHED masters, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build), and the
// Magic Set Editor constellation master public/frames/nyx/b.png (git). The
// output is gitignored: a master cut from a Card Conjurer-derived master
// never enters git. Provenance → lib/cards/frame-sources.json.
//
// Every byte outside the name pill's face equals the published master's
// (the run refuses otherwise), alpha is never touched, and the WebP
// sibling's ALPHA must equal the PNG's exactly.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { WEBP } from "./lib/cc-frames.mjs";
import { TOKEN_NYX_RECIPE as RECIPE, dressTokenNyx, isArtifactNyx, tokenNyxRegion, tokenNyxStarfield } from "./lib/token-nyx.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const { width: W, height: H } = RECIPE;

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

async function raw(file, w = W, h = H) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h) throw new Error(`${file}: ${info.width}×${info.height}, expected ${w}×${h}`);
  return data;
}

const bandSrc = published(RECIPE.hole.band);
const bandMeta = await sharp(bandSrc.file).metadata();
const band = await raw(bandSrc.file, W, bandMeta.height);
const alphaSrc = published(RECIPE.alpha.master);
const { weight, count } = tokenNyxRegion(band, bandMeta.height, await raw(alphaSrc.file));
const starsSha = createHash("sha256").update(fs.readFileSync(RECIPE.starfield)).digest("hex");
const { layer, median: starsMedian } = tokenNyxStarfield(await raw(RECIPE.starfield), 4, weight);
console.log(`region: ${count} px; starfield median luma ${starsMedian.toFixed(1)}`);

const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
const report = [];
for (const [template, from] of Object.entries(RECIPE.templates)) {
  const colors = {};
  const sourceFiles = [];
  for (const key of RECIPE.keys) {
    const src = published(`${from}/${key}`);
    sourceFiles.push(`${from}/${key}.png`);
    const master = await raw(src.file);
    const target = isArtifactNyx(template) ? RECIPE.targets.artifact : RECIPE.targets.plain[key];
    const { out, offsets, changed } = dressTokenNyx(master, weight, layer, target);
    for (let p = 0; p < W * H; p++) {
      const o = p * 4;
      if (out[o + 3] !== master[o + 3]) throw new Error(`${template}/${key}: alpha changed at ${p % W},${Math.floor(p / W)}`);
      if (weight[p] <= 0 && (out[o] !== master[o] || out[o + 1] !== master[o + 1] || out[o + 2] !== master[o + 2])) {
        throw new Error(`${template}/${key}: a pixel outside the pill changed at ${p % W},${Math.floor(p / W)}`);
      }
    }
    const g = offsets.map((v) => (v >= 0 ? "+" : "") + v.toFixed(1)).join(" / ");
    colors[key] = [
      `${from}/${key}.png (published, sha256 ${src.sha.slice(0, 12)})`,
      `the name pill's face (${count} px): P + (${g}) + ${RECIPE.k} × (starfield luma − ${starsMedian.toFixed(1)}), ${target ? `onto print's median ${target.join("/")}` : "its own median kept (no print)"}; ${changed} px changed`,
    ];
    report.push(`${template}/${key}: offsets ${g}, ${changed} px`);
    if (dryRun) continue;
    const png = path.join(outDir, template, `${key}.png`);
    fs.mkdirSync(path.dirname(png), { recursive: true });
    const image = sharp(out, { raw: { width: W, height: H, channels: 4 } });
    await image.clone().png({ compressionLevel: 9 }).toFile(png);
    const webp = png.replace(/\.png$/, ".webp");
    await image.clone().webp({ ...WEBP, alphaQuality: 100 }).toFile(webp);
    const back = await raw(webp);
    for (let p = 0; p < W * H; p++) {
      if (back[p * 4 + 3] !== out[p * 4 + 3]) throw new Error(`${webp}: alpha differs from the PNG's at ${p % W},${Math.floor(p / W)}`);
    }
  }
  provenance[template] = {
    source: "pipglyph",
    converter: "scripts/build-token-nyx.mjs",
    derivedFrom: `the published ${from}/<key> masters of the frames bucket (themselves Card Conjurer imports: see "${from}") and the starfield of the Magic Set Editor constellation master ${RECIPE.starfield} (git)`,
    output: `1500x2100, the parent's every byte but the name pill's face; webp q${WEBP.quality} with the PNG's alpha exactly`,
    recipe: {
      region: `the α-0 hole of the published ${RECIPE.hole.band}.png (sha256 ${bandSrc.sha.slice(0, 12)}) connected to ${RECIPE.hole.seed.join(",")}, weighted by ${RECIPE.alpha.master}.png's alpha (sha256 ${alphaSrc.sha.slice(0, 12)}): 1 at α ≤ ${RECIPE.alpha.full}, 0 from ${RECIPE.alpha.none}`,
      starfield: `luma of ${RECIPE.starfield} (sha256 ${starsSha.slice(0, 12)}) at the same pixel, minus its median over the region (${starsMedian.toFixed(1)})`,
      tone: `out = P + offset + ${RECIPE.k} × starfield per channel, the offset solved so the region's median, read over mid-grey art, is print's (scripts/lib/token-nyx.mjs targets: ${Object.entries(RECIPE.targetPrints).map(([k, v]) => `${k} ${v}`).join("; ")}); alpha untouched`,
    },
    colors,
    sourceFiles: [...sourceFiles, `${RECIPE.hole.band}.png`, `${RECIPE.alpha.master}.png`].sort(),
    notes: [
      "PipGlyph's own composite (TODO 4.51): the M20+ Nyx tokens (TDSK #4 / #10, TEOC #13, TSOC #3, SLD #1835, TMDD #8) print a starfield in the NAME PILL only; the type pill, box, rims and strip are the plain design's. Neither Card Conjurer nor Magic Set Editor ships the piece.",
      "No pairs: no two-colour Nyx token is printed; a two-colour card on the dress wears gold (m).",
    ],
  };
}
console.log(report.join("\n"));
if (!dryRun) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
