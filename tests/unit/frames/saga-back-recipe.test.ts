import { describe, expect, it } from "vitest";
import { checkSourceTone, toneSourceRegions } from "@/scripts/lib/cc-frames.mjs";
import {
  SAGA_BACK_KEYS,
  SAGA_BACK_READ_REGIONS,
  SAGA_BACK_TONES,
  SAGA_TYPE_DY,
  TITLE_TONE_FADE_PX,
  blendThrough,
  paperToneMask,
  planeL1,
  readTone,
  shiftPlane,
  shiftRgba,
  titleToneMask,
} from "@/scripts/lib/saga-back.mjs";
import { SAGA_TYPE_ROW_DY_PX } from "@/lib/cards/template-layout";
import manifest from "@/lib/frames/frame-manifest.json";
import provenance from "@/lib/cards/frame-sources.json";

// ---------------------------------------------------------------------------
// TODO 5.5 (b), PR 2 — the double-faced saga back's recipe
// (scripts/lib/saga-back.mjs, scripts/build-saga-back-frames.mjs): the tone
// table, the moves and the pure pixel helpers; the published masters and
// their provenance agree with it.
// ---------------------------------------------------------------------------

describe("the recipe's data", () => {
  it("tones every coloured key's paper and both bars, each a valid source tone; the colourless key untoned (no print)", () => {
    expect(Object.keys(SAGA_BACK_TONES).sort()).toEqual(["b", "g", "m", "r", "u", "w"]);
    for (const [key, tones] of Object.entries(SAGA_BACK_TONES)) {
      expect(Object.keys(tones).sort(), key).toEqual(["paper", "title", "type"]);
      for (const [region, tone] of Object.entries(tones)) {
        expect(() => checkSourceTone(`${key}.${region}`, tone)).not.toThrow();
        expect(SAGA_BACK_READ_REGIONS[region as keyof typeof SAGA_BACK_READ_REGIONS], region).toBeDefined();
      }
      // The paper greys toward the printed back box: darker on every channel.
      tones.paper.to.forEach((v: number, c: number) => expect(v, `${key} paper ${c}`).toBeLessThan(tones.paper.from[c]));
    }
    expect(SAGA_BACK_KEYS).toEqual(["w", "u", "b", "r", "g", "m", "c"]);
    expect(TITLE_TONE_FADE_PX.to).toBeLessThan(1271);
  });

  it("moves the type bar exactly as the profile moves the dot", () => {
    expect(SAGA_TYPE_DY).toBe(593);
    expect(SAGA_TYPE_ROW_DY_PX).toBe(SAGA_TYPE_DY);
  });

  it("is published in all seven keys, PNG + WebP, with its provenance", () => {
    const files = (manifest as { files: Record<string, { width: number; height: number }> }).files;
    for (const key of SAGA_BACK_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`sagadfcback/${key}.${ext}`];
        expect(entry, `${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([1500, 2100]);
      }
    }
    const record = (provenance as Record<string, { source: string; converter: string; colors: Record<string, string[]> }>).sagadfcback;
    expect(record.source).toBe("pipglyph");
    expect(record.converter).toBe("scripts/build-saga-back-frames.mjs");
    expect(Object.keys(record.colors).sort()).toEqual([...SAGA_BACK_KEYS].sort());
  });
});

describe("the pixel helpers", () => {
  const W = 4;
  const H = 3;

  it("shift a plane and an RGBA buffer down, leaving the top empty", () => {
    const plane = Uint8Array.from({ length: W * H }, (_, i) => i + 1);
    const moved = shiftPlane(plane, W, H, 1);
    expect([...moved.subarray(0, W)]).toEqual([0, 0, 0, 0]);
    expect([...moved.subarray(W, 2 * W)]).toEqual([1, 2, 3, 4]);
    const rgba = Buffer.alloc(W * H * 4, 7);
    const movedRgba = shiftRgba(rgba, W, H, 2);
    expect(movedRgba.subarray(0, 2 * W * 4).every((v) => v === 0)).toBe(true);
    expect(movedRgba.subarray(2 * W * 4).every((v) => v === 7)).toBe(true);
    expect(planeL1(plane, moved)).toBeGreaterThan(0);
    expect(planeL1(plane, plane)).toBe(0);
  });

  it("blend through a mask (alpha included) and count what it touched", () => {
    const base = Buffer.alloc(W * H * 4, 0);
    const top = Buffer.alloc(W * H * 4, 200);
    const mask = new Uint8Array(W * H);
    mask[0] = 255;
    mask[1] = 128;
    expect(blendThrough(base, top, mask)).toBe(2);
    expect([...base.subarray(0, 4)]).toEqual([200, 200, 200, 200]);
    expect(base[4]).toBe(100);
    expect(base[8]).toBe(0);
  });

  it("fade the title tone out toward the well; take the ribbon out of the paper", () => {
    const width = 1500;
    const mask = new Uint8Array(width).fill(255);
    const faded = titleToneMask(mask, width);
    expect(faded[TITLE_TONE_FADE_PX.from]).toBe(255);
    expect(faded[TITLE_TONE_FADE_PX.to]).toBe(0);
    expect(faded[1300]).toBe(0);
    const paper = paperToneMask(Uint8Array.from([255, 255, 0]), Uint8Array.from([0, 255, 0]));
    expect([...paper]).toEqual([255, 0, 0]);
  });

  it("reads a region the UB way and the tone lands `from` on `to`", () => {
    const width = 20;
    const height = 20;
    const buf = Buffer.alloc(width * height * 4);
    for (let p = 0; p < width * height; p += 1) buf.set([167, 158, 149, 255], p * 4);
    expect(readTone(buf, [[0, 0, width, height]], width)).toEqual([167, 158, 149]);
    const tone = SAGA_BACK_TONES.w.title;
    const region = new Uint8Array(width * height).fill(255);
    const toned = toneSourceRegions(buf, width, height, { title: region }, { title: tone });
    expect(readTone(toned, [[0, 0, width, height]], width)).toEqual(tone.to);
  });
});
