#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-breaking-news-masthead.mjs — the OTJ Breaking News showcase's
// masthead pieces (template `breakingnews`, TODO 4.11 wave 2; owner decision
// on #624: FOLLOW PRINT): PipGlyph's OWN cut of the published masters. No
// Card Conjurer file and no scan is read; the recipe and what print does
// are scripts/lib/breaking-news-masthead.mjs, the rule that places the
// pieces lib/cards/masthead.ts.
//
//   breakingnewsmasthead/<key>        the wordmark strip of breakingnews/<key>
//   breakingnewsmasthead/paper/<key>  the masthead's paper with no ink
//
// Nothing is drawn: every colour is a master pixel (the paper a crossfade of
// two of them), only alpha is set.
//
//   node scripts/build-breaking-news-masthead.mjs              # → .frames-build
//   node scripts/build-breaking-news-masthead.mjs --out <dir> [--masters <dir>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only breakingnewsmasthead --write
//
// The sources are local copies of the PUBLISHED masters, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build). The output is
// gitignored: a piece cut from a Card Conjurer-derived master never enters
// git. Provenance → lib/cards/frame-sources.json.
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
import { BREAKING_NEWS_MASTHEAD_RECIPE as RECIPE, cutMastheadPieces } from "./lib/breaking-news-masthead.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const { folder, from, card } = RECIPE;
const PIECE_WEBP = { ...WEBP, alphaQuality: 100 };

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

async function raw(file, width, height) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error(`${file}: ${info.width}×${info.height}, expected ${width}×${height}`);
  return data;
}

async function write(rel, piece) {
  const png = path.join(outDir, `${rel}.png`);
  fs.mkdirSync(path.dirname(png), { recursive: true });
  const image = sharp(piece.data, { raw: { width: piece.width, height: piece.height, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(png);
  const webp = png.replace(/\.png$/, ".webp");
  await image.clone().webp(PIECE_WEBP).toFile(webp);
  const back = await raw(webp, piece.width, piece.height);
  for (let i = 0; i < piece.width * piece.height; i++) {
    if (back[i * 4 + 3] !== piece.data[i * 4 + 3]) throw new Error(`${webp}: alpha differs from the PNG's at ${i % piece.width},${Math.floor(i / piece.width)}`);
  }
  return png;
}

const colors = {};
for (const key of RECIPE.keys) {
  const src = published(`${from}/${key}`);
  const master = await raw(src.file, card.width, card.height);
  const { wordmark, paper } = cutMastheadPieces(master, RECIPE);
  // Nothing drawn: the wordmark's colours are the master's at the same px.
  for (let y = 0; y < wordmark.height; y++) {
    for (let x = 0; x < wordmark.width; x++) {
      const o = (y * wordmark.width + x) * 4;
      const s = ((y + wordmark.y0) * card.width + (x + wordmark.x0)) * 4;
      if (wordmark.data[o] !== master[s] || wordmark.data[o + 1] !== master[s + 1] || wordmark.data[o + 2] !== master[s + 2]) {
        throw new Error(`${key}: the wordmark changed a colour at ${x + wordmark.x0},${y + wordmark.y0}`);
      }
    }
  }
  colors[key] = [
    `${from}/${key}.png (published, sha256 ${src.sha.slice(0, 12)})`,
    `wordmark: x ${RECIPE.wordmark.x0}–${RECIPE.wordmark.x1 - 1} × rows ${RECIPE.rows[0]}–${RECIPE.rows[1] - 1}, colours untouched, alpha faded (wordmarkAlpha)`,
    `paper: x ${RECIPE.paper.x0}–${RECIPE.paper.x1 - 1}, the run ${RECIPE.paper.run[0]}–${RECIPE.paper.run[1] - 1} every ${RECIPE.paper.step} px, 40 px crossfades, the master's own ${RECIPE.paper.handover}–${RECIPE.paper.x1 - 1} at its end (paperSources)`,
  ];
  if (dryRun) {
    console.log(`${folder}/${key}: ${wordmark.width}×${wordmark.height} + paper ${paper.width}×${paper.height} (dry run)`);
    continue;
  }
  const a = await write(`${folder}/${key}`, wordmark);
  const b = await write(`${folder}/paper/${key}`, paper);
  console.log(`wrote ${path.relative(process.cwd(), a)} and ${path.relative(process.cwd(), b)} (+ .webp, alpha equal) from ${from}/${key}`);
}

if (!dryRun) {
  const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
  provenance[folder] = {
    source: "pipglyph",
    converter: "scripts/build-breaking-news-masthead.mjs",
    kind: "overlay",
    derivedFrom: `the published ${from}/<key> masters of the frames bucket (themselves Card Conjurer imports: see "${from}")`,
    output: `per key: <key> the wordmark strip ${RECIPE.wordmark.x1 - RECIPE.wordmark.x0}x${RECIPE.rows[1] - RECIPE.rows[0]} at card px (${RECIPE.wordmark.x0}, ${RECIPE.rows[0]}); paper/<key> ${RECIPE.paper.x1 - RECIPE.paper.x0}x${RECIPE.rows[1] - RECIPE.rows[0]} at (${RECIPE.paper.x0}, ${RECIPE.rows[0]}); webp q${WEBP.quality} with the PNG's alpha exactly`,
    recipe: {
      rows: `${RECIPE.rows[0]}–${RECIPE.rows[1] - 1} (the paper between the coloured bars), opaque on ${RECIPE.opaqueRows[0]}–${RECIPE.opaqueRows[1] - 1}, faded to 0 at the edges`,
      wordmark: `x ${RECIPE.wordmark.x0}–${RECIPE.wordmark.x1 - 1}: hard left edge on the box's rows ${RECIPE.boxRows[0]}–${RECIPE.boxRows[1] - 1}, faded over ${RECIPE.wordmark.x0}–${RECIPE.wordmark.leftOpaque - 1} elsewhere; opaque to ${RECIPE.wordmark.chevronOpaque - 1} on the chevron's rows ${RECIPE.chevronRows[0]}–${RECIPE.chevronRows[1] - 1} (0 by ${RECIPE.wordmark.chevronEnd}), to ${RECIPE.wordmark.opaque - 1} elsewhere (0 by ${RECIPE.wordmark.x1})`,
      paper: `the master's clean run ${RECIPE.paper.run[0]}–${RECIPE.paper.run[1] - 1} laid leftwards every ${RECIPE.paper.step} px with ${RECIPE.paper.run[1] - RECIPE.paper.run[0] - RECIPE.paper.step} px crossfades (never mirrored), handing over to the master's own columns on ${RECIPE.paper.handover}–${RECIPE.paper.x1 - 1}`,
    },
    colors,
    sourceFiles: RECIPE.keys.map((key) => `${from}/${key}.png`).sort(),
    notes: [
      "PipGlyph's own cut (owner decision on #624, 2026-10-28: FOLLOW PRINT): print's Breaking News masthead makes room for a long cost — the chevron goes at four pips, the row slides right at five, the wordmark slides left (cutting the icon box short) at seven (OTP #7, #22, #25, #40 measured at 1500 × 2100). The pieces let both renderers draw that at the place lib/cards/masthead.ts computes; nothing is drawn: every colour is a master pixel, the paper's a crossfade of two.",
      "No flat zone exists in the masthead (the paper is textured): every edge a piece adds is a fade of paper onto paper or lies on a printed edge (the box's border, the coloured bars, the rules' rows). The crease that crosses the icon box is not carried: where the cut box lands on it, the wordmark piece covers it (print keeps its crease on top). Print also narrows the wordmark by 3 % at seven pips (#40); the pieces only slide it.",
      "The numbers are scripts/lib/breaking-news-masthead.mjs; no scan is read by the build.",
    ],
  };
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
