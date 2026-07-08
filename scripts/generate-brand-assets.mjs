// Generate the PipGlyph brand asset kit (public/brand/*) and app/favicon.ico
// from the lib/brand single source of truth. Idempotent; rerun after any
// change to lib/brand geometry, colors, or treatments.
//
//   node scripts/generate-brand-assets.mjs
//
// Requires node ≥23.6 (imports lib/brand/*.ts via native type-stripping).
// If public/brand/pipglyph-brand-guidelines.pdf exists it is bundled into
// the zip; the PDF itself is authored separately.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import yazl from "yazl";
import { BRAND, MANA_PIPS } from "../lib/brand/constants.ts";
import {
  bannerSvg,
  levitantSvg,
  lockupSvg,
  manifestIconSvg,
  markSvg,
  medallionSvg,
  plaqueSvg,
  sealSvg,
  wordmarkSvg,
} from "../lib/brand/svg.ts";

const OUT_DIR = path.join(process.cwd(), "public", "brand");
fs.mkdirSync(OUT_DIR, { recursive: true });

const svgs = {
  "pipglyph-mark.svg": markSvg({ variant: "gradient" }),
  "pipglyph-mark-flat.svg": markSvg({ variant: "flat" }),
  "pipglyph-mark-mono-black.svg": markSvg({ variant: "mono", color: "#000000" }),
  "pipglyph-mark-mono-white.svg": markSvg({ variant: "mono", color: "#ffffff" }),
  "pipglyph-mark-seal.svg": sealSvg(),
  "pipglyph-mark-medallion.svg": medallionSvg(),
  "pipglyph-mark-plaque.svg": plaqueSvg(),
  "pipglyph-mark-levitant.svg": levitantSvg(),
  "pipglyph-wordmark-dark.svg": wordmarkSvg({ theme: "dark" }),
  "pipglyph-wordmark-light.svg": wordmarkSvg({ theme: "light" }),
  "pipglyph-logo-horizontal-dark.svg": lockupSvg({ layout: "horizontal", theme: "dark" }),
  "pipglyph-logo-horizontal-light.svg": lockupSvg({ layout: "horizontal", theme: "light" }),
  "pipglyph-logo-stacked-dark.svg": lockupSvg({ layout: "stacked", theme: "dark" }),
  "pipglyph-logo-stacked-light.svg": lockupSvg({ layout: "stacked", theme: "light" }),
};

/** Render an SVG string to PNG at a given pixel width (height auto).
 *  `viewWidth` is the SVG's intrinsic viewBox width — the raster density
 *  scales off it so large canvases don't blow sharp's input pixel limit. */
async function png(svg, width, dest, { background, viewWidth = 32 } = {}) {
  const density = Math.min(9600, 96 * (width / viewWidth));
  let img = sharp(Buffer.from(svg), { density });
  img = img.resize({ width });
  if (background) img = img.flatten({ background });
  await img.png().toFile(dest);
}

async function main() {
  // 1. SVG sources
  for (const [name, svg] of Object.entries(svgs)) {
    fs.writeFileSync(path.join(OUT_DIR, name), svg);
  }

  // 2. Mark + treatment PNGs (transparent)
  for (const size of [512, 1024, 2048]) {
    await png(svgs["pipglyph-mark.svg"], size, path.join(OUT_DIR, `pipglyph-mark-${size}.png`));
  }
  for (const size of [512, 1024]) {
    await png(svgs["pipglyph-mark-medallion.svg"], size, path.join(OUT_DIR, `pipglyph-medallion-${size}.png`));
    await png(svgs["pipglyph-mark-plaque.svg"], size, path.join(OUT_DIR, `pipglyph-plaque-${size}.png`));
  }
  for (const size of [1024, 2048]) {
    await png(svgs["pipglyph-logo-horizontal-dark.svg"], size, path.join(OUT_DIR, `pipglyph-logo-horizontal-dark-${size}.png`), { viewWidth: 558 });
  }
  await png(svgs["pipglyph-logo-horizontal-light.svg"], 1024, path.join(OUT_DIR, "pipglyph-logo-horizontal-light-1024.png"), { background: "#fafafa", viewWidth: 558 });

  // 3. Manifest icons (full-bleed navy; maskable keeps the 80% safe zone)
  await png(manifestIconSvg({ maskable: false }), 192, path.join(OUT_DIR, "icon-192.png"));
  await png(manifestIconSvg({ maskable: false }), 512, path.join(OUT_DIR, "icon-512.png"));
  await png(manifestIconSvg({ maskable: true }), 512, path.join(OUT_DIR, "icon-512-maskable.png"));

  // 4. Social banners
  for (const [w, h, name] of [
    [1200, 630, "og-default-1200x630.png"],
    [1500, 500, "x-header-1500x500.png"],
    [1280, 640, "github-social-1280x640.png"],
    [960, 540, "discord-banner-960x540.png"],
  ]) {
    await png(bannerSvg({ width: w, height: h, manaPips: MANA_PIPS }), w, path.join(OUT_DIR, name), { viewWidth: w });
  }

  // 5. favicon.ico (16 + 32 + 48, chip-style like app/icon.tsx)
  const chip = (pad) =>
    `<svg viewBox="-${pad} -${pad} ${32 + pad * 2} ${32 + pad * 2}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="-${pad}" y="-${pad}" width="${32 + pad * 2}" height="${32 + pad * 2}" rx="${(32 + pad * 2) * 0.22}" fill="${BRAND.navy}"/>` +
    markSvg({ variant: "flat" }).replace(/<\/?svg[^>]*>/g, "") +
    `</svg>`;
  const icoPngs = [];
  for (const size of [16, 32, 48]) {
    const dest = path.join(OUT_DIR, `.favicon-${size}.png`);
    await png(chip(2), size, dest);
    icoPngs.push(dest);
  }
  const ico = await pngToIco(icoPngs);
  fs.writeFileSync(path.join(process.cwd(), "app", "favicon.ico"), ico);
  for (const p of icoPngs) fs.unlinkSync(p);

  // 6. BRAND.txt + zip
  const brandTxt = `PipGlyph brand kit
==================

The mark: the Astral Rose — a compass rose become astrolabe. Graduation
ticks for the craft of measurement, a violet plane riding the ring, a
wake of three stars behind it, a cut gem at the heart.

Palette
  Gold        ${BRAND.gold}   (gradient ${BRAND.goldLight} -> ${BRAND.goldDeep})
  Purple      ${BRAND.purple} (deep ${BRAND.purpleDeep})
  Navy        ${BRAND.navy}   (surface ${BRAND.surface})
  Foreground  ${BRAND.foreground}

Type
  Display: Cinzel SemiBold (wordmark is outlined — no font needed)
  Body:    Geist

Usage
  - Prefer the medallion or plaque variants on backgrounds we don't control.
  - Keep clear space of at least 25% of the mark's width on all sides.
  - Don't recolor, rotate, outline, or add effects beyond the provided
    treatments; use the mono marks for single-ink contexts.
  - Name: "PipGlyph", one word, capital P and G.

PipGlyph is unofficial Fan Content permitted under the Wizards of the
Coast Fan Content Policy. Not approved or endorsed by Wizards. pipglyph.com
`;
  fs.writeFileSync(path.join(OUT_DIR, "BRAND.txt"), brandTxt);

  const zip = new yazl.ZipFile();
  const zipPath = path.join(OUT_DIR, "pipglyph-brand-kit.zip");
  for (const name of fs.readdirSync(OUT_DIR).sort()) {
    if (name === "pipglyph-brand-kit.zip" || name.startsWith(".")) continue;
    zip.addFile(path.join(OUT_DIR, name), `pipglyph-brand-kit/${name}`);
  }
  await new Promise((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });

  console.log(`brand kit written to public/brand (${fs.readdirSync(OUT_DIR).length} files) + app/favicon.ico`);
}

await main();
