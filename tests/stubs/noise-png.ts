import sharp from "sharp";

// ---------------------------------------------------------------------------
// Print-size art at its most incompressible (TODO 6.10): a noise PNG, whose
// size is ~width × height × channels — 2000×2800 RGB is ~16 MiB, past the
// 8 MiB a third-party model gets as-is (lib/media/model-input.ts).
// Deterministic (mulberry32), so every run encodes the same file.
// ---------------------------------------------------------------------------

export async function noisePng(width: number, height: number, channels: 3 | 4 = 3, seed = 1): Promise<Buffer> {
  const data = Buffer.alloc(width * height * channels);
  let a = seed >>> 0;
  for (let i = 0; i < data.length; i += 4) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    t = (t ^ (t >>> 14)) >>> 0;
    data[i] = t & 0xff;
    if (i + 1 < data.length) data[i + 1] = (t >>> 8) & 0xff;
    if (i + 2 < data.length) data[i + 2] = (t >>> 16) & 0xff;
    if (i + 3 < data.length) data[i + 3] = t >>> 24;
  }
  if (channels === 4) for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}
