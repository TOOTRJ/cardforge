import { describe, expect, it } from "vitest";
import {
  alignAndScore,
  bestShift1D,
  bestShift2D,
  edgeMagnitude,
  rectToPx,
  regionDiff,
  shiftImage,
  slotKindFor,
  type AlignSlot,
  type Gray,
} from "@/lib/frames/align";

// Synthetic "cards": a black canvas with white frame structure (outer border,
// title bar, type bar, text box outline, P/T plate) drawn at known
// positions, so the registration and the per-slot nudges can be checked
// against offsets we chose.

const W = 200;
const H = 280;

function blank(): Gray {
  return { width: W, height: H, data: new Uint8Array(W * H) };
}

function fillRect(img: Gray, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y += 1) {
    img.data.fill(v, y * img.width + Math.max(0, x0), y * img.width + Math.min(img.width, x1));
  }
}

function outline(img: Gray, x0: number, y0: number, x1: number, y1: number, v: number) {
  fillRect(img, x0, y0, x1, y0 + 2, v);
  fillRect(img, x0, y1 - 2, x1, y1, v);
  fillRect(img, x0, y0, x0 + 2, y1, v);
  fillRect(img, x1 - 2, y0, x1, y1, v);
}

/** A deterministic pseudo-random fill (different seeds = different "art"). */
function noise(img: Gray, x0: number, y0: number, x1: number, y1: number, seed: number) {
  let s = seed;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      img.data[y * img.width + x] = s % 256;
    }
  }
}

// Slot layout in card percent (matches the drawing below at offset 0).
const SLOTS: AlignSlot[] = [
  { path: "artSlot", rect: { topPct: 12, leftPct: 8, widthPct: 84, heightPct: 40 }, kind: "art" },
  { path: "title", rect: { topPct: 4, leftPct: 8, widthPct: 84, heightPct: 6 }, kind: "text" },
  { path: "type", rect: { topPct: 55, leftPct: 8, widthPct: 84, heightPct: 5 }, kind: "text" },
  { path: "rules", rect: { topPct: 62, leftPct: 8, widthPct: 84, heightPct: 26 }, kind: "text" },
  { path: "pt", rect: { topPct: 89, leftPct: 72, widthPct: 22, heightPct: 6 }, kind: "stat" },
];

function drawCard(opts: {
  offset?: [number, number];
  titleOffset?: [number, number];
  artSeed?: number;
  textSeed?: number;
}): Gray {
  const [ox, oy] = opts.offset ?? [0, 0];
  const [tx, ty] = opts.titleOffset ?? [0, 0];
  const img = blank();
  const px = (pct: number, total: number) => Math.round((pct / 100) * total);
  // Outer border — inset enough that a shifted copy stays on the canvas.
  outline(img, 12 + ox, 12 + oy, W - 12 + ox, H - 12 + oy, 255);
  // Title bar (filled) — may carry its own offset.
  fillRect(img, px(8, W) + ox + tx, px(4, H) + oy + ty, px(92, W) + ox + tx, px(10, H) + oy + ty, 200);
  // Art window content.
  noise(img, px(8, W) + ox, px(12, H) + oy, px(92, W) + ox, px(52, H) + oy, opts.artSeed ?? 1);
  // Type bar (filled), text box (outline), P/T plate (outline).
  fillRect(img, px(8, W) + ox, px(55, H) + oy, px(92, W) + ox, px(60, H) + oy, 200);
  outline(img, px(8, W) + ox, px(62, H) + oy, px(92, W) + ox, px(88, H) + oy, 255);
  outline(img, px(72, W) + ox, px(89, H) + oy, px(94, W) + ox, px(95, H) + oy, 255);
  // "Text" — sparse noise inside the rules box, different per image like
  // different fonts would be.
  if (opts.textSeed) {
    noise(img, px(12, W) + ox, px(66, H) + oy, px(60, W) + ox, px(80, H) + oy, opts.textSeed);
  }
  return img;
}

describe("primitives", () => {
  it("rectToPx clamps and never inverts", () => {
    expect(rectToPx({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: 100 }, W, H)).toEqual({
      x0: 0, y0: 0, x1: W, y1: H,
    });
    expect(rectToPx({ topPct: 95, leftPct: 90, widthPct: 30, heightPct: 30 }, W, H)).toEqual({
      x0: 180, y0: 266, x1: W, y1: H,
    });
  });

  it("edgeMagnitude lights up box outlines and stays dark on flat fill", () => {
    const img = blank();
    fillRect(img, 50, 50, 150, 150, 255);
    const e = edgeMagnitude(img);
    expect(e.data[70 * W + 100]).toBe(0); // inside the fill
    expect(e.data[50 * W + 100]).toBe(255); // on the top edge (axis-aligned step)
  });

  it("shiftImage moves content by (dx, dy) with zero fill", () => {
    const img = blank();
    img.data[10 * W + 10] = 255;
    const moved = shiftImage(img, 3, -2);
    expect(moved.data[8 * W + 13]).toBe(255);
    expect(moved.data[10 * W + 10]).toBe(0);
  });

  it("bestShift1D recovers a known shift", () => {
    const a = new Float64Array(100);
    const b = new Float64Array(100);
    for (let i = 40; i < 50; i += 1) a[i] = 1;
    for (let i = 47; i < 57; i += 1) b[i] = 1; // b sits 7 to the right of a
    expect(bestShift1D(a, b, 15).shift).toBe(7);
    expect(bestShift1D(a, a, 15)).toEqual({ shift: 0, score: 1 });
  });

  it("regionDiff and bestShift2D agree on a shifted box", () => {
    const a = blank();
    const b = blank();
    outline(a, 40, 40, 120, 90, 255);
    outline(b, 46, 37, 126, 87, 255); // +6, -3
    const box = { x0: 30, y0: 30, x1: 140, y1: 100 };
    expect(regionDiff(a, b, box)).toBeGreaterThan(0);
    const best = bestShift2D(edgeMagnitude(a), edgeMagnitude(b), box, 10);
    expect(best.dx).toBe(6);
    expect(best.dy).toBe(-3);
    expect(best.diff).toBe(0);
  });

  it("slotKindFor classifies profile paths", () => {
    expect(slotKindFor("artSlot")).toBe("art");
    expect(slotKindFor("secondFace.artSlot")).toBe("art");
    expect(slotKindFor("pt")).toBe("stat");
    expect(slotKindFor("secondFace.pt")).toBe("stat");
    expect(slotKindFor("costRect")).toBe("box");
    expect(slotKindFor("adventure.rules")).toBe("text");
  });
});

describe("alignAndScore", () => {
  it("scores identical structure as zero and reports no offset", () => {
    const ours = drawCard({ artSeed: 1 });
    const scan = drawCard({ artSeed: 1 });
    const result = alignAndScore({ ours, scan, slots: SLOTS });
    expect(result.global.dxPx).toBe(0);
    expect(result.global.dyPx).toBe(0);
    expect(result.global.confidence).toBe(1);
    expect(result.overall).toBe(0);
    expect(result.perSlot.title.score).toBe(0);
    expect(result.perSlot.pt.dxPct).toBe(0);
  });

  it("registers a whole-scan offset so it never counts against the slots", () => {
    const ours = drawCard({ artSeed: 1 });
    const scan = drawCard({ offset: [5, -3], artSeed: 1 });
    const result = alignAndScore({ ours, scan, slots: SLOTS, searchPct: 5 });
    expect(result.global.dxPx).toBe(5);
    expect(result.global.dyPx).toBe(-3);
    expect(result.overall).toBeLessThan(1);
    // After registration the slots need no further nudge.
    expect(result.perSlot.title.dxPct).toBe(0);
    expect(result.perSlot.pt.dyPct).toBe(0);
  });

  it("ignores art and text that legitimately differ", () => {
    const ours = drawCard({ artSeed: 1, textSeed: 11 });
    const scan = drawCard({ artSeed: 2, textSeed: 22 });
    const result = alignAndScore({ ours, scan, slots: SLOTS });
    // Different art and different "fonts", same frame: the frame score is
    // clean while the art slot itself reports its (irrelevant) difference.
    expect(result.overall).toBeLessThan(1);
    expect(result.perSlot.artSlot.score).toBeGreaterThan(5);
    expect(result.global.dxPx).toBe(0);
  });

  it("reports a per-slot nudge when only one element sits off", () => {
    const ours = drawCard({ artSeed: 1 });
    const scan = drawCard({ titleOffset: [6, 2], artSeed: 1 });
    const result = alignAndScore({ ours, scan, slots: SLOTS, searchPct: 5 });
    expect(result.global.dxPx).toBe(0);
    expect(result.global.dyPx).toBe(0);
    const title = result.perSlot.title;
    // The scan's title bar is 6 px right / 2 px down of ours → move ours.
    expect(title.dxPct).toBeCloseTo((6 / W) * 100, 1);
    expect(title.dyPct).toBeCloseTo((2 / H) * 100, 1);
    expect(title.best).toBeLessThan(title.score);
    // Other slots are untouched.
    expect(result.perSlot.type.dxPct).toBe(0);
    expect(result.perSlot.pt.score).toBe(0);
  });

  it("refuses mismatched grids", () => {
    const ours = drawCard({});
    const scan: Gray = { width: W + 1, height: H, data: new Uint8Array((W + 1) * H) };
    expect(() => alignAndScore({ ours, scan, slots: SLOTS })).toThrow(/one grid/);
  });
});
