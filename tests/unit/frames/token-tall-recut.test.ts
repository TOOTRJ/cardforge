import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { TOKEN_TALL_RECIPE, recutTokenTall } from "../../../scripts/lib/token-tall.mjs";
import manifest from "@/lib/frames/frame-manifest.json";

// ---------------------------------------------------------------------------
// TODO 4.55: the arch token's tall box is PipGlyph's own cut of the
// published text-box masters (scripts/build-token-tall-frames.mjs). The cut
// moves rows and cross-fades seams — it never draws a pixel — and leaves
// every row outside [fromY − up, toY) byte for byte. A synthetic image whose
// every pixel encodes its own row and column holds that here; the published
// masters are checked against their parents where the bucket copies are on
// disk (FRAMES_BUILD_DIR, as CI's frames cache).
// ---------------------------------------------------------------------------

const R = TOKEN_TALL_RECIPE;
const { width: W, height: H, up, fromY, toY, boxLeft, boxRight, blendTop, blendSide, blendBottom } = R;

/** An opaque image whose pixel (x, y) reads back its row and column. */
function coded(): Buffer {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      buf[o] = y & 0xff;
      buf[o + 1] = y >> 8;
      buf[o + 2] = x & 0xff;
      buf[o + 3] = 255;
    }
  }
  return buf;
}
const rowOf = (buf: Buffer, x: number, y: number) => {
  const o = (y * W + x) * 4;
  return buf[o] + (buf[o + 1] << 8);
};

describe("the tall box's cut (recutTokenTall)", () => {
  const src = coded();
  const out = recutTokenTall(src);

  it("leaves every row above the cut and from its end on byte for byte", () => {
    for (const y of [0, 100, fromY - up - 1, toY, toY + 1, 1900, H - 1]) {
      expect(out.subarray(y * W * 4, (y + 1) * W * 4).equals(src.subarray(y * W * 4, (y + 1) * W * 4)), `row ${y}`).toBe(true);
    }
  });

  it("moves the band up by `up` px, whole rows, every column", () => {
    for (let y = fromY - up + blendTop; y < toY - up; y += 7) {
      for (const x of [0, 50, boxLeft, 750, boxRight - 1, boxRight, 1499]) expect(rowOf(out, x, y), `${x},${y}`).toBe(y + up);
    }
  });

  it("fills the gained box: its paper continues the band, the sides come from the rows `up` above them", () => {
    for (let y = toY - up; y < toY - blendBottom; y += 5) {
      for (const x of [boxLeft, 750, boxRight - 1]) expect(rowOf(out, x, y), `box ${x},${y}`).toBe(y + up);
      if (y >= toY - up + blendSide) {
        for (const x of [0, 60, boxLeft - 1, boxRight, 1460]) expect(rowOf(out, x, y), `side ${x},${y}`).toBe(y - up);
      }
    }
  });

  it("never draws: every channel in the cut lies between the pixels it blends (its own row, `up` below, `up` above)", () => {
    for (let y = fromY - up; y < toY; y += 3) {
      for (const x of [0, 80, boxLeft, 900, boxRight]) {
        const o = (y * W + x) * 4;
        for (let c = 0; c < 4; c += 1) {
          const from = [y, y + up, y - up].map((r) => src[(r * W + x) * 4 + c]);
          const v = out[o + c];
          expect(v >= Math.min(...from) - 1 && v <= Math.max(...from) + 1, `${x},${y} channel ${c}: ${v} not in ${from}`).toBe(true);
        }
      }
    }
  });

  it("refuses a recipe it can't apply", () => {
    expect(() => recutTokenTall(src, { ...R, up: 0 } as unknown as typeof R)).toThrow(/bad recipe/);
    expect(() => recutTokenTall(src, { ...R, toY: fromY } as unknown as typeof R)).toThrow(/bad recipe/);
    expect(() => recutTokenTall(src, { ...R, boxRight: W } as unknown as typeof R)).toThrow(/bad recipe/);
    expect(() => recutTokenTall(Buffer.alloc(16))).toThrow(/expected 1500×2100/);
  });
});

// The published masters (bucket objects, never git): each must be its
// parent's cut exactly, and its WebP's alpha its PNG's.
const files = (manifest as { files: Record<string, { sha256: string }> }).files;
const dir = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : null;
const local = (rel: string): string | null => {
  if (!dir) return null;
  const file = path.join(dir, rel);
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex") === files[rel]?.sha256 ? file : null;
};
const raw = async (file: string) => (await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })).data;

describe("the published tall-box masters", () => {
  it("are in the manifest, one per colour key, PNG and WebP", () => {
    for (const template of Object.keys(R.templates)) {
      for (const key of R.keys) {
        expect(files[`${template}/${key}.png`], `${template}/${key}.png`).toBeDefined();
        expect(files[`${template}/${key}.webp`], `${template}/${key}.webp`).toBeDefined();
      }
    }
  });

  for (const [template, parent] of Object.entries(R.templates)) {
    for (const key of R.keys) {
      const tall = local(`${template}/${key}.png`);
      const from = local(`${parent}/${key}.png`);
      it.skipIf(!tall || !from)(`${template}/${key} is ${parent}/${key}'s cut, its WebP alpha equal`, async () => {
        const made = recutTokenTall(await raw(from!));
        expect((await raw(tall!)).equals(made)).toBe(true);
        const webp = local(`${template}/${key}.webp`);
        if (webp) {
          const a = await raw(webp);
          for (let i = 3; i < made.length; i += 4) if (a[i] !== made[i]) throw new Error(`alpha differs at ${(i - 3) / 4}`);
        }
      });
    }
  }
});
