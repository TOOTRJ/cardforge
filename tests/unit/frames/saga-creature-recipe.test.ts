import { describe, expect, it } from "vitest";
import {
  BAND_CUT,
  BAND_FILL,
  BAND_PAPER_SPAN,
  BOX_PAPER,
  BOX_TOP,
  FOLD_SQUEEZE,
  H,
  LOWER_FROM,
  RAIL_CUT,
  ROWS_CUT,
  SAGA_CREATURE_KEYS,
  TEMPLATE,
  TEXTURED_SAGA_FILE,
  W,
  WINDOW_TOP_RULE,
  composeLower,
  cutRows,
  drawRule,
  layFold,
  paintBand,
  reflectInto,
} from "@/scripts/lib/saga-creature.mjs";
import { SAGA_CREATURE_RAISE_PX, getFrameProfile } from "@/lib/cards/template-layout";
import manifest from "@/lib/frames/frame-manifest.json";
import provenance from "@/lib/cards/frame-sources.json";

// ---------------------------------------------------------------------------
// TODO 4.5d — the saga creature's recipe (scripts/lib/saga-creature.mjs,
// scripts/build-saga-creature-frames.mjs): its numbers held to the profile
// that draws on the masters, the pure pixel helpers, and the published
// masters' manifest entries and provenance.
// ---------------------------------------------------------------------------

/** A W × H RGBA buffer whose every pixel encodes its row (R) and column (G). */
function rowColumnImage(width: number, height: number): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      buf[o] = y % 256;
      buf[o + 1] = x % 256;
      buf[o + 2] = Math.floor(y / 256);
      buf[o + 3] = 255;
    }
  return buf;
}

describe("the recipe's data, held to the profile", () => {
  it("raises the type bar by the profile's 173 px: the two cuts together", () => {
    expect(ROWS_CUT).toBe(SAGA_CREATURE_RAISE_PX);
    expect(BAND_CUT[1] + RAIL_CUT[1]).toBe(173);
    // The saga's bar outline 1759–1895 lands on the prints' 1586–1722, and the
    // box from m15nyx starts on the row under it.
    expect(1895 - ROWS_CUT + 1).toBe(LOWER_FROM);
  });

  it("cuts the reminder box to the band the profile sets its reminder in, the fold squeezed into the same rows", () => {
    const profile = getFrameProfile("sagacreature");
    const intro = profile.chapters!.intro.rect;
    // The band: 237–432 px (the reminder box's 237–596 less the cut).
    expect(597 - BAND_CUT[1]).toBe(432);
    expect(Math.round((intro.topPct + intro.heightPct) * 21)).toBe(433);
    // The fold's rows (the box's 237–596) squeezed into the cut box's (237–431).
    expect(FOLD_SQUEEZE.from + (FOLD_SQUEEZE.to - FOLD_SQUEEZE.from - BAND_CUT[1])).toBe(432);
    // Its window opens under the drawn rule, inside the art slot's 2 px.
    expect(WINDOW_TOP_RULE.y0).toBe(BAND_FILL.y1);
    expect(Math.round(profile.artSlot.topPct * 21)).toBe(WINDOW_TOP_RULE.y1 - 2);
    // The paper the band is painted from is clear of the window's shadow.
    expect(BAND_PAPER_SPAN[1]).toBeLessThan(BAND_FILL.x0);
  });

  it("takes the box's top rim from under m15nyx's own bar and its paper from the saga's chapter column", () => {
    expect(BOX_TOP.from).toBe(1304);
    expect(BOX_PAPER.rect.y0).toBe(LOWER_FROM + (BOX_TOP.to - BOX_TOP.from));
    // The rows the paper is read from are inside the cut saga's rail.
    expect(BOX_PAPER.fromRow + (BOX_PAPER.rect.y1 - BOX_PAPER.rect.y0)).toBeLessThan(1586);
    expect(BOX_PAPER.span[0]).toBeGreaterThan(166); // right of the ribbon
  });

  it("builds the seven keys from the textured saga's files, `c` from its artifact silver", () => {
    expect(SAGA_CREATURE_KEYS).toEqual(["w", "u", "b", "r", "g", "m", "c"]);
    expect(TEXTURED_SAGA_FILE.c).toBe("img/frames/saga/nyx/a.png");
    expect(TEMPLATE).toBe("sagacreature");
    expect([W, H]).toEqual([1500, 2100]);
  });
});

describe("the pixel helpers", () => {
  it("reflectInto folds every column into the span, continuous at both ends", () => {
    for (let x = -50; x < 2000; x += 1) {
      const r = reflectInto(x, 160, 730);
      expect(r).toBeGreaterThanOrEqual(160);
      expect(r).toBeLessThanOrEqual(730);
      expect(Math.abs(reflectInto(x + 1, 160, 730) - r)).toBe(1);
    }
    expect(reflectInto(733, 160, 730)).toBe(727);
  });

  it("cutRows drops the cut rows and moves the rest up, transparent at the foot", () => {
    const [w, h] = [4, 600];
    const out = cutRows(rowColumnImage(w, h), w, h, [[100, 10], [300, 5]]);
    const rowOf = (y: number) => out[y * w * 4] + out[y * w * 4 + 2] * 256;
    expect(rowOf(99)).toBe(99);
    expect(rowOf(100)).toBe(110);
    expect(rowOf(300 - 10)).toBe(300 + 5);
    expect(out[(h - 1) * w * 4 + 3]).toBe(0);
    expect(out[(h - 16) * w * 4 + 3]).toBe(255);
  });

  it("paints the band from the same row's paper, mirrored, and draws the window's rule", () => {
    const img = rowColumnImage(W, 500);
    paintBand(img, W);
    const o = (240 * W + 733) * 4;
    expect([img[o], img[o + 1]]).toEqual([240, reflectInto(733, BAND_PAPER_SPAN[0], BAND_PAPER_SPAN[1]) % 256]);
    drawRule(img, W);
    const r = (WINDOW_TOP_RULE.y0 * W + 1000) * 4;
    expect([...img.subarray(r, r + 4)]).toEqual([0, 0, 0, 255]);
  });

  it("composeLower is m15nyx's rows, the box's top copied up and its paper the saga's", () => {
    const saga = rowColumnImage(W, H);
    const m15 = Buffer.alloc(W * H * 4, 7);
    const out = Buffer.from(saga);
    const counts = composeLower(out, saga, m15);
    expect(counts.m15).toBe((H - LOWER_FROM) * W);
    // Above LOWER_FROM untouched.
    expect(out.compare(saga, 0, LOWER_FROM * W * 4, 0, LOWER_FROM * W * 4)).toBe(0);
    // A border pixel: m15nyx's.
    const border = (2050 * W + 10) * 4;
    expect(out[border]).toBe(7);
    // The paper: the saga's chapter column, read BOX_PAPER.fromRow + Δ.
    const p = (1800 * W + 500) * 4;
    const sy = BOX_PAPER.fromRow + (1800 - BOX_PAPER.rect.y0);
    expect(out[p] + out[p + 2] * 256).toBe(sy);
  });

  it("layFold lays the squeezed columns over the band's rows, faded into the cut ones", () => {
    const out = Buffer.alloc(W * 600 * 4, 0);
    const rows = FOLD_SQUEEZE.to - FOLD_SQUEEZE.from - BAND_CUT[1];
    const squeezed = Buffer.alloc(FOLD_SQUEEZE.x1 * rows * 4, 200);
    expect(layFold(out, squeezed, W)).toBe(rows * FOLD_SQUEEZE.x1);
    expect(out[(FOLD_SQUEEZE.from * W + 10) * 4]).toBe(200);
    expect(out[(FOLD_SQUEEZE.from * W + FOLD_SQUEEZE.x1 - 1) * 4]).toBeLessThan(200);
    expect(out[(FOLD_SQUEEZE.from * W + FOLD_SQUEEZE.x1) * 4]).toBe(0);
  });
});

describe("the published masters", () => {
  const files = (manifest as { files: Record<string, { width: number; height: number }> }).files;
  it("are in the manifest: a PNG and a WebP per key, 1500 × 2100", () => {
    for (const key of SAGA_CREATURE_KEYS) {
      for (const ext of ["png", "webp"]) {
        const entry = files[`sagacreature/${key}.${ext}`];
        expect(entry, `${key}.${ext}`).toBeDefined();
        expect([entry.width, entry.height]).toEqual([W, H]);
      }
    }
    expect(Object.keys(files).filter((k) => k.startsWith("sagacreature/"))).toHaveLength(14);
  });

  it("record their provenance: PipGlyph's own composite, the CC files and the m15nyx masters per key", () => {
    const record = (provenance as Record<string, { source: string; converter: string; colors: Record<string, string[]> }>).sagacreature;
    expect(record.source).toBe("pipglyph");
    expect(record.converter).toBe("scripts/build-saga-creature-frames.mjs");
    for (const key of SAGA_CREATURE_KEYS) {
      expect(record.colors[key][0], key).toMatch(new RegExp(`^cc:${TEXTURED_SAGA_FILE[key as keyof typeof TEXTURED_SAGA_FILE]}@`));
      expect(record.colors[key][1], key).toMatch(new RegExp(`^m15nyx/${key}\\.png@`));
    }
  });
});
