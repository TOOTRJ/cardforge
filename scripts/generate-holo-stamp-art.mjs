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

const { HOLO_STAMP_ART_MARGIN_PX, HOLO_STAMP_STRIP_RING_RGB, M15_HOLO_STAMP_OVAL, M15UB_HOLO_STAMP_BOX, UB_STAMP_FACE, UB_STAMP_HOLE, holoStampArtRect } = await import(
  "../lib/cards/holo-stamp.ts"
);

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

/** The oval's SVG, in HD px units. `ring`: the margin's colour (the notch's
 *  black; a strip's own colour where the notch is filled with it —
 *  HOLO_STAMP_STRIP_RING_RGB); `keyline`: the 2 px dark keyline (none on a
 *  strip: print's hologram meets the strip directly, OTP #1–65). */
export function holoStampOvalSvg({ ring = "#000000", keyline: drawKeyline = true } = {}) {
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
  <ellipse cx="${cx}" cy="${cy}" rx="${rx + m}" ry="${ry + m}" fill="${ring}"/>
  <g clip-path="url(#oval)">
    <rect width="${W}" height="${H}" fill="url(#silver)"/>
    <rect width="${W}" height="${H}" fill="url(#lines)"/>
    <rect width="${W}" height="${H}" fill="url(#holo)"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#glint)"/>
    <!-- a bevelled rim just inside the keyline -->
    <ellipse cx="${cx}" cy="${cy}" rx="${rx - 2.5}" ry="${ry - 2.5}" fill="none" stroke="url(#rim)" stroke-width="1.6"/>
  </g>
${drawKeyline ? `  <!-- the 2 px dark keyline, inside the oval's edge -->
  <ellipse cx="${cx}" cy="${cy}" rx="${rx - keyline / 2}" ry="${ry - keyline / 2}" fill="none" stroke="#2a2c31" stroke-width="${keyline}"/>
` : ""}</svg>`;
}

// The Universes Beyond triangle (TODO 4.25), in the prints' triangle
// (UB_STAMP_FACE) over the black that covers the notch piece's cut
// (UB_STAMP_HOLE plus the art margin). Its box is the hole's bounds grown by
// the margin, in HD px. TWO faces (owner Round 57, decision 2; 64 prints
// read 2026-10-14, the face 9 px inside its edge at 1500 × 2100):
//   • the HOLOGRAM of a rare or mythic — print reads a mean luminance of
//     148 (144–153 on 28 prints), its darker tenth at 113 and its lighter
//     tenth at 189. Ours: the oval's sheen, lines, tint and keyline over a
//     DARKER silver (UB_HOLO_SILVER) and a softer glint — a neutral silver,
//     no symbol, no Wizards artwork;
//   • the MATTE grey of a common or uncommon — print is one flat tone,
//     96, 97, 96 (26 prints within 95–101; sd 0–1), with no keyline, sheen
//     or rim: UB_MATTE_GREY over the whole face.
const triArt = holoStampArtRect(M15UB_HOLO_STAMP_BOX);
const TW = (triArt.widthPct / 100) * 1500;
const TH = (triArt.heightPct / 100) * 2100;
const TX = (triArt.leftPct / 100) * 1500;
const TY = (triArt.topPct / 100) * 2100;
const triPoints = (t) => t.points.map(([x, y]) => `${(x - TX).toFixed(2)},${(y - TY).toFixed(2)}`).join(" ");
/** A round triangle as a filled polygon with a round-joined stroke of
 *  twice its radius (grown by `grow` px). */
const triShape = (t, grow, attrs) =>
  `<polygon points="${triPoints(t)}" stroke-width="${(2 * (t.radius + grow)).toFixed(2)}" stroke-linejoin="round" ${attrs}/>`;

/** The matte triangle's one tone (print: 95, 97, 96). */
export const UB_MATTE_GREY = "#5f6160";

/** The hologram triangle's silver: the oval's seven stops, each darker —
 *  the same single-light sheen at the prints' level. */
const UB_HOLO_SILVER = `<linearGradient id="silverUb" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#b9bbbf"/>
      <stop offset="0.18" stop-color="#8a8d93"/>
      <stop offset="0.38" stop-color="#a6a8ac"/>
      <stop offset="0.52" stop-color="#63676f"/>
      <stop offset="0.64" stop-color="#454952"/>
      <stop offset="0.8" stop-color="#767a81"/>
      <stop offset="1" stop-color="#a0a3a7"/>
    </linearGradient>
    <radialGradient id="glintUb" cx="0.28" cy="0.25" r="0.45">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>`;

/** The hologram triangle's SVG, in HD px units. */
export function holoStampTriangleSvg() {
  const keyline = 2;
  const oval = holoStampOvalSvg();
  const defs = oval.slice(oval.indexOf("<defs>") + "<defs>".length, oval.indexOf("<clipPath"));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">
  <defs>${defs}${UB_HOLO_SILVER}
    <mask id="face" maskUnits="userSpaceOnUse" x="0" y="0" width="${TW}" height="${TH}">${triShape(UB_STAMP_FACE, 0, 'fill="#ffffff" stroke="#ffffff"')}</mask>
    <mask id="inner" maskUnits="userSpaceOnUse" x="0" y="0" width="${TW}" height="${TH}">${triShape(UB_STAMP_FACE, -keyline, 'fill="#ffffff" stroke="#ffffff"')}</mask>
  </defs>
  <!-- the notch's black: the hole plus the art margin (the cut's cover) -->
  ${triShape(UB_STAMP_HOLE, HOLO_STAMP_ART_MARGIN_PX, 'fill="#000000" stroke="#000000"')}
  <!-- the 2 px dark keyline: the face in the keyline's colour, the silver inside it -->
  ${triShape(UB_STAMP_FACE, 0, 'fill="#2a2c31" stroke="#2a2c31"')}
  <g mask="url(#inner)">
    <rect width="${TW}" height="${TH}" fill="url(#silverUb)"/>
    <rect width="${TW}" height="${TH}" fill="url(#lines)"/>
    <rect width="${TW}" height="${TH}" fill="url(#holo)"/>
    <ellipse cx="${TW * 0.36}" cy="${TH * 0.3}" rx="${TW * 0.36}" ry="${TH * 0.34}" fill="url(#glintUb)"/>
  </g>
</svg>`;
}

/** The matte triangle's SVG: the same black cover, the whole face flat. */
export function holoStampMatteTriangleSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">
  ${triShape(UB_STAMP_HOLE, HOLO_STAMP_ART_MARGIN_PX, 'fill="#000000" stroke="#000000"')}
  ${triShape(UB_STAMP_FACE, 0, `fill="${UB_MATTE_GREY}" stroke="${UB_MATTE_GREY}"`)}
</svg>`;
}

async function rasterise(svg, w, h) {
  const width = Math.round(w * HOLO_STAMP_ART_SCALE);
  const height = Math.round(h * HOLO_STAMP_ART_SCALE);
  const png = await sharp(Buffer.from(svg), { density: 72 * HOLO_STAMP_ART_SCALE })
    .resize(width, height, { fit: "fill" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  return { png, width, height };
}

async function main() {
  const svg = holoStampOvalSvg();
  const { png, width, height } = await rasterise(svg, W, H);
  const stripRing = `#${HOLO_STAMP_STRIP_RING_RGB.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const strip = await rasterise(holoStampOvalSvg({ ring: stripRing, keyline: false }), W, H);
  const tri = await rasterise(holoStampTriangleSvg(), TW, TH);
  const matte = await rasterise(holoStampMatteTriangleSvg(), TW, TH);
  if (outPng) {
    fs.writeFileSync(path.resolve(outPng), png);
    fs.writeFileSync(path.resolve(outPng).replace(/\.png$/, "-triangle.png"), tri.png);
    fs.writeFileSync(path.resolve(outPng).replace(/\.png$/, "-triangle-matte.png"), matte.png);
    console.log(`wrote ${outPng} (${width}×${height}, ${png.length} bytes) and its -triangle.png (${tri.width}×${tri.height}, ${tri.png.length} bytes)`);
    return;
  }
  const dataUri = `data:image/png;base64,${png.toString("base64")}`;
  const stripUri = `data:image/png;base64,${strip.png.toString("base64")}`;
  const triUri = `data:image/png;base64,${tri.png.toString("base64")}`;
  const matteUri = `data:image/png;base64,${matte.png.toString("base64")}`;
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

/** The oval on a painted STRIP (HoloStampArt.ring "strip": the OTJ Breaking
 *  News showcase, whose notch is filled with its charcoal strip): the same
 *  silver, its margin in the strip's colour (HOLO_STAMP_STRIP_RING_RGB) and
 *  no dark keyline — print's hologram meets the strip directly (OTP #1–65).
 *  ${strip.width} × ${strip.height} px, the oval's art rect at ${HOLO_STAMP_ART_SCALE}×. */
export const HOLO_STAMP_OVAL_STRIP_ART = {
  width: ${strip.width},
  height: ${strip.height},
  dataUri:
    "${stripUri}",
} as const;

/** The Universes Beyond triangle of a rare or mythic (TODO 4.25; toned
 *  onto print in Round 57's follow-up): our silver sheen at the prints'
 *  level in the prints' triangle (lib/cards/holo-stamp.ts UB_STAMP_FACE)
 *  over the black that covers the notch piece's cut (UB_STAMP_HOLE plus the
 *  margin), transparent outside it. ${tri.width} × ${tri.height} px = the HD art rect
 *  (${TW.toFixed(1)} × ${TH.toFixed(1)} px) at ${HOLO_STAMP_ART_SCALE}×. */
export const HOLO_STAMP_TRIANGLE_ART = {
  width: ${tri.width},
  height: ${tri.height},
  dataUri:
    "${triUri}",
} as const;

/** The Universes Beyond triangle of a common or uncommon: the same shape
 *  in print's flat matte grey — no sheen, no keyline. */
export const HOLO_STAMP_TRIANGLE_MATTE_ART = {
  width: ${matte.width},
  height: ${matte.height},
  dataUri:
    "${matteUri}",
} as const;

/** The art bitmap of a stamp shape and tone (lib/cards/holo-stamp.ts
 *  holoStampToneOf) — what both renderers stretch over the stamp's art
 *  rect. The oval has one face, on the notch's black or on a strip
 *  (\`ring\`, HoloStampArt.ring). */
export function holoStampArtOf(
  shape: "oval" | "triangle",
  tone: "holo" | "matte" = "holo",
  ring?: "strip",
): { width: number; height: number; dataUri: string } {
  if (shape !== "triangle") return ring === "strip" ? HOLO_STAMP_OVAL_STRIP_ART : HOLO_STAMP_OVAL_ART;
  return tone === "matte" ? HOLO_STAMP_TRIANGLE_MATTE_ART : HOLO_STAMP_TRIANGLE_ART;
}
`;
  fs.writeFileSync(MODULE, source);
  console.log(`wrote ${path.relative(process.cwd(), MODULE)} (${width}×${height}, ${png.length} bytes PNG, ${dataUri.length} chars)`);
}

await main();
