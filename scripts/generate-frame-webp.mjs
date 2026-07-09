// Generate browser-only WebP variants for every frame PNG
// (public/frames/**/*.png → sibling .webp, same basename). The browser loads
// frames as CSS backgrounds / <img> tags which get no next/image
// optimization, so CardPreview was layering multiple MB of raw PNG; the
// WebP variants cut that ~10×.
//
// ADDITIVE ONLY: the PNG masters are never touched — the server-side Satori
// bake (lib/render/card-frames.ts) reads those exact bytes and preview ==
// baked-PNG fidelity depends on them. Browser code prefers the .webp via
// CSS image-set() with a PNG fallback (components/cards/frame-layer.tsx).
//
// Idempotent; skips any .webp that is newer than its source PNG. Rerun
// after adding or rebuilding frames:
//
//   npm run assets:frame-webp
//   node scripts/generate-frame-webp.mjs        # same thing

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const FRAMES_DIR = path.join(process.cwd(), "public", "frames");
const QUALITY = 90;
const EFFORT = 6; // sharp's max — slowest encode, smallest files

function* walkPngs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkPngs(full);
    else if (entry.isFile() && entry.name.endsWith(".png")) yield full;
  }
}

let converted = 0;
let skipped = 0;
let pngBytes = 0;
let webpBytes = 0;

for (const png of walkPngs(FRAMES_DIR)) {
  const webp = png.replace(/\.png$/, ".webp");
  const pngStat = fs.statSync(png);
  pngBytes += pngStat.size;

  const webpStat = fs.existsSync(webp) ? fs.statSync(webp) : null;
  if (webpStat && webpStat.mtimeMs >= pngStat.mtimeMs) {
    webpBytes += webpStat.size;
    skipped++;
    continue;
  }

  await sharp(png).webp({ quality: QUALITY, effort: EFFORT }).toFile(webp);
  const outSize = fs.statSync(webp).size;
  webpBytes += outSize;
  converted++;
  console.log(
    "wrote",
    path.relative(process.cwd(), webp),
    `(${(pngStat.size / 1024).toFixed(0)} KB → ${(outSize / 1024).toFixed(0)} KB)`,
  );
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(
  `\n${converted} converted, ${skipped} up to date — ` +
    `PNG ${mb(pngBytes)} MB → WebP ${mb(webpBytes)} MB ` +
    `(${(100 - (webpBytes / pngBytes) * 100).toFixed(0)}% smaller)`,
);
