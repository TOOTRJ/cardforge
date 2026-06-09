// Print vertical runs (transparent / dark / mid / light) down a column of a
// frame PNG — ground truth for where the painted plates sit when tuning a
// FrameProfile. Usage: node scripts/scan-frame-bands.mjs <png> [columnPct=50]
import sharp from "sharp";

const [file, colPctArg] = process.argv.slice(2);
const colPct = Number(colPctArg ?? 50);
const img = sharp(file);
const { width, height } = await img.metadata();
const raw = await img.raw().toBuffer();
const x = Math.floor((colPct / 100) * width);
const classify = (y) => {
  const i = (y * width + x) * 4;
  const a = raw[i + 3];
  if (a < 100) return "transp";
  const lum = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
  return lum > 150 ? "LIGHT" : lum > 80 ? "mid" : "dark";
};
let cur = null;
let start = 0;
for (let yPct = 0; yPct <= 100; yPct += 0.2) {
  const y = Math.min(height - 1, Math.floor((yPct / 100) * height));
  const c = classify(y);
  if (c !== cur) {
    if (cur !== null && yPct - start >= 1)
      console.log(`${cur.padEnd(6)} ${start.toFixed(1)}% → ${yPct.toFixed(1)}%`);
    cur = c;
    start = yPct;
  }
}
console.log(`${cur.padEnd(6)} ${start.toFixed(1)}% → 100%`);
