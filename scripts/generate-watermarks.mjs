// Generate the original PipGlyph watermark preset PNGs
// (public/watermarks/{key}.png) from inline SVG paths — bold single-ink
// geometric marks that read cleanly at 12–20% opacity behind rules text.
// Idempotent; rerun after editing a path. Keys must match
// WATERMARK_PRESETS in lib/cards/watermark.ts.
//
//   node scripts/generate-watermarks.mjs

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = path.join(process.cwd(), "public", "watermarks");
const SIZE = 1024;
const INK = "#3b3126";

// Each mark is drawn in a 100×100 viewBox, centered, generous margins.
const MARKS = {
  // Radiant sun disc with eight tapered rays.
  "order-sun": `
    <circle cx="50" cy="50" r="16"/>
    ${Array.from({ length: 8 })
      .map((_, i) => {
        const a = (i * Math.PI) / 4;
        const x2 = 50 + Math.cos(a) * 42;
        const y2 = 50 + Math.sin(a) * 42;
        const p = Math.PI / 22;
        const xa = 50 + Math.cos(a + p) * 22;
        const ya = 50 + Math.sin(a + p) * 22;
        const xb = 50 + Math.cos(a - p) * 22;
        const yb = 50 + Math.sin(a - p) * 22;
        return `<polygon points="${xa},${ya} ${x2},${y2} ${xb},${yb}"/>`;
      })
      .join("")}
  `,
  // Three stacked crescent waves.
  "tide-crest": `
    <path d="M10 38 Q30 22 50 38 T90 38 Q70 30 50 44 T10 38 Z"/>
    <path d="M10 58 Q30 42 50 58 T90 58 Q70 50 50 64 T10 58 Z"/>
    <path d="M10 78 Q30 62 50 78 T90 78 Q70 70 50 84 T10 78 Z"/>
  `,
  // Stylized bird skull, profile, heavy beak.
  "raven-skull": `
    <path d="M28 34 Q40 18 58 22 Q76 26 78 40 Q92 46 90 52 Q74 52 68 50 Q70 62 60 70 Q48 78 36 72 Q24 66 24 52 Q24 42 28 34 Z"/>
    <circle cx="46" cy="40" r="7" fill="#fff"/>
  `,
  // Upswept flame with a fang notch.
  "ember-fang": `
    <path d="M50 10 Q64 28 58 40 Q72 36 74 52 Q76 70 60 82 Q64 68 54 62 Q56 76 44 84 Q26 74 28 54 Q30 40 42 34 Q36 22 50 10 Z"/>
  `,
  // Symmetric antler rack rising from a crescent.
  "wildwood-antler": `
    <path d="M50 86 Q34 80 34 66 L34 60 Q26 58 24 46 Q32 50 34 46 Q26 40 26 28 Q34 34 38 32 Q34 24 38 14 Q46 24 46 36 L46 60 Q46 70 50 74 Q54 70 54 60 L54 36 Q54 24 62 14 Q66 24 62 32 Q66 34 74 28 Q74 40 66 46 Q68 50 76 46 Q74 58 66 60 L66 66 Q66 80 50 86 Z"/>
  `,
  // Eight-tooth cog with a hollow hub.
  "gearworks-cog": `
    ${Array.from({ length: 8 })
      .map((_, i) => {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        const x = 50 + Math.cos(a) * 34;
        const y = 50 + Math.sin(a) * 34;
        return `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" transform="rotate(${(a * 180) / Math.PI} ${x} ${y})"/>`;
      })
      .join("")}
    <circle cx="50" cy="50" r="30"/>
    <circle cx="50" cy="50" r="13" fill="#fff"/>
  `,
  // Two interlocked S-serpents.
  "twin-serpent": `
    <path d="M30 18 Q14 26 20 40 Q26 52 42 50 Q56 48 60 58 Q64 70 52 76 Q40 82 32 74 Q40 78 46 72 Q52 64 42 60 Q26 56 18 44 Q10 28 30 18 Z"/>
    <path d="M70 82 Q86 74 80 60 Q74 48 58 50 Q44 52 40 42 Q36 30 48 24 Q60 18 68 26 Q60 22 54 28 Q48 36 58 40 Q74 44 82 56 Q90 72 70 82 Z"/>
  `,
  // Closed crown ringed by laurel sprigs.
  "crown-laurel": `
    <path d="M26 62 L22 34 L36 48 L50 26 L64 48 L78 34 L74 62 Z"/>
    <rect x="26" y="66" width="48" height="8" rx="3"/>
    <path d="M14 78 Q28 84 42 80 Q28 80 20 72 Z"/>
    <path d="M86 78 Q72 84 58 80 Q72 80 80 72 Z"/>
  `,
};

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const [key, body] of Object.entries(MARKS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${SIZE}" height="${SIZE}"><g fill="${INK}">${body}</g></svg>`;
  const out = path.join(OUT_DIR, `${key}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log("wrote", out);
}
