// Placeholder frame generator. Outputs simple original frame PNGs to
// public/frames/regular/{color}.png — one per mana color. These are
// clean geometric layouts (colored bevel border, header plate, art
// well outline, type plate, text panel, footer) generated from
// inline SVG with Sharp. No third-party assets, no derived artwork.
//
// To regenerate: `npx tsx scripts/generate-frame-placeholders.ts`
// (or wire into a "frames" npm script if you re-run often).
//
// To upgrade visual fidelity: drop your own frame PNGs into
// public/frames/regular/ using the same {color}.png naming and they
// will be picked up automatically by FrameLayer + the Satori bake.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Render dimensions match the HD Satori preset (1500×2100) so the
// bake doesn't have to upscale. The live preview will scale down via
// next/image as needed.
const WIDTH = 1500;
const HEIGHT = 2100;

type FrameColor = {
  key: string;
  name: string;
  /** Outer bevel hue (dominant frame ring). */
  bevel: string;
  /** Inner panel base. */
  inner: string;
  /** Highlight stripe along the bevel. */
  highlight: string;
};

// Hues are loosely matched to the WUBRG-C-M palette already used elsewhere
// in the app (globals.css mana variables). All values are mine; no source
// art is referenced.
const COLORS: FrameColor[] = [
  { key: "w", name: "white",      bevel: "#d9c98a", inner: "#f5e9c2", highlight: "#fff7d6" },
  { key: "u", name: "blue",       bevel: "#2f6ea0", inner: "#5798c8", highlight: "#a8d2f1" },
  { key: "b", name: "black",      bevel: "#1f1c1a", inner: "#36322f", highlight: "#5e5651" },
  { key: "r", name: "red",        bevel: "#a13524", inner: "#d56b4d", highlight: "#f4a987" },
  { key: "g", name: "green",      bevel: "#2f6a3c", inner: "#5d9762", highlight: "#a3cf9f" },
  { key: "c", name: "colorless",  bevel: "#5e5e63", inner: "#8a8a90", highlight: "#bfbfc5" },
  { key: "m", name: "multicolor", bevel: "#a37b2d", inner: "#d6b15a", highlight: "#f3e1a0" },
];

// Inset values define where each plate sits relative to the card.
// All in percentages of card width/height so the SVG scales cleanly.
// Calibrated to match the section heights in card-preview.tsx:
//   title    ~8%   (top)
//   art     ~46%   (middle)
//   type     ~6%
//   rules   ~32%
//   footer   ~5%   (bottom)
const LAYOUT = {
  // Outer bevel — the thick colored ring that defines the frame's color.
  bevel: { x: 0, y: 0, w: 100, h: 100, radius: 4.2 },
  // Inner panel — the dark plate the sections sit on. The compositor
  // draws section panels (title/type/rules) over this; the frame just
  // needs to paint the right base color around them.
  inner: { x: 3, y: 3, w: 94, h: 94, radius: 3.5 },
  // Art well outline — a thin inner border that frames the art region.
  artWell: { x: 6, y: 11, w: 88, h: 39 },
  // Text well outline.
  textWell: { x: 6, y: 56, w: 88, h: 35 },
};

function frameSvg(color: FrameColor): string {
  const { bevel, inner, highlight } = color;
  const L = LAYOUT;
  // Subtle radial highlight in the top-left so the bevel reads as
  // beveled rather than flat. Matches the "specular" look real cards
  // get from photoflood lighting in product shots.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none" shape-rendering="geometricPrecision">
  <defs>
    <linearGradient id="bevel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${highlight}" />
      <stop offset="50%" stop-color="${bevel}" />
      <stop offset="100%" stop-color="${bevel}" stop-opacity="0.75" />
    </linearGradient>
    <linearGradient id="inner" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${inner}" stop-opacity="0.92" />
      <stop offset="100%" stop-color="#0e0e12" stop-opacity="0.95" />
    </linearGradient>
    <radialGradient id="sheen" cx="0.25" cy="0.15" r="0.6">
      <stop offset="0%" stop-color="white" stop-opacity="0.18" />
      <stop offset="100%" stop-color="white" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Outer bevel ring -->
  <rect x="${L.bevel.x}" y="${L.bevel.y}" width="${L.bevel.w}" height="${L.bevel.h}"
        rx="${L.bevel.radius}" ry="${L.bevel.radius}" fill="url(#bevel)" />

  <!-- Inner panel -->
  <rect x="${L.inner.x}" y="${L.inner.y}" width="${L.inner.w}" height="${L.inner.h}"
        rx="${L.inner.radius}" ry="${L.inner.radius}" fill="url(#inner)" />

  <!-- Specular sheen -->
  <rect x="${L.inner.x}" y="${L.inner.y}" width="${L.inner.w}" height="${L.inner.h}"
        rx="${L.inner.radius}" ry="${L.inner.radius}" fill="url(#sheen)" />

  <!-- Art well outline -->
  <rect x="${L.artWell.x}" y="${L.artWell.y}" width="${L.artWell.w}" height="${L.artWell.h}"
        fill="none" stroke="${bevel}" stroke-width="0.4" stroke-opacity="0.7" />

  <!-- Text well outline -->
  <rect x="${L.textWell.x}" y="${L.textWell.y}" width="${L.textWell.w}" height="${L.textWell.h}"
        fill="none" stroke="${bevel}" stroke-width="0.3" stroke-opacity="0.5" />
</svg>`;
}

async function main() {
  const outDir = path.join(process.cwd(), "public", "frames", "regular");
  await fs.mkdir(outDir, { recursive: true });

  for (const color of COLORS) {
    const svg = frameSvg(color);
    const out = path.join(outDir, `${color.key}.png`);
    await sharp(Buffer.from(svg))
      .resize(WIDTH, HEIGHT, { fit: "fill" })
      .png({ compressionLevel: 9 })
      .toFile(out);
    const stat = await fs.stat(out);
    console.log(`generated ${out}  (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
