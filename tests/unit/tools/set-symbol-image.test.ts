import { describe, expect, it } from "vitest";
import {
  autoCutoutMode,
  borderColours,
  coverageShare,
  cutOut,
  maskBounds,
  type RgbaImage,
} from "@/lib/tools/set-symbol/cutout";
import {
  fitSquare,
  legibilityScore,
  paintSymbol,
  SYMBOL_MARGIN,
} from "@/lib/tools/set-symbol/paint";

// Synthetic pictures: a W × H canvas filled by `bg(x, y)`, with `ink(x, y)`
// painted where `inside(x, y)`.
type Rgb = [number, number, number];
function picture(
  w: number,
  h: number,
  bg: (x: number, y: number) => Rgb,
  inside: (x: number, y: number) => boolean,
  ink: Rgb = [10, 10, 10],
  alpha: (x: number, y: number) => number = () => 255,
): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const c = inside(x, y) ? ink : bg(x, y);
      const i = (y * w + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = alpha(x, y);
    }
  }
  return { width: w, height: h, data };
}

const white = (): Rgb => [255, 255, 255];
/** A ring: a disc of radius 30 with a hole of radius 12, centred (60, 60). */
const ring = (x: number, y: number) => {
  const d = Math.hypot(x - 60, y - 60);
  return d <= 30 && d > 12;
};
const at = (img: { width: number; data: ArrayLike<number> }, x: number, y: number, stride = 1) =>
  img.data[(y * img.width + x) * stride + (stride === 4 ? 3 : 0)];

describe("cutOut", () => {
  it("auto picks the edge fill for a flat white background and keys it away", () => {
    const img = picture(120, 120, white, ring);
    expect(autoCutoutMode(img)).toBe("edges");
    const { mask, mode } = cutOut(img, { mode: "auto", tolerance: 35 });
    expect(mode).toBe("edges");
    expect(at(mask, 60 + 20, 60)).toBe(255); // on the ring
    expect(at(mask, 2, 2)).toBe(0); // the background
    // The edge fill keeps a background colour trapped INSIDE the shape.
    expect(at(mask, 60, 60)).toBe(255);
  });

  it("the colour key removes the background everywhere, holes included", () => {
    const img = picture(120, 120, white, ring);
    const { mask } = cutOut(img, { mode: "colour", tolerance: 35 });
    expect(at(mask, 80, 60)).toBe(255);
    expect(at(mask, 60, 60)).toBe(0);
  });

  it("finds both colours of a checkerboard baked into a PNG", () => {
    const checker = (x: number, y: number): Rgb => ((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? [204, 204, 204] : [255, 255, 255]);
    const img = picture(120, 120, checker, ring, [180, 30, 30]);
    expect(borderColours(img)).toHaveLength(2);
    expect(autoCutoutMode(img)).toBe("drawing"); // light, uneven border
    const { mask } = cutOut(img, { mode: "colour", tolerance: 35 });
    expect(at(mask, 80, 60)).toBe(255);
    expect(at(mask, 5, 5)).toBe(0);
    expect(at(mask, 12, 4)).toBe(0);
  });

  it("the drawing mode reads ink against uneven paper and drops what touches the edge", () => {
    // Paper lit from the top-left (255 → 175), a dark smudge on the left edge.
    const paper = (x: number, y: number): Rgb => {
      const l = 255 - (x + y) * (80 / 240);
      return [l, l, l - 8];
    };
    const smudge = (x: number, y: number) => x < 6 && y > 40 && y < 80;
    const img = picture(120, 120, paper, (x, y) => ring(x, y) || smudge(x, y), [40, 40, 40]);
    const { mask } = cutOut(img, { mode: "drawing", tolerance: 35 });
    expect(at(mask, 80, 60)).toBe(255);
    expect(at(mask, 110, 110)).toBe(0); // darkest paper is still paper
    expect(at(mask, 2, 60)).toBe(0); // the edge smudge is gone
    expect(at(mask, 60, 60)).toBe(0); // the paper inside the ring
  });

  it("keeps the file's own transparency", () => {
    const img = picture(120, 120, white, ring, [10, 10, 10], (x, y) => (ring(x, y) ? 255 : 0));
    expect(autoCutoutMode(img)).toBe("alpha");
    const { mask } = cutOut(img, { mode: "auto", tolerance: 35 });
    expect(at(mask, 80, 60)).toBe(255);
    expect(at(mask, 60, 60)).toBe(0);
  });

  it("drops specks and leaves the shape", () => {
    const specks = (x: number, y: number) => ring(x, y) || (x === 105 && y === 10) || (x === 10 && y === 108);
    const img = picture(120, 120, white, specks);
    const { mask } = cutOut(img, { mode: "edges", tolerance: 35 });
    expect(at(mask, 105, 10)).toBe(0);
    expect(at(mask, 10, 108)).toBe(0);
    expect(maskBounds(mask)).toEqual({ x: 30, y: 30, width: 61, height: 61 });
  });

  it("higher tolerance removes more of a faint grey", () => {
    const faint = (x: number, y: number) => x >= 20 && x < 100 && y >= 40 && y < 80;
    const img = picture(120, 120, white, faint, [205, 205, 205]);
    const low = cutOut(img, { mode: "colour", tolerance: 0 });
    const high = cutOut(img, { mode: "colour", tolerance: 100 });
    expect(coverageShare(low.mask)).toBeGreaterThan(0.2);
    expect(coverageShare(high.mask)).toBe(0);
  });
});

describe("fitSquare + paintSymbol", () => {
  const img = picture(160, 100, white, (x, y) => x >= 20 && x < 140 && y >= 40 && y < 70);
  const { mask } = cutOut(img, { mode: "edges", tolerance: 35 });

  it("centres the shape in a square with the margin", () => {
    const fitted = fitSquare(img, mask, 200)!;
    expect(fitted.width).toBe(200);
    const bounds = maskBounds({ width: 200, height: 200, data: Uint8Array.from({ length: 200 * 200 }, (_, p) => fitted.data[p * 4 + 3]) })!;
    const margin = Math.round(200 * SYMBOL_MARGIN);
    expect(Math.abs(bounds.x - margin)).toBeLessThanOrEqual(1);
    expect(Math.abs(bounds.x + bounds.width - (200 - margin))).toBeLessThanOrEqual(1);
    // A wide bar sits on the middle row.
    expect(Math.abs(bounds.y + bounds.height / 2 - 100)).toBeLessThanOrEqual(1);
  });

  it("returns null for an empty cut-out", () => {
    const blank = picture(40, 40, white, () => false);
    expect(fitSquare(blank, cutOut(blank, { mode: "edges", tolerance: 35 }).mask, 64)).toBeNull();
  });

  it("paints each rarity with its keyline outside the shape", () => {
    const fitted = fitSquare(img, mask, 200)!;
    const centre = (100 * 200 + 100) * 4;
    // Just outside the bar's top edge: keyline only.
    const topEdge = (() => {
      for (let y = 0; y < 100; y += 1) if (fitted.data[(y * 200 + 100) * 4 + 3] >= 128) return y;
      return -1;
    })();
    const keylinePx = ((topEdge - 3) * 200 + 100) * 4;

    const common = paintSymbol(fitted, "common");
    expect(Array.from(common.data.slice(centre, centre + 3))).toEqual([15, 15, 18]);
    expect(common.data[keylinePx + 3]).toBe(255);
    expect(Array.from(common.data.slice(keylinePx, keylinePx + 3))).toEqual([230, 224, 209]);

    for (const look of ["uncommon", "rare", "mythic"] as const) {
      const painted = paintSymbol(fitted, look);
      expect(Array.from(painted.data.slice(keylinePx, keylinePx + 3))).toEqual([15, 15, 18]);
      expect(painted.data[centre + 3]).toBe(255);
    }
    const rare = paintSymbol(fitted, "rare");
    // Gold: red > green > blue in the middle of the gradient.
    expect(rare.data[centre]).toBeGreaterThan(rare.data[centre + 1]);
    expect(rare.data[centre + 1]).toBeGreaterThan(rare.data[centre + 2]);
    // Far corner: nothing.
    expect(rare.data[3]).toBe(0);
  });

  it("the watermark is the shape alone in the watermark ink", () => {
    const fitted = fitSquare(img, mask, 200)!;
    const wm = paintSymbol(fitted, "watermark");
    const centre = (100 * 200 + 100) * 4;
    expect(Array.from(wm.data.slice(centre, centre + 4))).toEqual([0x3b, 0x31, 0x26, 255]);
    let covered = 0;
    let fittedCovered = 0;
    for (let p = 0; p < 200 * 200; p += 1) {
      if (wm.data[p * 4 + 3] >= 128) covered += 1;
      if (fitted.data[p * 4 + 3] >= 128) fittedCovered += 1;
    }
    expect(covered).toBe(fittedCovered); // no keyline
  });

  it("plain keeps the maker's colours only when asked", () => {
    const red = picture(100, 100, white, (x, y) => Math.hypot(x - 50, y - 50) < 30, [200, 20, 20]);
    const fitted = fitSquare(red, cutOut(red, { mode: "edges", tolerance: 35 }).mask, 100)!;
    const centre = (50 * 100 + 50) * 4;
    expect(paintSymbol(fitted, "plain", true).data[centre]).toBeGreaterThan(190);
    expect(paintSymbol(fitted, "plain", false).data[centre]).toBe(15);
  });
});

describe("legibilityScore", () => {
  it("is high for a bold shape and low for fine detail", () => {
    const bold = picture(128, 128, white, (x, y) => Math.hypot(x - 64, y - 64) < 50);
    const fine = picture(128, 128, white, (x, y) => x > 10 && x < 118 && y > 10 && y < 118 && x % 6 === 0);
    const score = (img: RgbaImage) => legibilityScore(fitSquare(img, cutOut(img, { mode: "edges", tolerance: 35 }).mask, 256)!);
    expect(score(bold)).toBeGreaterThan(0.9);
    expect(score(fine)).toBeLessThan(0.6);
  });
});
