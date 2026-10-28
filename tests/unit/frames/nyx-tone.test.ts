import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  NYX_CC_TEXT_BOX_ROWS,
  NYX_CC_TYPE_BAR_ROWS,
  NYX_TEXT_BOX_ALPHA,
  NYX_TYPE_BAR_ALPHA,
  NYX_TYPE_BAR_ROWS,
  toneNyxMaster,
} from "@/scripts/lib/nyx-tone.mjs";
import { bucketMaster, haveBucketMasters } from "../../stubs/bucket-masters";

// ---------------------------------------------------------------------------
// Nyx's type bar and text box (TODO 4.17e, layout v37): the constellation
// masters paint both flat black at 50 %, which since v35 (the art under the
// whole bar and box) let half the art through, where the THB constellation
// prints (#258 / #259 / #268) let 0.36–0.46 through the bar and 0.28–0.39
// (mean 0.33) through the box. The masters' black is α 150 on the bar and
// α 171 in the box. Since TODO 4.17f (layout v73) the masters are Card
// Conjurer's 'Nyx Showcase' in the frames bucket, toned by the importer's
// recipe step on the pack's rows (NYX_CC_*_ROWS); these read the published
// objects (FRAMES_BUILD_DIR at the manifest's sha256) and skip without them.
// ---------------------------------------------------------------------------

const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const HAVE = haveBucketMasters(KEYS.map((key) => `nyx/${key}.png`));

async function master(key: string) {
  const { data, info } = await sharp(bucketMaster(`nyx/${key}.png`)!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  /** Pixels of a black at `alpha` (±1) inside rows [top, bottom). */
  const count = (top: number, bottom: number, test: (a: number) => boolean) => {
    let n = 0;
    for (let y = top; y < bottom; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * 4;
        if (data[i] <= 16 && data[i + 1] <= 16 && data[i + 2] <= 16 && test(data[i + 3])) n += 1;
      }
    }
    return n;
  };
  return { data, info, at, count };
}

describe.skipIf(!HAVE)("nyx's type bar and text box on the published masters (4.17e, 4.17f)", () => {
  it("let the prints' share of the art through, in black, on every colour — none of the pack's 50 % is left", async () => {
    expect(NYX_TYPE_BAR_ALPHA).toBe(150);
    expect(NYX_TEXT_BOX_ALPHA).toBe(171);
    // The pack's rows: the bar's black 1193–1290, the box's 1315–1929.
    expect(NYX_CC_TYPE_BAR_ROWS).toEqual([1175, 1305]);
    expect(NYX_CC_TEXT_BOX_ROWS).toEqual([1305, 2100]);
    for (const key of KEYS) {
      const { info, at, count } = await master(key);
      expect([info.width, info.height], key).toEqual([1500, 2100]);
      // The box's interior (1321–1929 × 120–1380 px on the master).
      for (const y of [1340, 1500, 1700, 1920]) {
        for (const x of [200, 750, 1300]) expect(at(x, y), `${key} box ${x},${y}`).toEqual([0, 0, 0, 171]);
      }
      // The type bar's (1193–1290 × 104–1396 px).
      for (const y of [1200, 1240, 1285]) {
        for (const x of [200, 750, 1200]) expect(at(x, y), `${key} bar ${x},${y}`).toEqual([0, 0, 0, 150]);
      }
      // Every pixel of the pack's 50 % black changed (above the corner arcs,
      // whose cut leaves α 128 specks on the last rows).
      const half = (a: number) => a === 127 || a === 128;
      expect(count(NYX_CC_TYPE_BAR_ROWS[0], NYX_CC_TYPE_BAR_ROWS[1], half), `${key} bar at 50 %`).toBe(0);
      expect(count(NYX_CC_TEXT_BOX_ROWS[0], 1950, half), `${key} box at 50 %`).toBe(0);
      expect(count(NYX_CC_TYPE_BAR_ROWS[0], NYX_CC_TYPE_BAR_ROWS[1], (a) => a === 150), key).toBeGreaterThanOrEqual(122_000);
      expect(count(NYX_CC_TEXT_BOX_ROWS[0], NYX_CC_TEXT_BOX_ROWS[1], (a) => a === 171), key).toBeGreaterThanOrEqual(769_000);
      // The opaque rim between them and the art window are untouched.
      expect(at(750, 1308)[3], `${key} line`).toBe(255);
      expect(at(750, 600)[3], `${key} window`).toBe(0);
    }
  }, 60_000);

  it("refuses to tone a master twice", async () => {
    const { data, info } = await master("w");
    const copy = Buffer.from(data);
    expect(() => toneNyxMaster(copy, info.width, info.height, { barRows: NYX_CC_TYPE_BAR_ROWS, boxRows: NYX_CC_TEXT_BOX_ROWS })).toThrow(/already toned/);
    expect(copy.equals(data)).toBe(true);
  });
});

describe("toneNyxMaster", () => {
  // Wide enough for the guard's minimums (60,000 px of MSE's black on the
  // bar, 400,000 in the box).
  const W = 700;
  const H = 2100;
  /** A synthetic master: MSE's 50 % black (127 / 128, as quantised) on the
   *  bar's rows (1200–1294) and the box's (1328 on), the opaque white frame
   *  line between them (1305–1317), transparent elsewhere. */
  function mse() {
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const i = (y * W + x) * 4;
        if ((y >= 1200 && y < 1295) || y >= 1328) data[i + 3] = x % 2 ? 127 : 128;
        if (y >= 1305 && y < 1318) data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 255;
      }
    }
    return data;
  }
  const px = (data: Uint8Array, x: number, y: number) => {
    const i = (y * W + x) * 4;
    return Array.from(data.subarray(i, i + 4));
  };

  it("takes the bar to α 150 and the box to α 171, keeps a frame edge's colour and coverage, and nothing else moves", () => {
    const data = mse();
    // An anti-aliased edge pixel of the white frame over the bar's black: 40 % frame.
    const c = 0.4;
    const a = c + (1 - c) * (127.5 / 255);
    const edge = (1296 * W + 5) * 4;
    data[edge] = data[edge + 1] = data[edge + 2] = Math.round((c * 255) / a);
    data[edge + 3] = Math.round(a * 255);
    // A partial cover of the box's black (half of it), just above the box.
    const partial = (1327 * W + 7) * 4;
    data[partial + 3] = 64;
    const before = Uint8Array.from(data);

    const changed = toneNyxMaster(data, W, H);
    expect(changed.bar).toBe(95 * W + 1);
    expect(changed.box).toBe((H - 1328) * W + 1);
    for (const x of [3, 4]) {
      expect(px(data, x, 1250)).toEqual([0, 0, 0, 150]);
      expect(px(data, x, 1600)).toEqual([0, 0, 0, 171]);
    }
    // The edge keeps its 40 % of white over the darker black.
    const a2 = c + (1 - c) * (150 / 255);
    expect(data[edge + 3]).toBe(Math.round(a2 * 255));
    expect(Math.abs(data[edge] - (c * 255) / a2)).toBeLessThanOrEqual(1);
    // The partial cover scales with the box: 64 / 127.5 of 171.
    expect(data[partial + 3]).toBe(Math.round((64 / 127.5) * 171));
    // Rows above the bar's band and the opaque line are untouched.
    for (const [top, bottom] of [
      [0, NYX_TYPE_BAR_ROWS[0]],
      [1305, 1318],
    ]) {
      for (let y = top; y < bottom; y += 1) {
        for (const x of [0, 5, 350, W - 1]) expect(px(data, x, y), `${x},${y}`).toEqual(px(before, x, y));
      }
    }
    // Again: refused, and nothing changes.
    const toned = Uint8Array.from(data);
    expect(() => toneNyxMaster(data, W, H)).toThrow(/already toned/);
    expect(Buffer.from(data).equals(Buffer.from(toned))).toBe(true);
  });

  it("refuses a half-toned master whole (the box toned, the bar not)", () => {
    const data = mse();
    for (let y = 1328; y < H; y += 1) for (let x = 0; x < W; x += 1) data[(y * W + x) * 4 + 3] = 171;
    const before = Uint8Array.from(data);
    expect(() => toneNyxMaster(data, W, H)).toThrow(/text box found .* already toned/);
    expect(Buffer.from(data).equals(Buffer.from(before))).toBe(true);
  });
});
