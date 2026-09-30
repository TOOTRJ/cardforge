import { describe, expect, it } from "vitest";
import {
  PAIR_RAMPS,
  TWO_COLOR_PAIRS,
  blendPair,
  lerpLayers,
  pairSides,
  rampMask,
  rampName,
  rampShare,
  shareCrossings,
} from "@/scripts/lib/pair-ramp.mjs";
import * as ccFrames from "@/scripts/lib/cc-frames.mjs";
import { TWO_COLOR_PAIRS as REGISTRY_PAIRS } from "@/lib/cards/frame-reference-registry";

// ---------------------------------------------------------------------------
// TODO 4.6b — scripts/lib/pair-ramp.mjs, the ONE two-colour split both
// builders read: the pair frame masters (cc-frames.mjs pairMasterLayers) and
// the pair crown bands. Design 2026-09-29 §1.2: untilted linear ramps in % of
// the card width, measured on the prints (pinline and a hybrid's frame
// 40→60, text box 46→58, crown 43→55), blended by a premultiplied lerp.
// ---------------------------------------------------------------------------

function solid(width: number, height: number, [r, g, b, a]: [number, number, number, number]): Buffer {
  const out = Buffer.alloc(width * height * 4);
  for (let o = 0; o < out.length; o += 4) {
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a;
  }
  return out;
}

describe("the ramps", () => {
  it("are the design's, measured on the prints, and live in this ONE module (cc-frames re-exports none)", () => {
    expect(PAIR_RAMPS).toEqual({ pinline: [40, 60], frame: [40, 60], rules: [46, 58], crown: [43, 55] });
    // The pair masters (4.6b) and the pair crown bands (4.6a) read the same
    // helpers: no second name for them anywhere in the importer's library.
    for (const name of ["TWO_COLOR_RAMPS", "PAIR_RAMPS", "TWO_COLOR_PAIRS", "rampMask", "lerpLayers", "rampName", "blendPair"]) {
      expect(ccFrames, name).not.toHaveProperty(name);
    }
    expect([...TWO_COLOR_PAIRS]).toEqual([...REGISTRY_PAIRS]);
    expect(Object.isFrozen(PAIR_RAMPS)).toBe(true);
  });

  it("put the 10 / 50 / 90 % points where the prints measure them (±1.5 %W), with no tilt", () => {
    // The medians of the prints (design §1.2): pinline 42.2 / 50.3 / 58.8,
    // text box 47.2 / 51.3 / 56.8, crown 42.7 / 48.5 / 53.0 (gold) and
    // 43.8 / 50.1 / 54.3 (hybrid).
    const prints: [keyof typeof PAIR_RAMPS, number[]][] = [
      ["pinline", [42.2, 50.3, 58.8]],
      ["rules", [47.2, 51.3, 56.8]],
      ["crown", [42.7, 48.5, 53.0]],
      ["crown", [43.8, 50.1, 54.3]],
    ];
    for (const [region, measured] of prints) {
      const mask = rampMask(1500, 3, PAIR_RAMPS[region]);
      const shares = Array.from({ length: 1500 }, (_, x) => mask[x * 4 + 3] / 255);
      const at = shareCrossings(shares);
      // ±1.5 %W, plus one pixel's quantisation (the crown's 10 % point is
      // the design's 44.2 against the gold prints' 42.7: exactly 1.5).
      at.forEach((x, i) => expect(Math.abs((x ?? 0) - measured[i]), `${region} ${i}`).toBeLessThanOrEqual(1.5 + 100 / 1500));
      // Every row is the first row.
      expect(mask.subarray(1500 * 4, 1500 * 8).equals(mask.subarray(0, 1500 * 4))).toBe(true);
      expect(mask.subarray(1500 * 8).equals(mask.subarray(0, 1500 * 4))).toBe(true);
    }
  });

  it("rampShare is 0 left of the ramp, 1 right of it, linear between; a bad ramp throws", () => {
    expect(rampShare(10, [40, 60])).toBe(0);
    expect(rampShare(50, [40, 60])).toBe(0.5);
    expect(rampShare(90, [40, 60])).toBe(1);
    expect(() => rampShare(50, [60, 40])).toThrow();
    expect(() => rampMask(10, 1, [50, 50])).toThrow();
    expect(rampName([43, 55])).toBe("procedural:ramp(43→55 %W)");
  });
});

describe("blendPair", () => {
  it("is the left colour on the left, the right colour on the right, a premultiplied lerp between", () => {
    const left = solid(100, 2, [200, 0, 0, 255]);
    const right = solid(100, 2, [0, 0, 200, 255]);
    const out = blendPair(left, right, 100, 2, [40, 60]);
    expect([...out.subarray(10 * 4, 10 * 4 + 4)]).toEqual([200, 0, 0, 255]);
    expect([...out.subarray(90 * 4, 90 * 4 + 4)]).toEqual([0, 0, 200, 255]);
    // At the ramp's middle (x = 49.5 → 50 %W at the pixel centre): half each.
    expect(out[49 * 4]).toBeGreaterThan(90);
    expect(out[49 * 4]).toBeLessThan(110);
    expect(out.equals(lerpLayers(left, right, rampMask(100, 2, [40, 60])))).toBe(true);
  });

  it("keeps a shared translucent alpha (a crown's shadow stays 99, never CC's stacked 160)", () => {
    const out = blendPair(solid(50, 1, [0, 0, 0, 99]), solid(50, 1, [0, 0, 0, 99]), 50, 1, PAIR_RAMPS.crown);
    for (let x = 0; x < 50; x += 1) expect(out[x * 4 + 3]).toBe(99);
  });

  it("refuses layers of different sizes", () => {
    expect(() => lerpLayers(solid(2, 1, [0, 0, 0, 0]), solid(3, 1, [0, 0, 0, 0]), rampMask(2, 1, [40, 60]))).toThrow();
  });
});

describe("pairSides", () => {
  it("reads a pair's two colours, left first; only the ten in printed order", () => {
    expect(pairSides("wu")).toEqual(["w", "u"]);
    expect(pairSides("gu")).toEqual(["g", "u"]);
    expect(() => pairSides("uw")).toThrow();
  });
});
