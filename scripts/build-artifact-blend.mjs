// ---------------------------------------------------------------------------
// build-artifact-blend.mjs — colored M15 artifact frames.
//
// Real colored artifacts (Embercleave, The Great Henge…) keep the silver
// artifact plates + textbox but take the COLOR's outer border. MSE encodes
// this as artifact_blend_card.png: a mask where white = artifact card,
// black = color card. We lerp the two 375px sources through the mask's
// luminance, write the blends to a temp dir, and leave the upscale + art
// window cut to convert-mse-frame.mjs pointed at that dir.
//
//   node scripts/build-artifact-blend.mjs
// ---------------------------------------------------------------------------
import sharp from "sharp";
import path from "node:path";
import fs from "node:fs";

const SRC =
  "/Users/redjester/Projects/other/Full-Magic-Pack/data/magic-modules.mse-include/cards/375 m15 simple";
const OUT = path.join(process.cwd(), ".artifact-blend-tmp");
const COLORS = ["w", "u", "b", "r", "g", "m"];

fs.mkdirSync(OUT, { recursive: true });

const maskRaw = await sharp(path.join(SRC, "artifact_blend_card.png"))
  .resize(375, 523, { fit: "fill" })
  .removeAlpha()
  .greyscale()
  .raw()
  .toBuffer();

const artifact = await sharp(path.join(SRC, "acard.jpg"))
  .resize(375, 523, { fit: "fill" })
  .removeAlpha()
  .raw()
  .toBuffer();

for (const k of COLORS) {
  const color = await sharp(path.join(SRC, `${k}card.jpg`))
    .resize(375, 523, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const out = Buffer.alloc(color.length);
  for (let p = 0, m = 0; p < color.length; p += 3, m++) {
    const t = maskRaw[m] / 255; // 1 = artifact interior, 0 = color border
    out[p] = Math.round(artifact[p] * t + color[p] * (1 - t));
    out[p + 1] = Math.round(artifact[p + 1] * t + color[p + 1] * (1 - t));
    out[p + 2] = Math.round(artifact[p + 2] * t + color[p + 2] * (1 - t));
  }
  await sharp(out, { raw: { width: 375, height: 523, channels: 3 } })
    .png()
    .toFile(path.join(OUT, `${k}blend.png`));
  console.log(`${k}blend.png`);
}
console.log("done →", OUT);
