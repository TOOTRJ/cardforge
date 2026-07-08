// Identify which Full-Magic-Pack source each PipGlyph m15-era frame PNG was
// built from: mean |RGB diff| over the pixels where OUR frame is opaque
// (skips the cut art windows), after resizing ours down to the source size.
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const APP = "/Users/redjester/Projects/Next/MTGCardForge/public/frames";
const PACK = "/Users/redjester/Projects/other/Full-Magic-Pack/data";
const MOD = path.join(PACK, "magic-modules.mse-include/cards");

async function loadRaw(file, w, h) {
  return sharp(file).resize(w, h, { fit: "fill" }).ensureAlpha()
    .raw().toBuffer({ resolveWithObject: true });
}

async function diff(ourFile, srcFile) {
  if (!fs.existsSync(srcFile)) return null;
  const meta = await sharp(srcFile).metadata();
  const w = meta.width, h = meta.height;
  const our = await loadRaw(ourFile, w, h);
  const src = await loadRaw(srcFile, w, h);
  let sum = 0, n = 0;
  for (let i = 0; i < our.data.length; i += 4) {
    if (our.data[i + 3] < 250) continue; // skip transparent (art windows)
    sum += Math.abs(our.data[i] - src.data[i])
         + Math.abs(our.data[i + 1] - src.data[i + 1])
         + Math.abs(our.data[i + 2] - src.data[i + 2]);
    n++;
  }
  return n ? (sum / n / 3) : null;
}

const CASES = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const { template, color, candidates } of CASES) {
  const ourFile = path.join(APP, template, `${color}.png`);
  if (!fs.existsSync(ourFile)) { console.log(`${template}/${color}: MISSING APP PNG`); continue; }
  const scores = [];
  for (const [label, rel] of candidates) {
    const d = await diff(ourFile, rel.startsWith("/") ? rel : path.join(MOD, rel));
    if (d !== null) scores.push([label, d]);
  }
  scores.sort((a, b) => a[1] - b[1]);
  const line = scores.map(([l, d]) => `${l}=${d.toFixed(1)}`).join("  ");
  console.log(`${template}/${color}:  ${line}`);
}
