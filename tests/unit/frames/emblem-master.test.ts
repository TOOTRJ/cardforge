import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.52 on the emblem MASTER the bake draws (owner evidence and
// decisions 2026-09-29): the name pill is the prints' dark pill, not Card
// Conjurer's light gradient; the silver, the type pill and the text box sit
// in the prints' range; the spark's centre ray is bridged over above the art
// window. Scryfall PNGs of TFDN #24 / #25, TM20 #11, TDSK #17, TBLB #30 and
// TFRA #16 at 1500 × 2100: the pill's median luma over the name band (rows
// 128–199 × 150–1349 px, the evidence's box) is 52 with the names' ink
// masked out and 57–70 per print with it; CC's frame.png as it is, 90 (our
// bakes read 94–97 with the name). The recipe tones it (scripts/lib/
// cc-frames.mjs EMBLEM_NAME_PILL_TONE, EMBLEM_SILVER_TONE,
// EMBLEM_TYPE_PILL_TONE, EMBLEM_TEXT_BOX_TONE, EMBLEM_RAY_BRIDGE;
// tests/unit/frames/cc-importer.test.ts has the pure half). The master is a bucket object (never in git): checked where a copy
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

describe("the emblem master (TODO 4.52, owner evidence and decisions 2026-09-29)", () => {
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
  // scale). Owner decision 2026-09-29 (round 12): the frame closes over the
  // spark's centre ray above it — the bar's shadow and the silver run across,
  // the ray ends at 251 in its own edge's outline — where the round before
  // held CC's black shadow there (a dark block on light art).
  it("bridges the spark's centre ray over above the art window: opaque, no dark block, clear below", async () => {
    const { data, info } = await sharp(files[0].file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    const lumaXY = (x: number, y: number) => luma(data, (y * info.width + x) * 4);
    for (let y = 233; y <= 250; y += 1) for (const x of [725, 733, 750, 766, 775]) expect(alpha(x, y), `${x},${y}`).toBe(255);
    // The bar's shadow runs on across the ray as beside it (x 700).
    for (let y = 233; y <= 241; y += 1) expect(Math.abs(lumaXY(750, y) - lumaXY(700, y)), `row ${y}`).toBeLessThan(8);
    // Under it, silver and the tip's outline — no black block (the held
    // shadow was black there): mean luma ≥ 100 over rows 243–250 × 735–765.
    let sum = 0;
    for (let y = 243; y <= 250; y += 1) for (let x = 735; x <= 765; x += 1) sum += lumaXY(x, y);
    expect(sum / (8 * 31)).toBeGreaterThanOrEqual(100);
    // The tip: dark at the right corner, as the ray's right edge; light at
    // the left, as its left edge.
    expect(lumaXY(765, 249)).toBeLessThan(110);
    expect(lumaXY(735, 249)).toBeGreaterThan(140);
    // The ray is clear from 251 (the first row the art covers whole).
    for (let y = 251; y < 300; y += 1) for (const x of [745, 750, 755]) expect(alpha(x, y), `${x},${y}`).toBe(0);
  });

  /** Median luma of the α-255 pixels of rows [y0, y1) in each [x0, x1),
   *  above `min`. */
  function region(d: Buffer, w: number, y0: number, y1: number, xs: [number, number][], min = -1): number {
    const out: number[] = [];
    for (const [x0, x1] of xs) {
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const o = (y * w + x) * 4;
          if (d[o + 3] === 255 && luma(d, o) > min) out.push(luma(d, o));
        }
      }
    }
    return median(out);
  }

  // Owner decision 2026-09-29 (round 12): the silver and the type bar were
  // 10–45 luma lighter than the prints. Each region's median, on the six
  // prints (the same boxes, the master's opaque pixels), from min to max:
  // CC's own in brackets.
  it("sits the silver, the type pill and the text box in the prints' range, region by region", async () => {
    const { data, info } = await sharp(files[0].file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const within = (v: number, lo: number, hi: number, name: string) => {
      expect(v, name).toBeGreaterThanOrEqual(lo);
      expect(v, name).toBeLessThanOrEqual(hi);
    };
    // Beside the name bar 120.6–128.0 (149); the rails beside the spark
    // 101.4–113.0 (141); the body above the spark's arms 138.8–161.5 (160)
    // and below 124.4–141.5 (159); beside the type bar 125.7–139.9 (149) and
    // the box 126.2–131.4 (149).
    within(region(data, w, 100, 216, [[60, 67], [1433, 1440]]), 120.6, 128.0, "beside the name bar");
    within(region(data, w, 250, 1395, [[62, 97], [1403, 1438]]), 101.4, 113.0, "the rails");
    within(region(data, w, 250, 700, [[100, 1400]]), 138.8, 161.5, "the upper body");
    within(region(data, w, 700, 1395, [[100, 1400]]), 124.4, 141.5, "the lower body");
    within(region(data, w, 1420, 1541, [[60, 65], [1435, 1440]]), 125.7, 139.9, "beside the type bar");
    within(region(data, w, 1560, 1881, [[62, 83], [1417, 1438]]), 126.2, 131.4, "beside the box");
    // The type pill 223.9–231.1 (239) and the box 226.0–232.8 (237), their
    // ink masked out on the prints (luma > 150).
    within(region(data, w, 1440, 1510, [[300, 1100]], 150), 223.9, 231.1, "the type pill");
    within(region(data, w, 1575, 1925, [[140, 1360]], 150), 226.0, 232.8, "the text box");
    // A gain, not a fill: the lower body keeps CC's shading (luma std 29).
    const lower: number[] = [];
    for (let y = 700; y < 1395; y += 3) for (let x = 100; x < 1400; x += 3) if (data[(y * w + x) * 4 + 3] === 255) lower.push(luma(data, (y * w + x) * 4));
    const mean = lower.reduce((a, b) => a + b, 0) / lower.length;
    expect(Math.sqrt(lower.reduce((a, b) => a + (b - mean) ** 2, 0) / lower.length)).toBeGreaterThan(20);
  });

  it("keeps the spark's tail translucent through the type pill and the box, toned with them", async () => {
    const { data, info } = await sharp(files[0].file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
    // CC's tail: white at α 204. Toned × 0.94 in the pill, × 0.96 in the box.
    expect(px(750, 1470)).toEqual([240, 240, 240, 204]);
    expect(px(750, 1700)).toEqual([245, 245, 245, 204]);
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
