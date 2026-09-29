import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { rulesTextSideInkEm } from "@/lib/cards/rules-metrics";

// ---------------------------------------------------------------------------
// lib/cards/rules-metrics.ts rulesTextSideInkEm — how far a word's first
// glyph inks left of its origin and its last glyph right of its advance, per
// face (layout v33: the rules layout keeps that ink inside the box's clip).
// Held to the committed masters the bake loads: every glyph both faces draw,
// ASCII to Latin Extended-A.
// ---------------------------------------------------------------------------

type Glyph = { advanceWidth: number; getBoundingBox(): { x1: number; x2: number } };
type Face = { unitsPerEm: number; charToGlyph(ch: string): Glyph; hasChar(ch: string): boolean };
const parse = (file: string): Face => {
  const buf = readFileSync(join(process.cwd(), "public/fonts", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const REGULAR = parse("mplantin.ttf");
const ITALIC = parse("mplantin-italic.ttf");

const LATIN = [
  ...Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i)),
  ..."‘’“”–—•…",
  ...Array.from({ length: 0x180 - 0xa1 }, (_, i) => String.fromCharCode(0xa1 + i)),
];

describe("rulesTextSideInkEm", () => {
  it("is each glyph's own overhang past its advance box, both faces, to the thousandth", () => {
    let checked = 0;
    for (const ch of LATIN.filter((c) => REGULAR.hasChar(c) && ITALIC.hasChar(c))) {
      for (const [face, italic] of [
        [REGULAR, false],
        [ITALIC, true],
      ] as const) {
        const g = face.charToGlyph(ch);
        const box = g.getBoundingBox();
        if (box.x1 === 0 && box.x2 === 0) continue; // no outline (a space)
        const real = {
          left: Math.max(0, -box.x1) / face.unitsPerEm,
          right: Math.max(0, box.x2 - g.advanceWidth) / face.unitsPerEm,
        };
        const side = rulesTextSideInkEm(ch, italic);
        const label = `${italic ? "italic" : "regular"} ${JSON.stringify(ch)}`;
        expect(side.left, label).toBeGreaterThanOrEqual(real.left - 1e-9);
        expect(side.right, label).toBeGreaterThanOrEqual(real.right - 1e-9);
        expect(side.left, label).toBeLessThanOrEqual(real.left + 0.001);
        expect(side.right, label).toBeLessThanOrEqual(real.right + 0.001);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });

  it("reads a word's first glyph on the left and its last on the right", () => {
    expect(rulesTextSideInkEm("faith", true).left).toBeCloseTo(0.127, 9);
    expect(rulesTextSideInkEm("of").right).toBeCloseTo(0.098, 9);
    expect(rulesTextSideInkEm("of", true).right).toBeCloseTo(0.157, 9);
    expect(rulesTextSideInkEm("Flying")).toEqual({ left: 0, right: 0 });
    expect(rulesTextSideInkEm("")).toEqual({ left: 0, right: 0 });
    // A character neither face draws: the fallback's, generously; U+2212 as
    // the hyphen it is drawn as.
    expect(rulesTextSideInkEm("漢")).toEqual({ left: 0.1, right: 0.1 });
    expect(rulesTextSideInkEm("−")).toEqual(rulesTextSideInkEm("-"));
  });
});
