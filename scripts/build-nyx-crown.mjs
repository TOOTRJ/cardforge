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
// over to the `nyx` masters' own rim. One tint per key: the band's metal
// toned onto its master's rim — the colourless card's silver `a` onto the
// colourless master's bronze, w u b r g onto the rims corrected to print,
// m onto the gold master's own (owner Round 59) — its starfield strip
// untouched (needs the published plain m15crown/<key> beside it). Every
// other pixel is the published band's.
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
import { NYX_CONSTELLATION_CROWN_RECIPE as RECIPE, fadeNyxCrownBand, tintNyxCrownBand } from "./lib/nyx-crown.mjs";

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
  const tint = RECIPE.tint[key] ?? null;
  let toned = data;
  let tintLine = null;
  if (tint) {
    const plain = published(`${tint.plain}/${key}`);
    const done = tintNyxCrownBand(data, await raw(plain.file), tint, RECIPE);
    toned = done.out;
    tintLine = `metal toned ${tint.from.join(", ")} → ${tint.to.join(", ")} (${tint.method === "shift" ? "shiftTone, scripts/lib/nyx-frame.mjs" : "toneSourceRegions"}: faded out toward white; ${done.changed} px) wherever the band equals ${tint.plain}/${key}.png (published, sha256 ${plain.sha.slice(0, 12)}); the starfield strip (${done.strip} px) untouched but for its soft edge against the metal (${done.edged} px, by the share of the crown they show)`;
  }
  const out = Buffer.from(toned);
  const { changed } = fadeNyxCrownBand(out, RECIPE);
  // The fade: nothing but alpha, and nothing above its first row. The tint:
  // never alpha — and no colour at all on a band that takes none.
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    if (out[o] !== toned[o] || out[o + 1] !== toned[o + 1] || out[o + 2] !== toned[o + 2]) throw new Error(`${key}: the fade changed a colour at ${i % W},${Math.floor(i / W)}`);
    if (!tint && (out[o] !== data[o] || out[o + 1] !== data[o + 1] || out[o + 2] !== data[o + 2])) throw new Error(`${key}: a colour changed at ${i % W},${Math.floor(i / W)}`);
    if (toned[o + 3] !== data[o + 3]) throw new Error(`${key}: the tint changed alpha at ${i % W},${Math.floor(i / W)}`);
    if (Math.floor(i / W) <= fade.from && out[o + 3] !== data[o + 3]) throw new Error(`${key}: alpha changed above the fade at ${i % W},${Math.floor(i / W)}`);
  }
  colors[key] = [
    `${from}/${key}.png (published, sha256 ${src.sha.slice(0, 12)})`,
    `alpha × (1 − t) on rows ${fade.from}–${fade.to}, t 0 → 1 (the arms; ${changed} px), 0 below`,
    ...(tintLine ? [tintLine] : []),
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
      tint: Object.fromEntries(Object.entries(RECIPE.tint).map(([key, t]) => [key, `${t.from.join(", ")} → ${t.to.join(", ")} on the metal (every pixel equal to ${t.plain}/${key}.png) by ${t.method === "shift" ? "shiftTone" : "toneSourceRegions' gain"}, faded out toward white; the strip (but its soft edge) and alpha untouched`])),
      arms: `nothing but the two arms is painted from row ${fade.from} down: x ${RECIPE.arms.left.join("–")} and ${RECIPE.arms.right.join("–")}`,
    },
    colors,
    sourceFiles: [...RECIPE.keys.map((key) => `${from}/${key}.png`), ...Object.entries(RECIPE.tint).map(([key, t]) => `${t.plain}/${key}.png`)].sort(),
    notes: [
      "PipGlyph's own cut (owner 2026-10-13): the Theros Beyond Death constellation showcase prints (THB #258–268) wear the standard 2015 legendary crown in the card's colour with the Nyx starfield strip inside it — the piece Card Conjurer's 'Nyx Showcase' pack (packM15NyxShowcase.js) lists beside its crownless masters, and the band the Nyx dress publishes as m15nyxcrown. Nothing is drawn or synthesised: every painted pixel is the parent band's.",
      "The one cut: the `nyx` masters are MSE's and their side rim sits 1–2 px inward of the crown's arm, so the arms fade out over their last rows instead of ending in a jog. The masters are not re-cut (their rim is the prints' width: 11.9 px against 12.2, owner Round 59's measurement).",
      "The numbers are scripts/lib/nyx-crown.mjs (eleven prints measured 2026-10-13); no scan is read by the build.",
      "No pairs: the frame draws no pair masters, so a two-colour card wears the gold crown over the gold master (THB #268 prints red | green over a gold bar — the pair masters' step, not this one). The colourless master takes the artifact band `a` (no printed colourless constellation card).",
      "Owner Round 59 (2026-10-14): the `a` band's silver read as a second metal over the colourless master's bronze, so its metal is toned onto the master's rim (223,225,225 → 172,148,132; toneSourceRegions, the colour part of the gain fading out toward white so the bevel keeps its hue). The starfield strip — every pixel where the band differs from the plain m15crown/a — is the parent's byte for byte but for its soft edge against the metal (within 2 px of it: the share of the tone the crown shows through), and every alpha is the parent's.",
      "Owner Round 59, decision 1 (the frame corrected against print, scripts/lib/nyx-frame.mjs): every other band's metal is toned onto its master's rim the same way — w u b r g onto the rims toned to the prints (the crown's red 209,77,53 and blue 0,117,190 land on print's 220,59,22 and 10,93,193), m onto the gold master's own 246,210,98 — by shiftTone (the move scaled by the pixel's luminance and faded out toward white; it lifts blue's and green's 0 red, which a gain cannot). Crown and rim are one tone per colour. The parents, the Nyx dress's m15nyxcrown bands, are untouched.",
    ],
  };
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
