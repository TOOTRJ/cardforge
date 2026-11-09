// Build PipGlyph's own card back for the play-surface exports
// (lib/tools/play-exports, the `play-exports` beta tool): Tabletop Simulator
// needs a back picture for every card, and a custom card's back is never
// Wizards of the Coast's. The Medallion treatment on the navy ground with a
// gold frame, from the lib/brand single source of truth (never a hand-drawn
// mark or an eyeballed hex). 750 × 1050, square corners (TTS rounds them).
//
//   node scripts/build-play-card-back.mjs
//
// Requires node ≥23.6 (imports lib/brand/*.ts via native type-stripping).

import path from "node:path";
import sharp from "sharp";
import { BRAND } from "../lib/brand/constants.ts";
import { medallionSvg, wordmarkSvg } from "../lib/brand/svg.ts";

const W = 750;
const H = 1050;
const OUT = path.join(process.cwd(), "public", "tools", "play-exports", "card-back.png");

/** A brand SVG placed at a box of the card. */
function place(svg, { x, y, width, height }) {
  return svg.replace("<svg ", `<svg x="${x}" y="${y}" width="${width}" height="${height}" `);
}

const mark = 440;
const wordWidth = 330;
const wordHeight = Math.round(wordWidth * (80.8 / 512.4));
const markY = Math.round(H / 2 - mark / 2 - 40);

const svg =
  `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">` +
  `<defs>` +
  `<radialGradient id="cb-ground" cx="50%" cy="46%" r="70%"><stop offset="0%" stop-color="${BRAND.surface}"/><stop offset="100%" stop-color="${BRAND.navy}"/></radialGradient>` +
  `<linearGradient id="cb-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${BRAND.goldLight}"/><stop offset="100%" stop-color="${BRAND.goldDeep}"/></linearGradient>` +
  `</defs>` +
  `<rect width="${W}" height="${H}" fill="${BRAND.socket}"/>` +
  `<rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="26" fill="url(#cb-ground)"/>` +
  `<rect x="30" y="30" width="${W - 60}" height="${H - 60}" rx="26" fill="none" stroke="url(#cb-gold)" stroke-width="6"/>` +
  `<rect x="52" y="52" width="${W - 104}" height="${H - 104}" rx="16" fill="none" stroke="${BRAND.purple}" stroke-width="2" opacity="0.35"/>` +
  place(medallionSvg(), { x: Math.round(W / 2 - mark / 2), y: markY, width: mark, height: mark }) +
  place(wordmarkSvg({ theme: "dark" }), {
    x: Math.round(W / 2 - wordWidth / 2),
    y: markY + mark + 24,
    width: wordWidth,
    height: wordHeight,
  }) +
  `</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(OUT);
console.log(`wrote ${path.relative(process.cwd(), OUT)}`);
