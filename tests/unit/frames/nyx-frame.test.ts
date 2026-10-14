import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { NYX_RIM_REGION, NYX_RIM_TONES, nyxRimMask, shiftTone, toneNyxRim } from "@/scripts/lib/nyx-frame.mjs";

// ---------------------------------------------------------------------------
// The Nyx Constellation frame's rim on its prints (owner Round 59, decision
// 1; scripts/lib/nyx-frame.mjs, applied by scripts/build-variation-frames.mjs
// after the type bar / text box tone). The committed masters
// (public/frames/nyx, MSE-derived) carry the toned rim; gold and colourless
// are not printed and keep MSE's.
// ---------------------------------------------------------------------------

/** The recipe's region with a smaller least piece for a 200 px card. */
const REGION = { ...NYX_RIM_REGION, minPiece: 200 } as unknown as typeof NYX_RIM_REGION;
const W = 200;
const H = 200;

/** A synthetic master: a flat rim ring over black, a field colour outside
 *  it, a speck of the rim's colour in the field, and a half-covered edge. */
function master(rim: readonly number[], field: readonly number[]) {
  const d = Buffer.alloc(W * H * 4, 0);
  const put = (x: number, y: number, c: readonly number[]) => d.set([...c, 255], (y * W + x) * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, field);
  for (let y = 40; y < 160; y++)
    for (let x = 40; x < 160; x++) {
      const ring = x < 52 || x >= 148 || y < 52 || y >= 148;
      put(x, y, ring ? rim : [0, 0, 0]);
    }
  // The ring's inner edge at x = 52: half rim, half black.
  for (let y = 60; y < 140; y++) put(52, y, rim.map((v) => Math.round(v / 2)));
  // A star of the rim's colour in the field, far from the ring.
  put(10, 10, rim);
  return d;
}
const at = (d: Buffer, x: number, y: number) => [...d.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];

describe("the rim tones (the prints' numbers)", () => {
  it("tones the five printed colours and no other key", () => {
    expect(Object.keys(NYX_RIM_TONES).sort()).toEqual(["b", "g", "r", "u", "w"]);
    expect(NYX_RIM_TONES.r).toEqual({ from: [239, 56, 39], to: [220, 59, 22] });
    expect(NYX_RIM_TONES.u).toEqual({ from: [0, 117, 190], to: [10, 93, 193] });
    expect(NYX_RIM_TONES.g).toEqual({ from: [0, 123, 67], to: [45, 107, 71] });
    expect(NYX_RIM_TONES.b).toEqual({ from: [39, 38, 36], to: [62, 57, 54] });
    expect(NYX_RIM_TONES.w).toEqual({ from: [252, 254, 255], to: [238, 236, 240] });
  });
});

describe("toneNyxRim", () => {
  it("lands the flat rim on `to`, keeps an edge's coverage over black, leaves black, the field and a lone speck alone", () => {
    const rim = [0, 123, 67];
    const d = master(rim, [44, 94, 52]);
    const before = Buffer.from(d);
    const { changed } = toneNyxRim(d, W, H, { from: rim, to: [45, 107, 71] }, { minFlat: 1000, region: REGION });
    expect(changed).toBeGreaterThan(0);
    expect(at(d, 45, 100)).toEqual([45, 107, 71]);
    expect(at(d, 52, 100)).toEqual([23, 54, 36]); // half of the new tone, as it was half of the old
    expect(at(d, 100, 100)).toEqual([0, 0, 0]);
    expect(at(d, 20, 100)).toEqual([44, 94, 52]);
    expect(at(d, 10, 10)).toEqual(rim); // a star of the rim's colour is not the rim
    for (let i = 3; i < d.length; i += 4) if (d[i] !== before[i]) throw new Error("alpha moved");
  });

  it("refuses a master that holds too little of the rim (already toned, or another drawing)", () => {
    const d = master([0, 123, 67], [44, 94, 52]);
    toneNyxRim(d, W, H, { from: [0, 123, 67], to: [45, 107, 71] }, { minFlat: 1000, region: REGION });
    expect(() => toneNyxRim(d, W, H, { from: [0, 123, 67], to: [45, 107, 71] }, { minFlat: 1000, region: REGION })).toThrow(/already toned/);
  });

  it("the mask is the ring and its edge only", () => {
    const d = master([239, 56, 39], [159, 69, 37]);
    const { mask, flat } = nyxRimMask(d, W, H, [239, 56, 39], REGION);
    expect(flat).toBe(120 * 120 - 96 * 96); // the ring; not the speck
    expect(mask[10 * W + 10]).toBe(0);
    expect(mask[100 * W + 100]).toBe(0);
    expect(mask[100 * W + 52]).toBeGreaterThan(250); // a rim / black mix (rounding)
  });
});

describe("shiftTone (the crown bands)", () => {
  it("lands `from` on `to`, moves a darker bevel less, never black, and fades out toward white", () => {
    const from = [209, 77, 53] as const;
    const to = [220, 59, 22] as const;
    expect(shiftTone(...from, from, to)).toEqual([...to]);
    expect(shiftTone(0, 0, 0, from, to)).toEqual([0, 0, 0]);
    const dark = shiftTone(100, 37, 25, from, to);
    expect(dark[2]).toBeLessThan(25);
    expect(dark[2]).toBeGreaterThan(25 - 31);
    expect(shiftTone(255, 255, 255, from, to)).toEqual([255, 255, 255]);
    // It lifts a channel at 0 (blue's red), which a gain cannot.
    expect(shiftTone(0, 117, 190, [0, 117, 190], [10, 93, 193])).toEqual([10, 93, 193]);
  });
});

describe("the committed masters", () => {
  const rimAt = async (key: string) => {
    const { data } = await sharp(`public/frames/nyx/${key}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return [105, 1394].map((x) => [...data.subarray((700 * 1500 + x) * 4, (700 * 1500 + x) * 4 + 3)]);
  };
  it("carry the prints' rim on w u b r g, and MSE's on gold and colourless", async () => {
    for (const [key, tone] of Object.entries(NYX_RIM_TONES)) for (const px of await rimAt(key)) expect(px, key).toEqual([...tone.to]);
    for (const px of await rimAt("m")) expect(px).toEqual([246, 210, 98]);
    for (const px of await rimAt("c")) expect(px).toEqual([172, 148, 132]);
  });
});
