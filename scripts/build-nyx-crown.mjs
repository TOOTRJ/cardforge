#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-nyx-crown.mjs — the Nyx Constellation frame's legendary crown bands
// (template `nyx`; owner 2026-10-13): PipGlyph's OWN cut of the Nyx crown
// bands already published in the frames bucket. No Card Conjurer file and no
// scan is read; the recipe and what print does are scripts/lib/nyx-crown.mjs.
//
//   nyxcrown/<w u b r g m a>      from the published m15nyxcrown/<key>
//
// One cut: the arms' last rows fade out (alpha only), so the crown hands
// over to the `nyx` masters' own, narrower rim. Every other pixel is the
// published band's.
//
//   node scripts/build-nyx-crown.mjs                # → .frames-build
//   node scripts/build-nyx-crown.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only nyxcrown --write
//
// The sources are local copies of the PUBLISHED bands, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build). The output is
// gitignored: a band cut from a Card Conjurer-derived band never enters git.
// Provenance → lib/cards/frame-sources.json.
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
import { NYX_CONSTELLATION_CROWN_RECIPE as RECIPE, fadeNyxCrownBand } from "./lib/nyx-crown.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const { width: W, rows: H, fade, folder, from } = RECIPE;
const BAND_WEBP = { ...WEBP, alphaQuality: 100 };

const sourceDirs = [
  ...(flag("--masters") ? [path.resolve(flag("--masters"))] : []),
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.resolve(".frames-cache"),
  path.resolve(".frames-build"),
];

/** A published band's local copy, at the manifest's sha256. */
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

const colors = {};
for (const key of RECIPE.keys) {
  const src = published(`${from}/${key}`);
  const data = await raw(src.file);
  const out = Buffer.from(data);
  const { changed } = fadeNyxCrownBand(out, RECIPE);
  // Nothing but alpha, and nothing above the fade.
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (out[o] !== data[o] || out[o + 1] !== data[o + 1] || out[o + 2] !== data[o + 2]) throw new Error(`${key}: a colour changed at ${i % W},${Math.floor(i / W)}`);
    if (Math.floor(i / W) <= fade.from && out[o + 3] !== data[o + 3]) throw new Error(`${key}: alpha changed above the fade at ${i % W},${Math.floor(i / W)}`);
  }
  colors[key] = [
    `${from}/${key}.png (published, sha256 ${src.sha.slice(0, 12)})`,
    `alpha × (1 − t) on rows ${fade.from}–${fade.to}, t 0 → 1 (the arms; ${changed} px), 0 below`,
  ];
  if (dryRun) {
    console.log(`${folder}/${key}: ${changed} px faded (dry run)`);
    continue;
  }
  const png = path.join(outDir, folder, `${key}.png`);
  fs.mkdirSync(path.dirname(png), { recursive: true });
  const image = sharp(out, { raw: { width: W, height: H, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(png);
  const webp = png.replace(/\.png$/, ".webp");
  await image.clone().webp(BAND_WEBP).toFile(webp);
  const back = await raw(webp);
  for (let i = 0; i < W * H; i++) {
    if (back[i * 4 + 3] !== out[i * 4 + 3]) throw new Error(`${webp}: alpha differs from the PNG's at ${i % W},${Math.floor(i / W)} (${back[i * 4 + 3]} ≠ ${out[i * 4 + 3]})`);
  }
  console.log(`wrote ${path.relative(process.cwd(), png)} (+ .webp, alpha equal) from ${from}/${key}: ${changed} px faded`);
}

if (!dryRun) {
  const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
  provenance[folder] = {
    source: "pipglyph",
    converter: "scripts/build-nyx-crown.mjs",
    kind: "overlay",
    derivedFrom: `the published ${from}/<key> bands of the frames bucket (themselves Card Conjurer imports: see "${from}")`,
    output: `${W}x${H} overlay band: rows 0–${H - 1} of a 1500x2100 card, the parent's corners, webp q${WEBP.quality} with the PNG's alpha exactly`,
    recipe: {
      fade: `alpha × (1 − t) on rows ${fade.from}–${fade.to} (t 0 → 1), 0 below; colours untouched`,
      arms: `nothing but the two arms is painted from row ${fade.from} down: x ${RECIPE.arms.left.join("–")} and ${RECIPE.arms.right.join("–")}`,
    },
    colors,
    sourceFiles: RECIPE.keys.map((key) => `${from}/${key}.png`).sort(),
    notes: [
      "PipGlyph's own cut (owner 2026-10-13): the Theros Beyond Death constellation showcase prints (THB #258–268) wear the standard 2015 legendary crown in the card's colour with the Nyx starfield strip inside it — the piece Card Conjurer's 'Nyx Showcase' pack (packM15NyxShowcase.js) lists beside its crownless masters, and the band the Nyx dress publishes as m15nyxcrown. Nothing is drawn or synthesised: every painted pixel is the parent band's.",
      "The one cut: the `nyx` masters are MSE's and their side rim is 3 px narrower than the crown's arm (and another tone on b, r, g and the colourless master), so the arms fade out over their last rows instead of ending in a jog. The masters are not re-cut.",
      "The numbers are scripts/lib/nyx-crown.mjs (eleven prints measured 2026-10-13); no scan is read by the build.",
      "No pairs: the frame draws no pair masters, so a two-colour card wears the gold crown over the gold master (THB #268 prints red | green over a gold bar — the pair masters' step, not this one). The colourless master takes the artifact silver `a` (no printed colourless constellation card).",
    ],
  };
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
