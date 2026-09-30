import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { NYX_TEXT_BOX_ALPHA, toneNyxTextBox } from "@/scripts/lib/nyx-text-box.mjs";

// ---------------------------------------------------------------------------
// The nyx text box's darkness (TODO 4.17e, layout v36): MSE's Theros
// constellation masters paint it flat black at 50 %, which since v35 (the art
// under the whole box) let half the art through, where the THB constellation
// prints (#258 / #259 / #268) let about a third through — their box reads L
// 32–33 over art of L 82–114. The masters' box is α 171 now, the same black;
// the type bar keeps MSE's 50 %; scripts/build-variation-frames.mjs rebuilds
// them that way (the pixels are its output, byte for byte).
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;

async function master(key: string) {
  const { data, info } = await sharp(readFileSync(join(process.cwd(), "public/frames/nyx", `${key}.png`)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
  };
  return { data, info, at };
}

describe("nyx's text box (4.17e)", () => {
  it("lets a third of the art through, in black, on every colour; the type bar keeps MSE's 50 %", async () => {
    expect(NYX_TEXT_BOX_ALPHA).toBe(171);
    for (const key of KEYS) {
      const { info, at } = await master(key);
      expect([info.width, info.height], key).toEqual([1500, 2100]);
      // The box's interior (1325–1938 × 116–1384 px on the master).
      for (const y of [1350, 1500, 1700, 1900]) {
        for (const x of [200, 750, 1300]) expect(at(x, y), `${key} ${x},${y}`).toEqual([0, 0, 0, 171]);
      }
      // The type bar: MSE's 127.5 / 255 black.
      for (const x of [200, 750, 1200]) expect(at(x, 1250)[3], `${key} bar ${x}`).toBeGreaterThanOrEqual(127);
      for (const x of [200, 750, 1200]) expect(at(x, 1250)[3], `${key} bar ${x}`).toBeLessThanOrEqual(128);
      // The art window stays see-through.
      expect(at(750, 600)[3], `${key} window`).toBe(0);
    }
  });

  it("darkens MSE's box and its frame-edge pixels, and refuses a master it already toned", () => {
    const W = 80;
    const H = 1400;
    const data = new Uint8Array(W * H * 4);
    for (let y = 1320; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        data[i + 3] = x % 2 ? 127 : 128; // MSE's 127.5 quantised both ways
      }
    }
    // An anti-aliased edge pixel of the white frame over the box: 40 % frame.
    const edge = (1330 * W + 5) * 4;
    const c = 0.4;
    const a = c + (1 - c) * (127.5 / 255);
    data[edge] = data[edge + 1] = data[edge + 2] = Math.round((c * 255) / a);
    data[edge + 3] = Math.round(a * 255);
    // The type bar above the box (y < 1310) is left alone.
    for (let x = 0; x < W; x += 1) data[(1300 * W + x) * 4 + 3] = 128;
    const big = new Uint8Array(W * 3000 * 4);
    // (Too few box pixels in a short strip for the guard: pad it.)
    big.set(data);
    for (let y = H; y < 3000; y += 1) for (let x = 0; x < W; x += 1) big[(y * W + x) * 4 + 3] = 128;
    const changed = toneNyxTextBox(big, W, 3000);
    expect(changed).toBeGreaterThan(0);
    expect(big[(1350 * W + 4) * 4 + 3]).toBe(171);
    expect(big[(1350 * W + 3) * 4 + 3]).toBe(170); // 127 × 171 / 127.5
    expect(big[(1300 * W + 3) * 4 + 3]).toBe(128);
    // The edge pixel keeps its 40 % of white over the darker box.
    const a2 = c + (1 - c) * (171 / 255);
    expect(big[edge + 3]).toBe(Math.round(a2 * 255));
    expect(Math.abs(big[edge] - (c * 255) / a2)).toBeLessThanOrEqual(1);
    expect(() => toneNyxTextBox(big, W, 3000)).toThrow(/already toned/);
  });
});
