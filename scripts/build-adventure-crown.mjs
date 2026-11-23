#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-adventure-crown.mjs — the adventure frame's legendary crown bands
// (template `adventure`; TODO 4.6f, owner 2026-11-22): PipGlyph's OWN cut of
// the M15 crown bands already published in the frames bucket. No Card
// Conjurer file and no scan is read; the recipe and what print does are
// scripts/lib/adventure-crown.mjs.
//
//   adventurecrown/<w u b r g m a + the ten pairs>   from m15crown/<key>
//
// One cut: the arms' last rows fade out (alpha only), so the crown hands
// over to the adventure masters' own pinline (the regular pack's tone).
// Every other pixel is the published band's.
//
//   node scripts/build-adventure-crown.mjs                # → .frames-build
//   node scripts/build-adventure-crown.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only adventurecrown --write
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
import { ADVENTURE_CROWN_RECIPE as RECIPE, fadeAdventureCrownBand } from "./lib/adventure-crown.mjs";

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
  const { changed } = fadeAdventureCrownBand(out);
  // The fade: nothing but alpha, and nothing above its first row.
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
    converter: "scripts/build-adventure-crown.mjs",
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
      "PipGlyph's own cut (TODO 4.6f, owner 2026-11-22): the adventure frame's legendary printings (LCI #231, HOB #34 / #71 / #118 / #170, WOE #220 / #230, MKM #212, HOB #166 …) wear the standard 2015 legendary crown in the card's colour — the band m15, m15artifact and m15land draw. Nothing is drawn or synthesised: every painted pixel is the parent band's.",
      "The one cut, the Nyx Constellation crown's (scripts/lib/nyx-crown.mjs, owner Round 59): the adventure masters are Card Conjurer's 'Adventure' pack, on the regular M15 pack's geometry (the title bar's top outline on M15's rows) but with that pack's other pinline tone on w, b, r, g, gold and the artifact silver, so the arms fade out over their last rows instead of ending in a tone step and a jog. The masters are not re-toned.",
      "The numbers are scripts/lib/adventure-crown.mjs; no scan is read by the build.",
      "Keys: the masters' letters, the artifact silver `a` (the template's colourless master is the pack's artifact frame: the profile maps c → a) and the ten pairs, drawn over the adventure's pair masters (MKM #212 prints G|U over the gold-split frame, HOB #166 over the hybrid).",
    ],
  };
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
