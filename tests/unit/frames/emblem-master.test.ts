import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.52 on the emblem MASTER the bake draws (owner evidence 2026-09-29):
// the name pill is the prints' dark pill, not Card Conjurer's light gradient.
// Scryfall PNGs of TFDN #24 / #25, TM20 #11, TDSK #17, TBLB #30 and TFRA #16
// at 1500 × 2100: the pill's median luma over the name band (rows 128–199 ×
// 150–1349 px, the evidence's box) is 52 with the names' ink masked out and
// 57–70 per print with it; CC's frame.png as it is, 90 (our bakes read
// 94–97 with the name). The recipe tones it (scripts/lib/cc-frames.mjs
// EMBLEM_NAME_PILL_TONE; tests/unit/frames/cc-importer.test.ts has the pure
// half). The master is a bucket object (never in git): checked where a copy
// at the manifest's sha256 is on disk — FRAMES_BUILD_DIR, else
// <repo>/.frames-build — and CI fetches it (the dev bucket before the owner
// promotes it), where a missing one FAILS instead of skipping.
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string }> };
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;

function masterFile(key: string): string | null {
  const rel = `emblem/${key}.png`;
  const entry = manifest.files[rel];
  if (!entry) throw new Error(`the manifest has no ${rel}`);
  const file = path.join(BUILD, rel);
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex") === entry.sha256 ? file : null;
}

const luma = (d: Buffer, o: number) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Luma of every pixel in rows [y0, y1) × columns [x0, x1). */
function band(d: Buffer, w: number, y0: number, y1: number, x0: number, x1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) out.push(luma(d, (y * w + x) * 4));
  return out;
}

describe("the emblem master's name pill (TODO 4.52, owner evidence 2026-09-29)", () => {
  const files = KEYS.map((key) => ({ key, file: masterFile(key) }));
  if (!STRICT && files.some((f) => !f.file)) {
    it.skip("emblem masters not available here (frames bucket; set FRAMES_BUILD_DIR)", () => {});
    return;
  }

  it("has every colour key's master (the same silver one)", () => {
    expect(files.filter((f) => !f.file).map((f) => f.key)).toEqual([]);
    expect(new Set(KEYS.map((k) => manifest.files[`emblem/${k}.png`].sha256)).size).toBe(1);
  });

  it("prints the prints' dark pill: median luma 48–58 over the name band (CC's own: 90)", async () => {
    const { data, info } = await sharp(files[0].file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1500, 2100]);
    const m = median(band(data, info.width, 128, 200, 150, 1350));
    expect(m).toBeGreaterThanOrEqual(48);
    expect(m).toBeLessThanOrEqual(58);
    // Its ends as the prints' (~97 at 112–139 px across; CC's 140) and its
    // middle (45–60).
    expect(median(band(data, info.width, 128, 200, 112, 140))).toBeLessThan(110);
    expect(median(band(data, info.width, 140, 180, 400, 1100))).toBeLessThan(60);
  });

  // The art window starts at 250.4 px (Scryfall's art_crop at the prints'
  // scale); above it, the spark's centre ray is shadowed, never clear.
  it("shadows the spark's centre ray down to the art window, and clears it below", async () => {
    const { data, info } = await sharp(files[0].file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    for (let y = 235; y <= 250; y += 1) for (const x of [733, 750, 766]) expect(alpha(x, y), `${x},${y}`).toBeGreaterThanOrEqual(180);
    for (let y = 258; y < 300; y += 1) expect(alpha(750, y), `750,${y}`).toBeLessThan(16);
  });

  it("keeps the pill's top highlight and makes its body opaque, as printed", async () => {
    const { data, info } = await sharp(files[0].file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // CC's highlight line under the pill's top outline (the prints' is at
    // 105–113, luma 150–200).
    expect(median(band(data, info.width, 105, 110, 300, 1200))).toBeGreaterThan(160);
    // CC left the spark's ray at α 242 down the pill's middle.
    let translucent = 0;
    for (let y = 111; y < 211; y += 1) for (let x = 120; x < 1380; x += 1) if (data[(y * info.width + x) * 4 + 3] < 255) translucent += 1;
    expect(translucent).toBe(0);
  });
});
