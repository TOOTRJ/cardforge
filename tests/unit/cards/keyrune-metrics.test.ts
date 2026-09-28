import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  computeKeyruneMetrics,
  KEYRUNE_FILES,
  outlineBox,
  renderKeyruneMetricsModule,
} from "@/scripts/lib/keyrune-metrics.mjs";
import {
  KEYRUNE_CODEPOINTS,
  KEYRUNE_DEFAULT_CODEPOINT,
  KEYRUNE_GLYPHS,
  KEYRUNE_UNITS_PER_EM,
  KEYRUNE_VERSION,
} from "@/lib/cards/keyrune-metrics";
import { KEYRUNE_DEFAULT_GLYPH, getKeyruneCodepoint } from "@/lib/render/card-fonts";

// ---------------------------------------------------------------------------
// lib/cards/keyrune-metrics.ts is generated from the installed keyrune package
// (scripts/generate-keyrune-metrics.mjs): which glyph a set code draws, its
// advance and its ink box. Both renderers size a preset set symbol from it
// (lib/cards/set-symbol-size.ts) while drawing it from keyrune itself — the
// preview through keyrune.css, the bake from keyrune.ttf — so the table must
// be the font's. Re-read the package; a keyrune upgrade fails here until the
// table is regenerated.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");

type PathCommand = { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number };
type Glyph = { advanceWidth: number; path: { commands: PathCommand[] } };
type Font = { unitsPerEm: number; charToGlyph(ch: string): Glyph };

/** opentype.js's path command as fontkit's ({ command, args }). */
function toFontkitCommand(c: PathCommand): { command: string; args: number[] } {
  switch (c.type) {
    case "M":
      return { command: "moveTo", args: [c.x!, c.y!] };
    case "L":
      return { command: "lineTo", args: [c.x!, c.y!] };
    case "Q":
      return { command: "quadraticCurveTo", args: [c.x1!, c.y1!, c.x!, c.y!] };
    case "C":
      return { command: "bezierCurveTo", args: [c.x1!, c.y1!, c.x2!, c.y2!, c.x!, c.y!] };
    default:
      return { command: "closePath", args: [] };
  }
}

describe("the Keyrune metrics table", () => {
  it("is the one the installed keyrune package generates", () => {
    const expected = renderKeyruneMetricsModule(computeKeyruneMetrics(ROOT));
    expect(readFileSync(path.join(ROOT, "lib/cards/keyrune-metrics.ts"), "utf8")).toBe(expected);
    const pkg = JSON.parse(readFileSync(path.join(ROOT, KEYRUNE_FILES.pkg), "utf8"));
    expect(KEYRUNE_VERSION).toBe(pkg.version);
  });

  it("maps every set code to the glyph the bake draws (getKeyruneCodepoint)", () => {
    const codes = Object.entries(KEYRUNE_CODEPOINTS);
    expect(codes.length).toBeGreaterThan(400);
    for (const [code, cp] of codes) {
      expect(getKeyruneCodepoint(code), code).toBe(String.fromCodePoint(cp));
      expect(KEYRUNE_GLYPHS[cp], code).toBeDefined();
    }
    expect(String.fromCodePoint(KEYRUNE_DEFAULT_CODEPOINT)).toBe(KEYRUNE_DEFAULT_GLYPH);
    expect(KEYRUNE_GLYPHS[KEYRUNE_DEFAULT_CODEPOINT]).toBeDefined();
  });

  it("holds the advances and ink boxes of Satori's own parse of the font (opentype.js)", () => {
    const buf = readFileSync(path.join(ROOT, KEYRUNE_FILES.ttf));
    const font: Font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(KEYRUNE_UNITS_PER_EM).toBe(font.unitsPerEm);
    for (const [key, [advance, xMin, yMin, xMax, yMax]] of Object.entries(KEYRUNE_GLYPHS)) {
      const glyph = font.charToGlyph(String.fromCodePoint(Number(key)));
      const label = `U+${Number(key).toString(16)}`;
      // The advance both renderers lay the glyph out at.
      expect(advance, label).toBe(glyph.advanceWidth);
      // The ink box of opentype.js's outline, rounded outward to whole units,
      // is the table's (the generator reads fontkit's outline).
      const box = outlineBox(glyph.path.commands.map(toFontkitCommand));
      expect([xMin, yMin, xMax, yMax], label).toEqual([
        Math.floor(box.minX),
        Math.floor(box.minY),
        Math.ceil(box.maxX),
        Math.ceil(box.maxY),
      ]);
    }
  });

  it("bounds a glyph by its curves, not by the engines' own boxes (M20's left edge)", () => {
    // Both fontkit's glyph.bbox and opentype.js's getBoundingBox() put M20's
    // left edge at 5 units; its outline reaches -0.6.
    const [, xMin] = KEYRUNE_GLYPHS[KEYRUNE_CODEPOINTS.m20];
    expect(xMin).toBe(-1);
    // A straight run and a curve's turning point.
    expect(
      outlineBox([
        { command: "moveTo", args: [0, 0] },
        { command: "quadraticCurveTo", args: [-10, 50, 0, 100] },
        { command: "bezierCurveTo", args: [40, 140, 80, 140, 120, 100] },
        { command: "closePath", args: [] },
      ]),
    ).toEqual({ minX: -5, minY: 0, maxX: 120, maxY: 130 });
  });

  it("knows the glyphs the print check measured (DOM compact, M20 wide)", () => {
    const inkHeightEm = (code: string) => {
      const [, , yMin, , yMax] = KEYRUNE_GLYPHS[KEYRUNE_CODEPOINTS[code]];
      return (yMax - yMin) / KEYRUNE_UNITS_PER_EM;
    };
    // DOM's ink is as tall as the em; M20's 0.42 em (wide).
    expect(inkHeightEm("dom")).toBeCloseTo(0.989, 2);
    expect(inkHeightEm("m20")).toBeCloseTo(0.418, 2);
  });
});
