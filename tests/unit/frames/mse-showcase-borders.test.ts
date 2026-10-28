import { describe, expect, it } from "vitest";
import {
  ANIME_FOOTER_RGB,
  ANIME_NAMEBOX,
  ANIME_RIM,
  ANIME_STROKE_RGB,
  ANIME_TEXTBOX,
  BORDER_BLACK,
  BORDERED_PNG_ATTEMPTS,
  GHOSTFIRE_WINDOW,
  MSE_SHOWCASE_BORDERS,
  PALETTE_PNG_OPTIONS,
  borderLost,
  copperRimLayer,
  cutAtCardCorner,
  edgeCoverage,
  maskCoverage,
  outsideCoverage,
  paintOver,
  paintUnder,
  ringCoverage,
  showcaseBorderRgb,
  WOODLAND_FOOTER_RGB,
} from "@/scripts/lib/mse-showcase-borders.mjs";

// ---------------------------------------------------------------------------
// TODO 4.11 / 4.35 (layout v68): the border MSE paints at render time,
// painted under the Tarkir: Dragonstorm showcase masters by
// scripts/build-showcase-frames.mjs — and (layout v69) the Avatar
// elemental's black footer and the Bloomburrow woodland's coloured one. The masters themselves are held by the
// edge contract (tests/unit/frames/edge-contract.test.ts) and the art-window
// check (tests/unit/render/art-window-coverage.test.ts); this file holds the
// geometry and the compositing rules.
// ---------------------------------------------------------------------------

const W = 1500;
const H = 2100;
const at = (cov: Float32Array, x: number, y: number) => cov[y * W + x];

describe("the MSE showcase borders as data", () => {
  it("paints the Tarkir: Dragonstorm frames in the border black, the draconic's band from its edges, the ghostfire's ring round MSE's window", () => {
    expect([...BORDER_BLACK]).toEqual([0, 0, 0]);
    expect(Object.keys(MSE_SHOWCASE_BORDERS).sort()).toEqual(["avatar", "bloomanime", "bloomburrow", "tarkirdraconic", "tarkirghostfire"]);
    expect(MSE_SHOWCASE_BORDERS.tarkirdraconic.kind).toBe("edge");
    expect(MSE_SHOWCASE_BORDERS.tarkirghostfire).toMatchObject({ kind: "ring", window: GHOSTFIRE_WINDOW });
    // Print's ring on whole px (TDM #399–408, the inner edge's median: 78.3
    // / 80.2 / 80.0 from the left, right and top edges) — MSE's scaled mask
    // (76.6 / 76.6 / 78.8) drew it 1–3 px narrow — and MSE's footer (its
    // border_mask.png's y 931.99 of 1039, under the ribbon).
    expect([GHOSTFIRE_WINDOW.left, W - GHOSTFIRE_WINDOW.right, GHOSTFIRE_WINDOW.top]).toEqual([78, 80, 80]);
    expect(Math.round((932 / 1039) * 2100)).toBe(GHOSTFIRE_WINDOW.bottom);
    // No dithering in the palette encode (a dithered palette turned a few
    // opaque near-black border pixels into α 231–240).
    expect(PALETTE_PNG_OPTIONS).toMatchObject({ dither: 0 });
    // …and when even that loses a border pixel (bloomburrow's r / g / u / m:
    // the leafy band's many colours), a finer palette, then truecolor.
    expect(BORDERED_PNG_ATTEMPTS[0]).toBe(PALETTE_PNG_OPTIONS);
    expect(BORDERED_PNG_ATTEMPTS.at(-1)).toMatchObject({ palette: false });
    for (const o of BORDERED_PNG_ATTEMPTS.slice(1, -1)) expect(o).toMatchObject({ dither: 0 });
  });

  it("paints the Avatar elemental's footer true black and the Bloomburrow woodland's in each colour's own tone", () => {
    expect(MSE_SHOWCASE_BORDERS.avatar).toMatchObject({ kind: "outside" });
    expect(MSE_SHOWCASE_BORDERS.bloomburrow).toMatchObject({ kind: "outside", keepCorners: true });
    for (const k of ["w", "u", "b", "r", "g", "c", "m"]) expect([...showcaseBorderRgb("avatar", k)!], k).toEqual([0, 0, 0]);
    // The raw scan medians of BLB #295–336's footers. Black is the footer's
    // own 19,12,13 (#309 / #311 / #312 / #314; the same scans read 0,0,0 on
    // BLB's black-bordered cards), never the border black; `c` has no print
    // and keeps MSE's own brown.
    expect(Object.keys(WOODLAND_FOOTER_RGB).sort()).toEqual(["b", "c", "g", "m", "r", "u", "w"]);
    expect([...showcaseBorderRgb("bloomburrow", "b")!]).toEqual([19, 12, 13]);
    expect([...showcaseBorderRgb("bloomburrow", "g")!]).toEqual([18, 66, 7]);
    expect(() => showcaseBorderRgb("bloomburrow", "x")).toThrow(/no border colour/);
    expect(showcaseBorderRgb("m15", "w")).toBeNull();
  });

  it("draws the Bloomburrow anime with print's numbers: one flat stroke tone, the slate boxes at their opacity, the footer's own tone", () => {
    // Raw medians of the 13 registered scans (TODO 4.11 / 4.35, layout v70).
    expect([...ANIME_STROKE_RGB]).toEqual([35, 31, 12]);
    expect(ANIME_NAMEBOX).toMatchObject({ alpha: 0.78, rgb: [45, 50, 52] });
    expect(ANIME_TEXTBOX).toMatchObject({ alpha: 0.8, rgb: [39, 40, 35] });
    expect([...ANIME_FOOTER_RGB]).toEqual([15, 20, 16]);
    expect(MSE_SHOWCASE_BORDERS.bloomanime).toMatchObject({ kind: "mask", keepCorners: true });
    for (const k of ["w", "u", "b", "r", "g", "c", "m"]) expect(showcaseBorderRgb("bloomanime", k), k).toBe(ANIME_FOOTER_RGB);
  });

  it("draws the anime's copper rim on the strokes' UPPER edges only: one ring in, one out and a half one past it", () => {
    expect(ANIME_RIM).toMatchObject({ rgb: [180, 103, 59], inside: 1, outside: 1, outsideHalf: 1, fullWithinDeg: 30, zeroAtDeg: 50 });
    // A wide bar: rows 100–139, columns 100–399.
    const w = 500;
    const h = 240;
    const alpha = new Uint8Array(w * h);
    for (let y = 100; y < 140; y += 1) for (let x = 100; x < 400; x += 1) alpha[y * w + x] = 255;
    const rim = copperRimLayer(alpha, w, h);
    const a = (x: number, y: number) => rim[(y * w + x) * 4 + 3];
    // The top edge, mid-bar: the edge row inside, the row above it, then half.
    expect(a(250, 100)).toBe(255);
    expect([...rim.subarray((100 * w + 250) * 4, (100 * w + 250) * 4 + 3)]).toEqual([180, 103, 59]);
    expect(a(250, 99)).toBe(255);
    expect(a(250, 98)).toBe(128);
    expect(a(250, 97)).toBe(0);
    expect(a(250, 101)).toBe(0); // the core stays the stroke's
    // The bottom edge and the sides: no rim.
    expect(a(250, 139)).toBe(0);
    expect(a(250, 140)).toBe(0);
    expect(a(100, 120)).toBe(0);
    expect(a(399, 120)).toBe(0);
  });

  it("paints OVER (the anime's footer above its boxes) and reads a mask as coverage, cut at the corner unless kept", () => {
    const rgba = new Uint8Array([39, 40, 35, 204, 0, 0, 0, 0, 200, 0, 0, 255]);
    paintOver(rgba, new Float32Array([1, 0.5, 0]), [15, 20, 16]);
    expect([...rgba.subarray(0, 4)]).toEqual([15, 20, 16, 255]);
    expect([...rgba.subarray(4, 8)]).toEqual([15, 20, 16, 128]);
    expect([...rgba.subarray(8, 12)]).toEqual([200, 0, 0, 255]);
    const grey = new Uint8Array(W * H).fill(255);
    expect(at(maskCoverage(grey, W, H, true), 0, 0)).toBe(1);
    expect(at(maskCoverage(grey, W, H), 0, 0)).toBe(0);
    expect(at(maskCoverage(grey, W, H), 750, 1000)).toBe(1);
  });

  it("the outside band is every see-through pixel not in the art's window — the window flooded from the art seeds", () => {
    const rgba = new Uint8Array(W * H * 4).fill(255);
    // A see-through window (the art), a see-through footer, and a
    // translucent rim pixel outside both.
    for (let y = 100; y < 1100; y += 1) for (let x = 0; x < W; x += 1) rgba[(y * W + x) * 4 + 3] = 0;
    for (let y = 1950; y < H; y += 1) for (let x = 0; x < W; x += 1) rgba[(y * W + x) * 4 + 3] = 0;
    rgba[(1500 * W + 5) * 4 + 3] = 200;
    const cov = outsideCoverage(rgba, W, H, [[0.5, 0.25]]);
    expect(at(cov, 750, 600)).toBe(0); // the art window
    expect(at(cov, 750, 2050)).toBe(1); // the footer
    expect(at(cov, 5, 1500)).toBe(1); // the translucent rim pixel
    expect(at(cov, 750, 1500)).toBe(0); // the opaque drawing
  });

  it("the ring is 1 outside the window, 0 inside, anti-aliased on its edge, with round top corners and chamfered bottom ones", () => {
    const cov = ringCoverage(GHOSTFIRE_WINDOW, W, H);
    expect(at(cov, 10, 1000)).toBe(1);
    expect(at(cov, 750, 40)).toBe(1);
    expect(at(cov, 750, 2000)).toBe(1); // the footer
    expect(at(cov, 750, 1000)).toBe(0);
    expect(at(cov, 100, 1000)).toBe(0);
    // The straight edges sit on whole px: x 78–1420, y 80–1884.
    expect(at(cov, 77, 1000)).toBe(1);
    expect(at(cov, 78, 1000)).toBe(0);
    expect(at(cov, 1419, 1000)).toBe(0);
    expect(at(cov, 1420, 1000)).toBe(1);
    expect(at(cov, 750, 79)).toBe(1);
    expect(at(cov, 750, 80)).toBe(0);
    // The round top corner IS anti-aliased: some pixel on its arc is part-covered.
    const arc = [...Array(22).keys()].map((i) => at(cov, 78 + i, 80 + 22 - Math.round(Math.sqrt(22 * 22 - (22 - i) ** 2))));
    expect(arc.some((v) => v > 0 && v < 1)).toBe(true);
    // The top corner's round: the window's own corner pixel is ring.
    expect(at(cov, 79, 81)).toBe(1);
    expect(at(cov, 78 + 22, 81)).toBe(0);
    // The bottom corners' 45° chamfer: black in the corner, clear past it.
    expect(at(cov, 80, 1880)).toBe(1);
    expect(at(cov, 1420, 1880)).toBe(1);
    expect(at(cov, 200, 1880)).toBe(0);
    // A full-card supersampled raster: ~2–5 s alone, past vitest's 5 s
    // default on a loaded CI shard (main's runs 40767783868 / 40770054143).
  }, 30_000);

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
