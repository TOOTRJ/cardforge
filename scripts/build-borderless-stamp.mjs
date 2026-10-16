#!/usr/bin/env node
// ---------------------------------------------------------------------------
// build-borderless-stamp.mjs — the holofoil stamp's notch on the borderless
// frames (TODO 4.9d, owner Round 66): PipGlyph's OWN derivation from masters
// already published in the frames bucket. No Card Conjurer piece and no scan
// is read; the printed arch is DATA in scripts/lib/borderless-stamp.mjs.
//
// Each piece is its master's own pinline LIFTED along the printed arch: the
// layer that, drawn over the master, shows the master as it is `lift` rows
// further down (the bevel, the rim, then the black under them) — so both feet
// are the bar itself, the rim and bevel keep the master's colours (a pair's
// ramp, a land's tinted bevel, the station box's light rim included), and the
// translucent box above the arch keeps its own pixels (the piece is clear
// there). The oval (our own art, lib/cards/holo-stamp-art.ts) is drawn over
// the black by both renderers; nothing of a hologram is in a piece.
//
//   node scripts/build-borderless-stamp.mjs                 # → .frames-build
//   node scripts/build-borderless-stamp.mjs --out <dir> [--masters <dir>] [--only <folder,…>] [--dry-run]
//   npm run frames:publish -- --source .frames-build --only m15borderlessholostamp,m15borderlesslandholostamp,m15borderlessstationholostamp --write
//
// The sources are local copies of the PUBLISHED masters, each sha256-checked
// against lib/frames/frame-manifest.json (--masters, FRAMES_BUILD_DIR,
// .frames-cache — scripts/frames-fetch.mjs — or .frames-build). The output is
// gitignored: a piece derived from a bucket master never enters git.
// Provenance → lib/cards/frame-sources.json. The WebP sibling's ALPHA must
// equal the PNG's exactly (the preview reads the WebP, the bake the PNG): the
// run decodes every WebP it wrote and refuses a difference.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { WEBP } from "./lib/cc-frames.mjs";
import {
  ARCH_LIFT_PX,
  ARCH_LIFT_STEP_PX,
  BLACK_BAR_TOP,
  BORDERLESS_NOTCH_BOX,
  BORDERLESS_STAMP_FOLDERS,
  READ_ROWS,
  SHARED_TOLERANCE,
  buildBorderlessNotch,
  liftError,
} from "./lib/borderless-stamp.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const only = flag("--only")?.split(",").filter(Boolean) ?? null;
const outDir = path.resolve(flag("--out") ?? ".frames-build");
const PROVENANCE = "lib/cards/frame-sources.json";
const MANIFEST = JSON.parse(fs.readFileSync("lib/frames/frame-manifest.json", "utf8")).files;
const W = 1500;
const H = 2100;
const PIECE_WEBP = { ...WEBP, alphaQuality: 100 };
/** The recipe's own loss (the bevel rows a cover can't make LESS opaque):
 *  refuse a piece that lands further than this from the lifted master. */
const MAX_LIFT_ERROR = 5;

if (only) {
  const unknown = only.filter((f) => !BORDERLESS_STAMP_FOLDERS[f]);
  if (unknown.length) throw new Error(`unknown folder(s) ${unknown.join(", ")}: known ${Object.keys(BORDERLESS_STAMP_FOLDERS).join(", ")}`);
}

const sourceDirs = [
  ...(flag("--masters") ? [path.resolve(flag("--masters"))] : []),
  ...(process.env.FRAMES_BUILD_DIR ? [path.resolve(process.env.FRAMES_BUILD_DIR)] : []),
  path.resolve(".frames-cache"),
  path.resolve(".frames-build"),
];

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

async function raw(file, width = W, height = H) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error(`${file}: ${info.width}×${info.height}, expected ${width}×${height}`);
  return data;
}

/** The worst channel difference between two masters in the region a piece
 *  reads (its columns, READ_ROWS). */
function regionDiff(a, b) {
  let worst = 0;
  const box = BORDERLESS_NOTCH_BOX;
  for (let y = READ_ROWS[0]; y <= READ_ROWS[1]; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      const o = (y * W + x) * 4;
      for (let i = 0; i < 4; i += 1) worst = Math.max(worst, Math.abs(a[o + i] - b[o + i]));
    }
  }
  return worst;
}

async function write(folder, key, piece) {
  const box = BORDERLESS_NOTCH_BOX;
  const png = path.join(outDir, folder, `${key}.png`);
  fs.mkdirSync(path.dirname(png), { recursive: true });
  const image = sharp(piece, { raw: { width: box.width, height: box.height, channels: 4 } });
  await image.clone().png({ compressionLevel: 9 }).toFile(png);
  const webp = png.replace(/\.png$/, ".webp");
  await image.clone().webp(PIECE_WEBP).toFile(webp);
  const back = await raw(webp, box.width, box.height);
  for (let i = 0; i < box.width * box.height; i += 1) {
    if (back[i * 4 + 3] !== piece[i * 4 + 3]) throw new Error(`${webp}: alpha differs from the PNG's at ${i % box.width},${Math.floor(i / box.width)} (${back[i * 4 + 3]} ≠ ${piece[i * 4 + 3]})`);
  }
  return png;
}

const provenance = fs.existsSync(PROVENANCE) ? JSON.parse(fs.readFileSync(PROVENANCE, "utf8")) : {};
for (const [folder, def] of Object.entries(BORDERLESS_STAMP_FOLDERS)) {
  if (only && !only.includes(folder)) continue;
  const colors = {};
  const sourceFiles = new Set();
  for (const [key, rel] of Object.entries(def.keys)) {
    const src = published(rel);
    sourceFiles.add(`${rel}.png`);
    const master = await raw(src.file);
    const shared = [];
    for (const other of def.sharedBy[key] ?? []) {
      const o = published(other);
      sourceFiles.add(`${other}.png`);
      const diff = regionDiff(master, await raw(o.file));
      if (diff > SHARED_TOLERANCE) throw new Error(`${folder}/${key}: ${other} differs from ${rel} by ${diff} levels where the piece reads — it needs its own key`);
      shared.push(`${other}.png (sha256 ${o.sha.slice(0, 12)}; within ${diff} level${diff === 1 ? "" : "s"})`);
    }
    const { piece, outside } = buildBorderlessNotch(master, W);
    if (outside > 0) throw new Error(`${folder}/${key}: ${outside} painted px fall outside the box ${JSON.stringify(BORDERLESS_NOTCH_BOX)}`);
    const { worst, at } = liftError(master, W, piece);
    if (worst > MAX_LIFT_ERROR) throw new Error(`${folder}/${key}: the piece over ${rel} lands ${worst.toFixed(1)} levels from the lifted master at ${JSON.stringify(at)}`);
    // The feet: no painted pixel in the box's outermost columns (the arch
    // stands on the master's own bar there).
    for (const x of [0, BORDERLESS_NOTCH_BOX.width - 1]) {
      for (let y = 0; y < BORDERLESS_NOTCH_BOX.height; y += 1) {
        if (piece[(y * BORDERLESS_NOTCH_BOX.width + x) * 4 + 3] !== 0) throw new Error(`${folder}/${key}: column ${x} of the piece is painted — the arch must stand on the bar`);
      }
    }
    colors[key] = [
      `${rel}.png (published, sha256 ${src.sha.slice(0, 12)}): its pinline lifted along the printed arch; worst ${worst.toFixed(2)} levels from the lifted master over four flat arts`,
      ...shared.map((s) => `drawn over ${s} too`),
    ];
    if (!dryRun) {
      const png = await write(folder, key, piece);
      console.log(`wrote ${path.relative(process.cwd(), png)} (+ .webp, alpha equal) from ${rel}; worst ${worst.toFixed(2)}`);
    } else {
      console.log(`${folder}/${key} from ${rel}: worst ${worst.toFixed(2)} (dry run)`);
    }
  }
  provenance[folder] = {
    source: "pipglyph",
    converter: "scripts/build-borderless-stamp.mjs",
    derivedFrom: `the published borderless masters named per key below (Card Conjurer imports: see "m15borderless", "m15borderlessartifact", "m15borderlessland", and PipGlyph's "m15borderlessstation")`,
    output: `${BORDERLESS_NOTCH_BOX.width}x${BORDERLESS_NOTCH_BOX.height} at ${BORDERLESS_NOTCH_BOX.x},${BORDERLESS_NOTCH_BOX.y} of the 1500x2100 card (1:1 at HD), webp q${WEBP.quality} with the PNG's alpha exactly`,
    recipe: {
      lift: `the master's own column, read ${ARCH_LIFT_STEP_PX}-px samples of ARCH_LIFT_PX rows further down (|x - 750| = 0, 2, 4, …; linear between): ${ARCH_LIFT_PX.join(" ")}`,
      layer: "per pixel, the layer that over the master gives the lifted master (premultiplied): alpha (want − under) / (1 − under), clear where the master already shows it; rows from the black bar (" + BLACK_BAR_TOP + ") down are the master's black",
    },
    colors,
    sourceFiles: [...sourceFiles].sort(),
    notes: [
      "PipGlyph's own derivation (TODO 4.9d, owner Round 66, 2026-10-14): the holofoil stamp's notch on the borderless frames — the text box's bottom pinline arched over the oval as every stamped borderless print draws it. Card Conjurer's borderless pack has no stamp piece; no CC piece and no scan is read by the build — every painted pixel is the published master's own bar, moved up.",
      "The arch is scripts/lib/borderless-stamp.mjs ARCH_LIFT_PX: fourteen stamped borderless printings measured 2026-10-15 (the rim's lower edge 1916.0 px at the centre against the straight bar's 1948.6, rising from x 666 to x 834).",
      "The oval is drawn by both renderers over the black (our own art, lib/cards/holo-stamp-art.ts) at M15_HOLO_STAMP_OVAL: the physical prints put it where the bordered frame's sits. Nothing of a hologram is in a piece.",
    ],
  };
}
if (!dryRun) {
  const sorted = Object.fromEntries(Object.keys(provenance).sort().map((k) => [k, provenance[k]]));
  fs.writeFileSync(PROVENANCE, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`provenance → ${PROVENANCE}`);
}
