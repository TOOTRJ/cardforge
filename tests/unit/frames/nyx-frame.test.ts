import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { NYX_RIM_REGION, NYX_RIM_TONES, nyxRimMask, toneNyxRim } from "@/scripts/lib/nyx-frame.mjs";
import { bucketMaster, haveBucketMasters } from "../../stubs/bucket-masters";

// ---------------------------------------------------------------------------
// The Nyx Constellation frame's rim on its prints (owner Rounds 59 / 61;
// scripts/lib/nyx-frame.mjs, applied by scripts/build-variation-frames.mjs
// after the type bar / text box tone): the M15 family's tones, which the
// print wears once its scan is registered against the same card's regular
// printing. The published masters (Card Conjurer's 'Nyx Showcase' since
// TODO 4.17f, the importer's recipe step; MSE's in git before) carry them;
// blue's is the pack's own; gold takes the gold crown's arm; colourless —
// the pack's silver artifact rim — takes MSE's bronze, the tone the `a`
// crown band was tinted to. The crown bands are not tinted for it.
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

describe("the rim tones (the family's)", () => {
  it("are the M15 family's rims — the verified m15nyx masters' — for w b r g, none for blue (MSE's is the family's), the gold crown's arm for gold, MSE's bronze for colourless", () => {
    expect(Object.keys(NYX_RIM_TONES).sort()).toEqual(["b", "c", "g", "m", "r", "w"]);
    expect(NYX_RIM_TONES.c).toEqual({ from: [246, 247, 245], to: [172, 148, 132] });
    expect(NYX_RIM_TONES.w).toEqual({ from: [252, 254, 255], to: [244, 243, 236] });
    expect(NYX_RIM_TONES.b).toEqual({ from: [39, 38, 36], to: [58, 56, 50] });
    expect(NYX_RIM_TONES.r).toEqual({ from: [239, 56, 39], to: [209, 77, 53] });
    expect(NYX_RIM_TONES.g).toEqual({ from: [0, 123, 67], to: [42, 108, 69] });
    expect(NYX_RIM_TONES.m).toEqual({ from: [246, 210, 98], to: [233, 212, 125] });
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

describe.skipIf(!haveBucketMasters(["w", "u", "b", "r", "g", "m", "c"].map((key) => `nyx/${key}.png`)))("the published masters", () => {
  const rimAt = async (key: string) => {
    const { data } = await sharp(bucketMaster(`nyx/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return [105, 1394].map((x) => [...data.subarray((700 * 1500 + x) * 4, (700 * 1500 + x) * 4 + 3)]);
  };
  it("carry the family's rim on w b r g, the pack's (the family's) on blue, the gold crown's on gold, MSE's bronze on colourless", async () => {
    for (const [key, tone] of Object.entries(NYX_RIM_TONES)) for (const px of await rimAt(key)) expect(px, key).toEqual([...tone.to]);
    for (const px of await rimAt("u")) expect(px).toEqual([0, 117, 190]);
    for (const px of await rimAt("c")) expect(px).toEqual([172, 148, 132]);
  });

  it("match the frame's crown bands, which are not tinted for it (only the colourless `a` is, Round 59)", () => {
    const provenance = JSON.parse(readFileSync("lib/cards/frame-sources.json", "utf8")).nyxcrown;
    expect(Object.keys(provenance.recipe.tint ?? {})).toEqual(["a"]);
    // Each band's arm is its parent's (the family crown's) — the tone the rim now takes.
    const files = (manifestJson as { files: Record<string, { sha256: string }> }).files;
    for (const k of ["w", "u", "b", "r", "g", "m", "a"]) expect(files[`nyxcrown/${k}.png`], k).toBeDefined();
  });
});
