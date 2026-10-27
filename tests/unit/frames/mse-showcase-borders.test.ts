import { describe, expect, it } from "vitest";
import {
  BORDER_BLACK,
  GHOSTFIRE_WINDOW,
  MSE_SHOWCASE_BORDERS,
  PALETTE_PNG_OPTIONS,
  borderLost,
  cutAtCardCorner,
  edgeCoverage,
  paintUnder,
  ringCoverage,
} from "@/scripts/lib/mse-showcase-borders.mjs";

// ---------------------------------------------------------------------------
// TODO 4.11 / 4.35 (layout v68): the border MSE paints at render time,
// painted under the Tarkir: Dragonstorm showcase masters by
// scripts/build-showcase-frames.mjs. The masters themselves are held by the
// edge contract (tests/unit/frames/edge-contract.test.ts) and the art-window
// check (tests/unit/render/art-window-coverage.test.ts); this file holds the
// geometry and the compositing rules.
// ---------------------------------------------------------------------------

const W = 1500;
const H = 2100;
const at = (cov: Float32Array, x: number, y: number) => cov[y * W + x];

describe("the Tarkir: Dragonstorm borders as data", () => {
  it("paints the two frames in the border black, the draconic's band from its edges, the ghostfire's ring round MSE's window", () => {
    expect([...BORDER_BLACK]).toEqual([0, 0, 0]);
    expect(Object.keys(MSE_SHOWCASE_BORDERS).sort()).toEqual(["tarkirdraconic", "tarkirghostfire"]);
    expect(MSE_SHOWCASE_BORDERS.tarkirdraconic.kind).toBe("edge");
    expect(MSE_SHOWCASE_BORDERS.tarkirghostfire).toMatchObject({ kind: "ring", window: GHOSTFIRE_WINDOW });
    // MSE's border_mask.png window (x 38–705.99 of 744, y 39–931.99 of
    // 1039) at 1500 × 2100; print's ring is 78–80 px (TDM #399–408).
    expect(Math.round((38 / 744) * 1500)).toBe(GHOSTFIRE_WINDOW.left);
    expect(Math.round((39 / 1039) * 2100)).toBe(GHOSTFIRE_WINDOW.top);
    expect(Math.round((706 / 744) * 1500)).toBe(GHOSTFIRE_WINDOW.right);
    expect(Math.round((932 / 1039) * 2100)).toBe(GHOSTFIRE_WINDOW.bottom);
    // No dithering in the palette encode (a dithered palette turned a few
    // opaque near-black border pixels into α 231–240).
    expect(PALETTE_PNG_OPTIONS).toMatchObject({ dither: 0 });
  });

  it("the ring is 1 outside the window, 0 inside, anti-aliased on its edge, with round top corners and chamfered bottom ones", () => {
    const cov = ringCoverage(GHOSTFIRE_WINDOW, W, H);
    expect(at(cov, 10, 1000)).toBe(1);
    expect(at(cov, 750, 40)).toBe(1);
    expect(at(cov, 750, 2000)).toBe(1); // the footer
    expect(at(cov, 750, 1000)).toBe(0);
    expect(at(cov, 100, 1000)).toBe(0);
    // The straight edges sit on whole px: x 77–1423, y 79–1884.
    expect(at(cov, 76, 1000)).toBe(1);
    expect(at(cov, 77, 1000)).toBe(0);
    expect(at(cov, 1422, 1000)).toBe(0);
    expect(at(cov, 1423, 1000)).toBe(1);
    expect(at(cov, 750, 78)).toBe(1);
    expect(at(cov, 750, 79)).toBe(0);
    // The round top corner IS anti-aliased: some pixel on its arc is part-covered.
    const arc = [...Array(22).keys()].map((i) => at(cov, 77 + i, 79 + 22 - Math.round(Math.sqrt(22 * 22 - (22 - i) ** 2))));
    expect(arc.some((v) => v > 0 && v < 1)).toBe(true);
    // The top corner's round: the window's own corner pixel is ring.
    expect(at(cov, 78, 80)).toBe(1);
    expect(at(cov, 77 + 22, 80)).toBe(0);
    // The bottom corners' 45° chamfer: black in the corner, clear past it.
    expect(at(cov, 80, 1880)).toBe(1);
    expect(at(cov, 1420, 1880)).toBe(1);
    expect(at(cov, 200, 1880)).toBe(0);
  });

  it("the edge band floods only what is joined to the card's outline, and refuses to reach the art", () => {
    const rgba = new Uint8Array(W * H * 4).fill(255);
    // A see-through band at the bottom, and a see-through window inside an
    // opaque frame.
    for (let y = 1950; y < H; y += 1) for (let x = 0; x < W; x += 1) rgba[(y * W + x) * 4 + 3] = 0;
    for (let y = 300; y < 1100; y += 1) for (let x = 100; x < 1400; x += 1) rgba[(y * W + x) * 4 + 3] = 0;
    const cov = edgeCoverage(rgba, W, H, [[0.5, 0.28]]);
    expect(at(cov, 750, 2050)).toBe(1);
    expect(at(cov, 750, 600)).toBe(0);
    expect(at(cov, 750, 1500)).toBe(0); // opaque drawing
    // Join the window to the band: the flood would blacken the art.
    for (let y = 1100; y < 1950; y += 1) rgba[(y * W + 750) * 4 + 3] = 0;
    expect(() => edgeCoverage(rgba, W, H, [[0.5, 0.28]])).toThrow(/reaches the art seed/);
  });

  it("paints UNDER the drawing (never over a pixel it paints), cut at the one card corner", () => {
    const rgba = new Uint8Array(4 * 4);
    // An opaque red pixel, a see-through one, a half-transparent white one.
    rgba.set([200, 0, 0, 255], 0);
    rgba.set([0, 0, 0, 0], 4);
    rgba.set([255, 255, 255, 128], 8);
    rgba.set([10, 20, 30, 0], 12);
    paintUnder(rgba, new Float32Array([1, 1, 1, 0]), [0, 0, 0]);
    expect([...rgba.subarray(0, 4)]).toEqual([200, 0, 0, 255]);
    expect([...rgba.subarray(4, 8)]).toEqual([0, 0, 0, 255]);
    expect([...rgba.subarray(8, 12)]).toEqual([128, 128, 128, 255]);
    expect([...rgba.subarray(12, 16)]).toEqual([10, 20, 30, 0]);
    // The corner: the painted layer is cut at the arc (its outermost pixel
    // clear), whole a little inside.
    const cut = cutAtCardCorner(new Float32Array(W * H).fill(1), W, H);
    expect(at(cut, 0, 0)).toBe(0);
    expect(at(cut, W - 1, H - 1)).toBe(0);
    expect(at(cut, 64, 64)).toBe(1);
    expect(at(cut, 750, 0)).toBe(1);
  });

  it("borderLost counts only the painted border's pixels the encode left short of opaque", () => {
    const cov = new Float32Array([1, 1, 0.5, 0]);
    const after = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 240, 0, 0, 0, 100, 0, 0, 0, 0]);
    expect(borderLost(cov, after)).toBe(1);
  });
});
