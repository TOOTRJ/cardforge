import { describe, expect, it } from "vitest";
import { compareRegion, prepare, tileMap, worstTile, type Rgb } from "@/tests/parity/compare";
import {
  BASELINE_MARGIN,
  LIMITS,
  baselineFailures,
  judge,
  limitFailures,
  overLimits,
  toBaselineCase,
  type Measured,
} from "@/tests/parity/thresholds";

// ---------------------------------------------------------------------------
// The preview ⇄ bake comparison's arithmetic (TODO 3.11,
// tests/parity/compare.ts + thresholds.ts) on synthetic pictures — no
// browser, no bake. What CI's "Preview parity" job relies on:
//   * a piece that MOVED is found, by how much, and in the region it is in;
//   * the same picture drawn by "another rasteriser" (soft edges) reads as
//     no move;
//   * one small piece 2 px from its place — an inline pip — is found by the
//     tiles even where its region's average hardly moves;
//   * the recorded baseline catches a 2 px move in EITHER direction, also
//     one that happens to cancel an offset the baseline already holds.
// ---------------------------------------------------------------------------

const W = 300;
const H = 200;

/** A textured "frame" (never flat: the search must not lock onto texture)
 *  with dark boxes — the "ink". */
function picture(boxes: { x: number; y: number; w: number; h: number }[], soften = 0): Rgb {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let v = 170 + 25 * Math.sin(x / 7) * Math.cos(y / 9);
      for (const b of boxes) {
        // Distance inside the box (negative outside): a soft edge stands in
        // for another rasteriser's anti-aliasing.
        const inside = Math.min(x - b.x, b.x + b.w - 1 - x, y - b.y, b.y + b.h - 1 - y);
        if (inside >= 0) v = soften && inside < 1 ? (v + 20 * soften) / (1 + soften) : 20;
      }
      const i = (y * W + x) * 3;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return { data, width: W, height: H };
}

const LEFT = { x: 0, y: 0, w: 150, h: H };
const RIGHT = { x: 150, y: 0, w: 150, h: H };
const text = [
  { x: 20, y: 40, w: 60, h: 8 },
  { x: 20, y: 60, w: 90, h: 8 },
  { x: 30, y: 80, w: 14, h: 14 },
];
const other = [{ x: 190, y: 100, w: 70, h: 10 }];

describe("compareRegion — has the region's ink moved?", () => {
  it("the same picture: no move, no difference", () => {
    const p = prepare(picture([...text, ...other]), picture([...text, ...other]));
    expect(compareRegion(p, LEFT, { radius: 5 })).toMatchObject({ dx: 0, dy: 0, shift: 0, mad: 0, hot: 0 });
  });

  it.each([
    [2, 0],
    [-3, 1],
    [0, -2],
    [4, 4],
  ])("finds a move of %i,%i px, in the region it happened in only", (dx, dy) => {
    const moved = text.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy }));
    const p = prepare(picture([...text, ...other]), picture([...moved, ...other]));
    const left = compareRegion(p, LEFT, { radius: 5 });
    expect([left.dx, left.dy]).toEqual([dx, dy]);
    expect(left.shift).toBe(Math.max(Math.abs(dx), Math.abs(dy)));
    expect(left.mad).toBeGreaterThan(0.5);
    const right = compareRegion(p, RIGHT, { radius: 5 });
    expect(right).toMatchObject({ dx: 0, dy: 0, mad: 0, hot: 0 });
  });

  it("another rasteriser's edges are a difference, not a move", () => {
    const p = prepare(picture(text), picture(text, 1.5));
    const left = compareRegion(p, LEFT, { radius: 5 });
    expect([left.dx, left.dy]).toEqual([0, 0]);
    expect(left.mad).toBeGreaterThan(0);
    expect(left.mad).toBeLessThan(3);
  });

  it("a move larger than the search radius still shows as a difference", () => {
    const moved = text.map((b) => ({ ...b, x: b.x + 30 }));
    const p = prepare(picture(text), picture(moved));
    expect(compareRegion(p, LEFT, { radius: 5 }).hot).toBeGreaterThan(0.03);
  });

  it("refuses two pictures of different sizes", () => {
    const small: Rgb = { data: new Uint8Array(10 * 10 * 3), width: 10, height: 10 };
    expect(() => prepare(picture([]), small)).toThrow(/sizes differ/);
  });
});

describe("tileMap — one small piece out of place", () => {
  it("a 14 px 'pip' 2 px low: its region's average barely moves, its tiles do", () => {
    const pipLow = text.map((b, i) => (i === 2 ? { ...b, y: b.y + 2 } : b));
    const same = prepare(picture(text), picture(text, 1.5));
    const moved = prepare(picture(text), picture(pipLow, 1.5));
    // The text outvotes the pip: the region still reads "no move".
    expect(compareRegion(moved, LEFT, { radius: 5 })).toMatchObject({ dx: 0, dy: 0 });
    const before = tileMap(same, 25);
    const after = tileMap(moved, 25);
    expect(before.cols).toBe(12);
    expect(before.rows).toBe(8);
    const raised = after.mads.map((mad, i) => (mad > BASELINE_MARGIN.tileMad(before.mads[i] + 2) ? i : -1)).filter((i) => i >= 0);
    // The pip sits at x 30–43, y 80–95: column 1, rows 3 (and its edge in 2).
    expect(raised.length).toBeGreaterThan(0);
    for (const i of raised) {
      expect(i % after.cols).toBe(1);
      expect([2, 3]).toContain(Math.floor(i / after.cols));
    }
    const worst = worstTile(after);
    expect([worst.x, worst.y]).toEqual([25, 75]);
  });
});

function measured(regions: Record<string, [number, number, number, number]>, size: "750" | "hd" = "750"): Measured {
  return {
    id: "synthetic/case",
    size,
    regions: Object.fromEntries(
      Object.entries(regions).map(([name, [dx, dy, mad, hot]]) => [name, { dx, dy, shift: Math.max(Math.abs(dx), Math.abs(dy)), mad, hot }]),
    ),
    card: { dx: 0, dy: 0, shift: 0, mad: 2, hot: 0.01 },
    tile: { mad: 10, x: 0, y: 0 },
    tiles: { tile: 25, cols: 2, rows: 1, mads: [3, 10] },
  };
}

describe("the three layers of tests/parity/thresholds.ts", () => {
  it("layer 1: a region over a limit that no known difference names fails", () => {
    const limit = LIMITS["750"].shift;
    const m = measured({ "no-such-region": [limit + 1, 0, 1, 0] });
    expect(overLimits(m)).toEqual([{ region: "no-such-region", metric: "dx", value: limit + 1, limit }]);
    expect(limitFailures(m)).toHaveLength(1);
    expect(limitFailures(m)[0]).toMatch(/over the limit .* no known difference names it/);
    expect(limitFailures(measured({ "no-such-region": [limit, -limit, 1, 0] }))).toEqual([]);
  });

  it("layer 3: within ±1 px of the recorded offset passes; 2 px fails EITHER way", () => {
    const base = toBaselineCase(measured({ rules: [-1, -2, 8, 0.05] }));
    expect(baselineFailures(measured({ rules: [-1, -2, 8, 0.05] }), base)).toEqual([]);
    expect(baselineFailures(measured({ rules: [0, -1, 8, 0.05] }), base)).toEqual([]);
    expect(baselineFailures(measured({ rules: [-2, -3, 8, 0.05] }), base)).toEqual([]);
    // Further from the bake…
    expect(baselineFailures(measured({ rules: [-1, -4, 8, 0.05] }), base)[0]).toMatch(/rules: the preview sits at -1,-4 px .* it was -1,-2/);
    // …and a move that CANCELS the recorded offset (the preview nudged 2 px
    // down lands on the bake): no limit would notice it.
    const cancelled = measured({ rules: [-1, 0, 2, 0.01] });
    expect(limitFailures(cancelled)).toEqual([]);
    expect(baselineFailures(cancelled, base)).toHaveLength(1);
  });

  it("layer 3: a larger difference, a tile that left its step, a missing record", () => {
    const base = toBaselineCase(measured({ rules: [0, 0, 8, 0.05] }));
    expect(baselineFailures(measured({ rules: [0, 0, BASELINE_MARGIN.mad(8) + 0.1, 0.05] }), base)[0]).toMatch(/rules: mad/);
    const tileMoved = measured({ rules: [0, 0, 8, 0.05] });
    tileMoved.tiles = { ...tileMoved.tiles, mads: [3, 30] };
    expect(baselineFailures(tileMoved, base)[0]).toMatch(/tiles: 1 of 2 differ more than recorded — 25,0/);
    expect(baselineFailures(measured({ rules: [0, 0, 8, 0.05], title: [0, 0, 1, 0] }), base)[0]).toMatch(/title: a region the baseline has not got/);
    expect(baselineFailures(measured({ rules: [0, 0, 8, 0.05] }), undefined)[0]).toMatch(/not in tests\/parity\/baseline\/ for this platform/);
  });

  it("a platform with no recorded section is held to the limits only", () => {
    expect(judge(measured({ rules: [0, 0, 8, 0.05] }), null)).toEqual([]);
    expect(judge(measured({ rules: [0, 0, 8, 0.05] }), undefined)).toHaveLength(1);
  });
});
