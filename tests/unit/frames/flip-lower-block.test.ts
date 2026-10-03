import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import manifestJson from "@/lib/frames/frame-manifest.json";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FLIP_LOWER_RECUT } from "@/scripts/lib/cc-frames.mjs";

// ---------------------------------------------------------------------------
// Layout v39 (TODO 4.21a follow-up, owner decision round 22, 2026-10-02) on
// the flip MASTERS the bake draws: CC drew the bottom half as the top half
// turned, the printed M15 flips are not that symmetric, and the importer
// re-cuts the lower half onto them (scripts/lib/cc-frames.mjs
// FLIP_LOWER_RECUT; tests/unit/frames/cc-importer.test.ts has the pure
// half). Measured on C18 #134 Budoka Gardener and CM2 #71 Nezumi Graverobber
// (Scryfall PNGs at 1500 × 2100): the window's inner line centred on row
// 1311–1313, the upside-down type bar's face (the rows at ≥ 0.8 × its own
// median, on text-free columns) 1339–1444 on both, its bottom outline at
// 1447, the text box's paper from ~1467, the upside-down name bar's face
// 1761–1865; the top half (the name bar's face 72–177, the type bar's
// 493–598) where v38 put it. Every colour master is held to that anatomy
// here, row by row, and to CC's rows outside the re-cut's reach. The masters
// are bucket objects (never in git): checked where a copy at the manifest's
// sha256 is on disk — FRAMES_BUILD_DIR, else <repo>/.frames-build — and CI
// fetches them (the dev bucket before the owner promotes), where a missing
// one FAILS instead of skipping.
// ---------------------------------------------------------------------------

const manifest = manifestJson as { files: Record<string, { sha256: string }> };
const BUILD = process.env.FRAMES_BUILD_DIR ? path.resolve(process.env.FRAMES_BUILD_DIR) : path.join(process.cwd(), ".frames-build");
const STRICT = Boolean(process.env.CI && process.env.FRAMES_BUILD_DIR);
const KEYS = ["w", "u", "b", "r", "g", "c", "m"] as const;
const W = 1500;

function masterFile(key: string): string | null {
  const rel = `flip/${key}.png`;
  const entry = manifest.files[rel];
  if (!entry) throw new Error(`the manifest has no ${rel}`);
  const file = path.join(BUILD, rel);
  if (!fs.existsSync(file)) return null;
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex") === entry.sha256 ? file : null;
}

type Raw = { d: Buffer; h: number };
const luma = (r: Raw, x: number, y: number) => {
  const o = (y * W + x) * 4;
  return 0.299 * r.d[o] + 0.587 * r.d[o + 1] + 0.114 * r.d[o + 2];
};
const alpha = (r: Raw, x: number, y: number) => r.d[(y * W + x) * 4 + 3];

/** Per row, the 80th-percentile luma over columns [x0, x1] (a chamfer or a
 *  plate's columns can't hide a bar). */
function profile(r: Raw, x0: number, x1: number, y0: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y += 1) {
    const v: number[] = [];
    for (let x = x0; x <= x1; x += 2) v.push(luma(r, x, y));
    v.sort((a, b) => a - b);
    out.push(v[Math.floor(v.length * 0.8)]);
  }
  return out;
}
const median = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
/** A light bar's face: the run of rows at ≥ 0.8 × the bar's own median
 *  that holds `centre`, over columns [x0, x1]. */
function barFace(r: Raw, x0: number, x1: number, centre: number, half = 100): [number, number] {
  const prof = profile(r, x0, x1, centre - half, centre + half);
  const at = (y: number) => prof[y - (centre - half)];
  const thr = median(prof.slice(half - 22, half + 23)) * 0.8;
  expect(at(centre), `row ${centre} is on the bar`).toBeGreaterThan(thr);
  let a = centre;
  let b = centre;
  while (a > centre - half && at(a - 1) > thr) a -= 1;
  while (b < centre + half && at(b + 1) > thr) b += 1;
  return [a, b];
}
/** The darkest row of the profile in [y0, y1] and the luma-weighted centroid
 *  of the contiguous rows within 25 of it. */
function darkLine(r: Raw, x0: number, x1: number, y0: number, y1: number): { min: number; centre: number } {
  const prof = profile(r, x0, x1, y0, y1);
  const at = (y: number) => prof[y - y0];
  let mn = Infinity;
  let my = y0;
  for (let y = y0; y <= y1; y += 1) if (at(y) < mn) [mn, my] = [at(y), y];
  let a = my;
  let b = my;
  while (a > y0 && at(a - 1) <= mn + 25) a -= 1;
  while (b < y1 && at(b + 1) <= mn + 25) b += 1;
  let sum = 0;
  let n = 0;
  for (let y = a; y <= b; y += 1) {
    const w = 255 - at(y);
    sum += y * w;
    n += w;
  }
  return { min: mn, centre: sum / n };
}
/** The first and last row whose alpha at column `x` is 0 within [y0, y1]. */
function clearRows(r: Raw, x: number, y0: number, y1: number): [number, number] {
  let first = -1;
  let last = -1;
  for (let y = y0; y <= y1; y += 1) {
    if (alpha(r, x, y) !== 0) continue;
    if (first < 0) first = y;
    last = y;
  }
  return [first, last];
}

describe("the flip masters' re-cut lower half (layout v39, TODO 4.21a follow-up)", () => {
  const files = KEYS.map((key) => ({ key, file: masterFile(key) }));
  if (!STRICT && files.some((f) => !f.file)) {
    it.skip("flip masters not available here (frames bucket; set FRAMES_BUILD_DIR)", () => {});
    return;
  }

  it("has every colour key's master at the manifest's sha", () => {
    expect(files.filter((f) => !f.file).map((f) => f.key)).toEqual([]);
  });

  const loaded: Record<string, Raw> = {};
  async function master(key: string): Promise<Raw> {
    if (!loaded[key]) {
      const { data, info } = await sharp(files.find((f) => f.key === key)!.file!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect([info.width, info.height]).toEqual([W, 2100]);
      loaded[key] = { d: data, h: info.height };
    }
    return loaded[key];
  }
  // Columns clear of the bottom plate (x 53–296), the bar's end-cap
  // chamfers (x ≈ 96–115, 1385–1404) and the set symbol: the bar's face.
  const X0 = 330;
  const X1 = 1370;

  it.each(KEYS)("%s: the window ends on row 1309 and its inner line is centred on 1311.5 (the prints' 1311–1313; CC's 1316 / 1318.5)", async (key) => {
    const r = await master(key);
    const [first, last] = clearRows(r, 750, 500, 1400);
    expect(first).toBe(623);
    expect(last).toBe(1309);
    // The 4-row line right under it, opaque on every colour (the see-through
    // c keeps its opaque pinline round the window).
    for (let y = 1310; y <= 1313; y += 1) {
      expect(alpha(r, 750, y), `row ${y} alpha`).toBe(255);
      expect(luma(r, 750, y), `row ${y} luma`).toBeLessThan(20);
    }
    // …and the pinline right under the line (never dark), so the line is
    // exactly rows 1310–1313, centred on 1311.5.
    expect(luma(r, 750, 1314)).toBeGreaterThan(luma(r, 750, 1313) + 25);
    expect(alpha(r, 750, 1309)).toBe(0);
    // The art slot's bottom covers it with 7.6's spare: 1312.1 px.
    const slot = getFrameProfile("flip").artSlot;
    expect((slot.topPct + slot.heightPct) * 21).toBeGreaterThanOrEqual(1311.05);
    expect((slot.topPct + slot.heightPct) * 21).toBeLessThanOrEqual(1313);
  });

  it.each(KEYS)("%s: the upside-down type bar's face spans rows 1339–1444 (the prints'; CC's 1344–1449), its bottom outline centred on 1447", async (key) => {
    const r = await master(key);
    const face = barFace(r, X0, X1, 1392);
    expect(face).toEqual([1339, 1444]);
    const outline = darkLine(r, X0, X1, 1445, 1456);
    expect(outline.min).toBeLessThan(20);
    expect(Math.abs(outline.centre - 1447), `bottom outline ${outline.centre}`).toBeLessThanOrEqual(0.6);
    // The bar's dark top band (its outline and bevel) starts on row 1325, as
    // the prints' does (1324–1324.5), 7 px above CC's 1332.
    const prof = profile(r, X0, X1, 1314, 1330);
    const pin = median(prof.slice(0, 8)); // the pinline, rows 1314–1321
    const drop = prof.findIndex((v, i) => i >= 8 && v < pin * 0.5);
    expect(1314 + drop, `the dark band's first row`).toBe(1325);
  });

  it.each(KEYS)("%s: the text box's paper starts on row 1467 (CC's 1472) and the rules rect's top sits on it", async (key) => {
    const r = await master(key);
    // The box's bevel (rows 1460–1465 after the re-cut) then its paper: the
    // paper's first row is the first one within 10 luma of the paper's own
    // level (the see-through c's paper is translucent — its alpha steps up
    // at the same row).
    const prof = profile(r, X0, X1, 1455, 1485);
    const paper = median(prof.slice(14, 30)); // rows 1469–1484
    let dip = 0;
    for (let i = 1; i < 12; i += 1) if (prof[i] < prof[dip]) dip = i; // the bevel, rows 1456–1466
    expect(prof[dip], "the box's bevel is darker than its paper").toBeLessThan(paper - 60);
    const first = 1455 + dip + prof.slice(dip).findIndex((v) => v >= paper - 10);
    expect(first, `paper from row ${first}`).toBe(1467);
    const rect = getFrameProfile("flip").secondFace!.rules.rect;
    expect(Math.abs(rect.topPct * 21 - 1467), "the rules rect's top").toBeLessThanOrEqual(0.5);
  });

  it.each(KEYS)("%s: the upside-down name bar and the whole top half are CC's (the re-cut reaches rows 1283–1499 only)", async (key) => {
    const r = await master(key);
    // The upside-down name bar's face, where v38 had it (the prints' 1761–1865
    // reads 2 px lower; CC's agrees within the scans' tolerance).
    const udName = barFace(r, 200, 1370, 1811);
    expect(udName[1]).toBe(1864);
    expect([1758, 1759]).toContain(udName[0]); // the see-through c's bevel reads a row later
    // The top half: the name bar's face and the type bar's face, v38's rows
    // (the darker b bar's threshold takes one more row at the top; c's
    // translucent bevel one fewer at the bottom).
    const name = barFace(r, 300, 1150, 128);
    expect(name[1]).toBe(181);
    expect([75, 76]).toContain(name[0]);
    const type = barFace(r, 300, 1000, 545);
    expect(type[0]).toBe(490);
    expect([595, 596]).toContain(type[1]);
    // The window's top edge and its line: CC's (the window from 623, the
    // line on rows 619–622, the frame's colour above it).
    for (let y = 619; y <= 622; y += 1) {
      expect(alpha(r, 750, y), `row ${y} alpha`).toBe(255);
      expect(luma(r, 750, y), `row ${y} luma`).toBeLessThan(20);
    }
    expect(luma(r, 750, 618)).toBeGreaterThan(luma(r, 750, 619) + 25);
    // The re-cut's reach, from the recipe: rows [fromY + shiftTop, toY).
    expect(FLIP_LOWER_RECUT.fromY + FLIP_LOWER_RECUT.shiftTop).toBe(1283);
    expect(FLIP_LOWER_RECUT.toY).toBe(1500);
  });

  it("the re-cut's window rows are the window's: a hard top cut would be invisible on the clear middle, and the sides are the frame's own texture", async () => {
    // Inside the window the band's rows and the rows they replaced differ
    // only on the frame's sides (x < 115, x > 1384): the middle stays clear.
    const r = await master("g");
    for (let y = FLIP_LOWER_RECUT.fromY + FLIP_LOWER_RECUT.shiftTop; y < 1310; y += 1) {
      for (const x of [200, 500, 750, 1000, 1300]) expect(alpha(r, x, y), `row ${y} x ${x}`).toBe(0);
    }
  });
});
