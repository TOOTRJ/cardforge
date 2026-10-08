import { describe, expect, it } from "vitest";
import {
  blurPlane,
  clearWindowHalo,
  cutMaps,
  describeRegionTones,
  lumaPlane,
  medianIn,
  piecewiseMap,
  planeToBytes,
  recutPiecewise,
  recutPlane,
  rectPlane,
  regionGain,
  ringSidePlanes,
  squareCornersOnBlack,
  stretchRange,
  toneRegions,
} from "@/scripts/lib/print-cut.mjs";

// ---------------------------------------------------------------------------
// The two importer steps the 1997 frame needed (TODO 4.10a,
// scripts/lib/print-cut.mjs): the piecewise-linear re-cut — a drawing moved
// onto the prints EDGE BY EDGE, which neither a block move nor one scale per
// axis can do — and the region tone with an OFFSET (mean and contrast), where
// the tools before it could only multiply.
// ---------------------------------------------------------------------------

const W = 60;
const H = 40;
const rgba = (fill: (x: number, y: number) => [number, number, number, number]) => {
  const buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) buf.set(fill(x, y), (y * W + x) * 4);
  return buf;
};
const px = (buf: Buffer, x: number, y: number) => [...buf.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)];

describe("piecewiseMap — the inverse map of one axis", () => {
  it("puts every anchor's source under its target, linear between, slope 1 outside", () => {
    const map = piecewiseMap(
      [
        [10, 8],
        [20, 22],
        [30, 31],
      ],
      40,
    );
    expect(map[8]).toBeCloseTo(10, 12);
    expect(map[22]).toBeCloseTo(20, 12);
    expect(map[31]).toBeCloseTo(30, 12);
    // Half-way between two targets reads half-way between their sources.
    expect(map[15]).toBeCloseTo(15, 12);
    // Outside the outermost anchors the image is moved, never stretched.
    expect(map[0]).toBeCloseTo(2, 12);
    expect(map[4] - map[3]).toBeCloseTo(1, 12);
    expect(map[39] - map[38]).toBeCloseTo(1, 12);
    expect(map[39]).toBeCloseTo(38, 12);
  });

  it("takes the anchors in any order and names the local stretch", () => {
    const anchors: [number, number][] = [
      [30, 31],
      [10, 8],
      [20, 22],
    ];
    expect([...piecewiseMap(anchors, 40)]).toEqual([...piecewiseMap([...anchors].reverse(), 40)]);
    const { min, max } = stretchRange(anchors);
    expect(max).toBeCloseTo(1.4, 12);
    expect(min).toBeCloseTo(0.9, 12);
  });

  it("refuses anchors that cross (an edge may not overtake its neighbour) or fewer than two", () => {
    expect(() => piecewiseMap([[10, 8]], 40)).toThrow(/two anchors/);
    expect(() =>
      piecewiseMap(
        [
          [10, 8],
          [9, 22],
        ],
        40,
      ),
    ).toThrow(/keep their order/);
  });
});

describe("recutPiecewise — a drawing moved edge by edge", () => {
  // A white card with a black 2 px vertical line at x 20–21 and a clear
  // window on columns 40–49.
  const drawing = rgba((x) => (x >= 40 && x < 50 ? [0, 0, 0, 0] : x === 20 || x === 21 ? [0, 0, 0, 255] : [240, 240, 240, 255]));
  const identity = { y: [[0, 0], [H, H]] as [number, number][], xUpper: [[0, 0], [W, W]] as [number, number][] };

  it("is the identity on an identity cut", () => {
    expect(recutPiecewise(drawing, cutMaps(identity, W, H)).equals(drawing)).toBe(true);
  });

  it("lands each edge on its own target: the line 3 px left, the window's left edge 2 px right, its right edge where it was", () => {
    const cut = {
      y: identity.y,
      xUpper: [
        [5, 5],
        [21, 18], // the line's centre
        [40, 42], // the window's left edge
        [50, 50], // its right edge
        [55, 55],
      ] as [number, number][],
    };
    const out = recutPiecewise(drawing, cutMaps(cut, W, H));
    const darkest = Array.from({ length: W }, (_, x) => px(out, x, 10)[0]).indexOf(Math.min(...Array.from({ length: W }, (_, x) => px(out, x, 10)[0])));
    expect(Math.abs(darkest + 0.5 - 18)).toBeLessThanOrEqual(1);
    // The window: clear from 42 to 49, opaque either side.
    expect(px(out, 41, 10)[3]).toBeGreaterThan(200);
    expect(px(out, 43, 10)[3]).toBe(0);
    expect(px(out, 49, 10)[3]).toBe(0);
    expect(px(out, 50, 10)[3]).toBe(255);
    // Premultiplied: the frame beside the clear window keeps its colour (a
    // straight resample would mix the window's black into it).
    expect(px(out, 41, 10)[0]).toBeGreaterThan(225);
    // One scale for the axis could not do this: the two edges moved in
    // OPPOSITE directions.
  });

  it("gives the rows above and below a band their own column maps, lerped across it", () => {
    const cut = {
      y: identity.y,
      xUpper: [[0, 0], [21, 21], [W, W]] as [number, number][],
      xLower: [[0, 0], [21, 27], [W, W]] as [number, number][],
      lerpRows: [10, 20] as [number, number],
    };
    const out = recutPiecewise(drawing, cutMaps(cut, W, H));
    const lineAt = (y: number) => {
      const row = Array.from({ length: W }, (_, x) => px(out, x, y)[0]);
      const lo = Math.min(...row.slice(0, 38));
      const xs = row.slice(0, 38).flatMap((v, x) => (v < lo + 60 ? [x] : []));
      return xs.reduce((a, b) => a + b, 0) / xs.length + 0.5;
    };
    expect(lineAt(5)).toBeCloseTo(21, 0);
    expect(lineAt(30)).toBeCloseTo(27, 0);
    // Half-way down the band: half-way between the two maps.
    expect(Math.abs(lineAt(15) - 24)).toBeLessThanOrEqual(0.75);
  });

  it("moves a region's coverage with the same maps", () => {
    const cut = { y: identity.y, xUpper: [[0, 0], [20, 26], [W, W]] as [number, number][] };
    const plane = recutPlane(rectPlane([20, 0, 30, H], W, H), cutMaps(cut, W, H));
    const row = Array.from({ length: W }, (_, x) => plane[10 * W + x]);
    expect(row[24]).toBeLessThan(0.1);
    expect(row[27]).toBeGreaterThan(0.9);
    expect(Math.max(...row)).toBeLessThanOrEqual(1);
    expect(Math.min(...row)).toBeGreaterThanOrEqual(0);
    expect(planeToBytes(plane)[10 * W + 28]).toBe(255);
  });

  it("flattens a source's already-cut corners onto black, so the arc is not carried into the card", () => {
    const rounded = rgba((x, y) => (x < 4 && y < 4 ? [200, 180, 40, 0] : x < 6 && y < 6 ? [200, 180, 40, 128] : [16, 16, 16, 255]));
    const flat = squareCornersOnBlack(rounded, W, H, 8);
    expect(px(flat, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(flat, 5, 5)).toEqual([100, 90, 20, 255]);
    // Nothing outside the corner squares is touched.
    expect(px(flat, 30, 20)).toEqual([16, 16, 16, 255]);
    expect(px(rounded, 0, 0)[3]).toBe(0); // a new buffer
  });

  it("clears a JPEG source's white-window fade from the art ring: the ring's last px take the colour further out, alpha untouched", () => {
    // A 30 × 16 window at (15, 12) in a gold ring whose last 3 px fade to
    // white (the MSE gold), a half-covered edge pixel on its left edge and
    // one ragged opaque pixel inside its top row.
    const inWin = (x: number, y: number) => x >= 15 && x < 45 && y >= 12 && y < 28;
    const dist = (x: number, y: number) => Math.max(15 - x, x - 44, 12 - y, y - 27);
    const src = rgba((x, y) => {
      if (x === 30 && y === 12) return [250, 250, 250, 255];
      if (x === 15 && y === 20) return [240, 240, 240, 128];
      if (inWin(x, y)) return [0, 0, 0, 0];
      const d = dist(x, y);
      return d <= 3 ? [250 - d * 30, 250 - d * 30, 250 - d * 30, 255] : [120, 100, 20, 255];
    });
    const out = clearWindowHalo(src, W, H, { reach: 3, seedX: 30, seedY: 20 });
    // The faded px beside every edge, and both corners' squares, are the ring.
    for (const [x, y] of [[14, 20], [12, 20], [45, 20], [47, 20], [30, 11], [30, 9], [30, 28], [30, 30], [13, 10], [46, 29]]) {
      expect(px(out, x, y), `${x},${y}`).toEqual([120, 100, 20, 255]);
    }
    // The half-covered edge pixel and the ragged one keep their ALPHA and
    // lose the white.
    expect(px(out, 15, 20)).toEqual([120, 100, 20, 128]);
    expect(px(out, 30, 12)).toEqual([120, 100, 20, 255]);
    // The window is the same window; nothing further out is touched.
    for (let i = 0; i < W * H; i += 1) expect(out[i * 4 + 3]).toBe(src[i * 4 + 3]);
    expect(px(out, 10, 20)).toEqual(px(src, 10, 20));
    expect(px(src, 14, 20)).toEqual([220, 220, 220, 255]); // a new buffer
    // A seed that is not in a window is refused.
    expect(() => clearWindowHalo(src, W, H, { reach: 3, seedX: 2, seedY: 2 })).toThrow(/not inside a window/);
  });
});

describe("the drawing's regions", () => {
  it("splits a ring into four sides on its mitres", () => {
    const sides = ringSidePlanes([10, 10, 50, 30], [14, 14, 46, 26], W, H);
    const at = (name: "L" | "T" | "R" | "B", x: number, y: number) => sides[name][y * W + x];
    expect(at("L", 11, 20)).toBe(1);
    expect(at("T", 30, 11)).toBe(1);
    expect(at("R", 48, 20)).toBe(1);
    expect(at("B", 30, 28)).toBe(1);
    // Inside the inner box and outside the outer one: no side.
    for (const name of ["L", "T", "R", "B"] as const) {
      expect(at(name, 30, 20)).toBe(0);
      expect(at(name, 5, 5)).toBe(0);
    }
    // Every ring pixel belongs to exactly one side.
    let ring = 0;
    for (let p = 0; p < W * H; p += 1) ring += sides.L[p] + sides.T[p] + sides.R[p] + sides.B[p];
    expect(ring).toBe(40 * 20 - 32 * 12);
  });

  it("reads a blurred luma median (how a box with no drawn outline is cut by colour)", () => {
    const img = rgba((x) => (x < 30 ? [40, 80, 40, 255] : [200, 160, 120, 255]));
    const L = blurPlane(lumaPlane(img, W, H), W, H, 1.5);
    expect(medianIn(L, W, [0, 0, 20, H])).toBeCloseTo(0.2126 * 40 + 0.7152 * 80 + 0.0722 * 40, 3);
    expect(medianIn(L, W, [40, 0, W, H])).toBeCloseTo(0.2126 * 200 + 0.7152 * 160 + 0.0722 * 120, 3);
    // The step is soft after the blur.
    expect(L[10 * W + 29]).toBeGreaterThan(L[10 * W + 25]);
    expect(L[10 * W + 29]).toBeLessThan(L[10 * W + 33]);
  });
});

describe("toneRegions — mean AND contrast, where a gain can only multiply", () => {
  // A dark textured region (values 10 … 30 around a mean of 20) on the left
  // half, a bevel of flat 100 on the right.
  const img = rgba((x, y) => (x < 30 ? [10 + ((x + y) % 3) * 10, 10 + ((x + y) % 3) * 10, 10 + ((x + y) % 3) * 10, 255] : [100, 100, 100, 200]));
  const left = planeToBytes(rectPlane([0, 0, 30, H], W, H));
  const right = planeToBytes(rectPlane([30, 0, W, H], W, H));

  it("an affine region moves its mean onto the prints' and scales its texture by k — the grain does not double", () => {
    const out = toneRegions(img, W, H, { body: left, bevel: right }, {
      body: { from: [20, 20, 20], to: [30, 40, 26], k: 0.8 },
      bevel: { from: [100, 100, 100], to: [80, 90, 110] },
    });
    // in 10 / 20 / 30 → (in − 20) × 0.8 + to
    expect(px(out, 0, 0).slice(0, 3)).toEqual([22, 32, 18]);
    expect(px(out, 1, 0).slice(0, 3)).toEqual([30, 40, 26]);
    expect(px(out, 2, 0).slice(0, 3)).toEqual([38, 48, 34]);
    // The plain gain 30 / 20 = × 1.5 would have spread 10 … 30 to 15 … 45:
    // a texture half again as strong. The affine tone's spread is 16.
    const gainOnly = toneRegions(img, W, H, { body: left, bevel: right }, {
      body: { from: [20, 20, 20], to: [30, 30, 30] },
      bevel: { from: [100, 100, 100], to: [100, 100, 100] },
    });
    expect(px(gainOnly, 2, 0)[0] - px(gainOnly, 0, 0)[0]).toBe(30);
    expect(px(out, 2, 0)[0] - px(out, 0, 0)[0]).toBe(16);
    // A region with no k: the per-channel gain to ÷ from. Alpha is kept.
    expect(px(out, 40, 5)).toEqual([80, 90, 110, 200]);
    expect(regionGain({ from: [100, 100, 100], to: [80, 90, 110] })).toEqual([0.8, 0.9, 1.1]);
  });

  it("blends two regions across a soft edge by their coverage", () => {
    const soft = new Uint8Array(W * H);
    const rest = new Uint8Array(W * H);
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        soft[y * W + x] = x < 30 ? 255 : x === 30 ? 128 : 0;
        rest[y * W + x] = 255 - soft[y * W + x];
      }
    }
    const flat = rgba(() => [100, 100, 100, 255]);
    const out = toneRegions(flat, W, H, { a: soft, b: rest }, { a: { from: [100, 100, 100], to: [50, 50, 50] }, b: { from: [100, 100, 100], to: [150, 150, 150] } });
    expect(px(out, 10, 10)[0]).toBe(50);
    expect(px(out, 40, 10)[0]).toBe(150);
    expect(px(out, 30, 10)[0]).toBeGreaterThan(95);
    expect(px(out, 30, 10)[0]).toBeLessThan(105);
  });

  it("clamps, and refuses a table and a region set that disagree", () => {
    const bright = rgba(() => [250, 250, 250, 255]);
    const all = planeToBytes(rectPlane([0, 0, W, H], W, H));
    expect(px(toneRegions(bright, W, H, { a: all }, { a: { from: [100, 100, 100], to: [200, 200, 200] } }), 0, 0)[0]).toBe(255);
    expect(() => toneRegions(bright, W, H, { a: all, b: all }, { a: { from: [1, 1, 1], to: [1, 1, 1] } })).toThrow(/region b has no tone/);
    expect(() => toneRegions(bright, W, H, { a: all }, { a: { from: [1, 1, 1], to: [1, 1, 1] }, b: { from: [1, 1, 1], to: [1, 1, 1] } })).toThrow(/tone b has no/);
    expect(() => toneRegions(bright, W, H, { a: all }, { a: { from: [1, 1, 1], to: [1, 1, 300] } })).toThrow(/from \/ to as RGB/);
    expect(() => toneRegions(bright, W, H, { a: all }, { a: { from: [1, 1, 1], to: [1, 1, 1], k: 3 } })).toThrow(/contrast k/);
    expect(() => toneRegions(bright.subarray(4), W, H, { a: all }, { a: { from: [1, 1, 1], to: [1, 1, 1] } })).toThrow(/RGBA/);
  });

  it("describes a table for provenance", () => {
    expect(describeRegionTones({ body: { from: [20, 20, 20], to: [30, 40, 26], k: 0.8 }, bevel: { from: [100, 100, 100], to: [80, 90, 110] } })).toEqual({
      body: "(in − 20, 20, 20) × 0.8 + 30, 40, 26",
      bevel: "× 0.800 / 0.900 / 1.100 (100, 100, 100 → 80, 90, 110)",
    });
  });
});
