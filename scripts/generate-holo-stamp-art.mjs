#!/usr/bin/env node
// ---------------------------------------------------------------------------
// generate-holo-stamp-art.mjs — the holofoil stamp's oval (TODO 4.9c) as a
// bitmap: lib/cards/holo-stamp-art.ts, a 2× PNG data URI both renderers
// draw at the same rect (lib/cards/holo-stamp.ts holoStampArtRect). Our own
// art (owner 2026-09-29): a NEUTRAL silver oval with a sheen and no symbol
// — a vertical mirror-silver gradient, fine diagonal sheen lines, a faint
// holographic tint, a soft highlight and a 2 px dark keyline — inside a ring
// of the notch's own black (HOLO_STAMP_ART_MARGIN_PX) that covers the notch
// piece's cut (the oval plus 2 px) with a pixel to spare, so the oval's edge
// is never a seam. A bitmap because Satori draws no gradients: one embedded
// PNG is pixel-identical in the preview and the bake and needs no bucket
// object or preload entry.
//
//   node scripts/generate-holo-stamp-art.mjs            # rewrites the module
//   node scripts/generate-holo-stamp-art.mjs --out x.png # the PNG alone
//
// Idempotent: the same SVG gives the same bytes. The SVG is in HD px units
// (the oval's rect at 1500 × 2100) and rasterised at HOLO_STAMP_ART_SCALE.
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import "./lib/ts-alias-hooks.mjs";

const { HOLO_STAMP_ART_MARGIN_PX, M15_HOLO_STAMP_OVAL, holoStampArtRect } = await import("../lib/cards/holo-stamp.ts");

const args = process.argv.slice(2);
const outPng = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const MODULE = path.join(process.cwd(), "lib/cards/holo-stamp-art.ts");

/** The bitmap's pixels per HD px. */
export const HOLO_STAMP_ART_SCALE = 2;

const oval = M15_HOLO_STAMP_OVAL;
const art = holoStampArtRect(oval);
// The bitmap's box in HD px (the art rect): the oval sits MARGIN px in.
const W = (art.widthPct / 100) * 1500;
const H = (art.heightPct / 100) * 2100;
const m = HOLO_STAMP_ART_MARGIN_PX;
const cx = W / 2;
const cy = H / 2;
const rx = (oval.widthPct / 100) * 1500 / 2;
const ry = (oval.heightPct / 100) * 2100 / 2;

/** The oval's SVG, in HD px units. */
export function holoStampOvalSvg() {
  const keyline = 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <!-- mirror silver: bright crown, a dark band below the middle, a
         lighter foot — the way foil catches a single light -->
    <linearGradient id="silver" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#fafbfc"/>
      <stop offset="0.18" stop-color="#d9dce2"/>
      <stop offset="0.38" stop-color="#f3f4f6"/>
      <stop offset="0.52" stop-color="#a9adb6"/>
      <stop offset="0.64" stop-color="#7f848e"/>
      <stop offset="0.8" stop-color="#c3c7ce"/>
      <stop offset="1" stop-color="#eceef1"/>
    </linearGradient>
    <!-- the holographic tint: faint cyan / magenta / gold bands across -->
    <linearGradient id="holo" x1="0" y1="0" x2="1" y2="0.6">
      <stop offset="0" stop-color="#8fe3ff" stop-opacity="0.30"/>
      <stop offset="0.3" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.52" stop-color="#ffb0ea" stop-opacity="0.26"/>
      <stop offset="0.74" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#ffe88a" stop-opacity="0.30"/>
    </linearGradient>
    <!-- fine diagonal sheen lines -->
    <pattern id="lines" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(-32)">
      <rect width="3" height="0.9" fill="#ffffff" fill-opacity="0.14"/>
      <rect y="1.6" width="3" height="0.7" fill="#000000" fill-opacity="0.10"/>
    </pattern>
    <radialGradient id="glint" cx="0.28" cy="0.25" r="0.45">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.35"/>
    </linearGradient>
    <clipPath id="oval"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
  </defs>
  <!-- the notch's black, out to the bitmap's edge (the cut's cover) -->
  <ellipse cx="${cx}" cy="${cy}" rx="${rx + m}" ry="${ry + m}" fill="#000000"/>
  <g clip-path="url(#oval)">
    <rect width="${W}" height="${H}" fill="url(#silver)"/>
    <rect width="${W}" height="${H}" fill="url(#lines)"/>
    <rect width="${W}" height="${H}" fill="url(#holo)"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#glint)"/>
    <!-- a bevelled rim just inside the keyline -->
    <ellipse cx="${cx}" cy="${cy}" rx="${rx - 2.5}" ry="${ry - 2.5}" fill="none" stroke="url(#rim)" stroke-width="1.6"/>
  </g>
  <!-- the 2 px dark keyline, inside the oval's edge -->
  <ellipse cx="${cx}" cy="${cy}" rx="${rx - keyline / 2}" ry="${ry - keyline / 2}" fill="none" stroke="#2a2c31" stroke-width="${keyline}"/>
</svg>`;
}

async function main() {
  const svg = holoStampOvalSvg();
  const width = Math.round(W * HOLO_STAMP_ART_SCALE);
  const height = Math.round(H * HOLO_STAMP_ART_SCALE);
  const png = await sharp(Buffer.from(svg), { density: 72 * HOLO_STAMP_ART_SCALE })
    .resize(width, height, { fit: "fill" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  if (outPng) {
    fs.writeFileSync(path.resolve(outPng), png);
    console.log(`wrote ${outPng} (${width}×${height}, ${png.length} bytes)`);
    return;
  }
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  const source = `// GENERATED by scripts/generate-holo-stamp-art.mjs — do not edit by hand.
// The holofoil stamp's oval (TODO 4.9c, owner 2026-09-29): our own neutral
// silver oval with a sheen and no symbol, inside a ring of the notch's black
// (HOLO_STAMP_ART_MARGIN_PX). A bitmap because Satori draws no gradients;
// both renderers stretch it over holoStampArtRect(oval) (lib/cards/
// holo-stamp.ts), above the finish sheens — never inside the foil mask.
// ${width} × ${height} px = the HD art rect (${W.toFixed(1)} × ${H.toFixed(1)} px) at ${HOLO_STAMP_ART_SCALE}×.

/** The bitmap's pixels per HD px. */
export const HOLO_STAMP_ART_SCALE = ${HOLO_STAMP_ART_SCALE};

export const HOLO_STAMP_OVAL_ART = {
  width: ${width},
  height: ${height},
  dataUri:
    "${dataUri}",
} as const;
`;
  fs.writeFileSync(MODULE, source);
  console.log(`wrote ${path.relative(process.cwd(), MODULE)} (${width}×${height}, ${png.length} bytes PNG, ${dataUri.length} chars)`);
}

await main();
