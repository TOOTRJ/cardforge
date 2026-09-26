import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  BAKE_WRAP,
  BAKE_WRAP_WIDE,
  PREVIEW_WRAP,
  rulesTextWidthEm,
  wrapRulesText,
} from "@/lib/cards/rules-metrics";
import { RULES_TEXT } from "@/lib/cards/typography";

type Font = {
  unitsPerEm: number;
  tables: Record<string, unknown>;
  charToGlyph(ch: string): { advanceWidth: number };
  getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
};

// ---------------------------------------------------------------------------
// lib/cards/rules-metrics.ts holds hand-kept tables of MPlantin's advances
// (the rules-text face both renderers draw, regular and italic) and the
// line breaks both renderers make from them — what the planeswalker rows use
// to tell whether a last ability would reach the loyalty shield. Re-read the
// committed masters the bake loads and hold every entry to them; if a font
// is ever replaced, this fails until the tables are re-measured.
// ---------------------------------------------------------------------------

const parse = (file: string): Font => {
  const buf = readFileSync(join(process.cwd(), "public/fonts", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const REGULAR = parse("mplantin.ttf");
const ITALIC = parse("mplantin-italic.ttf");
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));
const EXTRA = [..."‘’“”–—•…"];

describe("rulesTextWidthEm", () => {
  it("matches MPlantin's own advances, regular and italic, for printable ASCII and the punctuation", () => {
    for (const [font, italic] of [
      [REGULAR, false],
      [ITALIC, true],
    ] as const) {
      for (const ch of [...ASCII, ...EXTRA]) {
        const advance = font.charToGlyph(ch).advanceWidth / font.unitsPerEm;
        expect(rulesTextWidthEm(ch, italic), `${italic ? "italic" : "regular"} ${JSON.stringify(ch)}`).toBeCloseTo(advance, 9);
      }
    }
    // A word is its letters' sum.
    const word = "battlefield.";
    expect(rulesTextWidthEm(word)).toBeCloseTo(REGULAR.getAdvanceWidth(word, 1, { kerning: false }), 9);
  });

  it("has no kerning to model: neither master kerns a pair (so both renderers set a word alike)", () => {
    for (const font of [REGULAR, ITALIC]) {
      expect(font.tables.kern).toBeUndefined();
      expect(font.tables.gpos).toBeUndefined();
      for (const pair of ["AV", "To", "Ty", "r.", "Wa", "LT", "y,", "f)"]) {
        expect(font.getAdvanceWidth(pair, 1000, { kerning: true })).toBe(font.getAdvanceWidth(pair, 1000, { kerning: false }));
      }
    }
  });

  it("measures the minus sign as the hyphen the bake draws, an accented letter as its base, anything else at an em", () => {
    expect(rulesTextWidthEm("−")).toBe(rulesTextWidthEm("-"));
    expect(rulesTextWidthEm("é")).toBe(rulesTextWidthEm("e"));
    expect(rulesTextWidthEm("Ñ", true)).toBe(rulesTextWidthEm("N", true));
    expect(rulesTextWidthEm("é")).toBe(rulesTextWidthEm("e")); // a combining accent rides on its letter
    expect(rulesTextWidthEm("漢")).toBe(1);
  });
});

describe("wrapRulesText", () => {
  const g = RULES_TEXT.wordGapEm;
  const w = (s: string) => rulesTextWidthEm(s);

  it("breaks a paragraph greedily at its words; the bake's column also holds the last word's gap", () => {
    const [a, b, c] = ["Draw", "a", "card."];
    const line = w(a) + g + w(b) + g + w(c);
    // Exactly the three words' width: one line in the preview…
    expect(wrapRulesText("Draw a card.", line, PREVIEW_WRAP)).toEqual([[line]]);
    // …while the bake's margin after "card." pushes it to a second line.
    const bake = wrapRulesText("Draw a card.", line, BAKE_WRAP);
    expect(bake).toHaveLength(1);
    expect(bake[0]).toHaveLength(2);
    expect(bake[0][0]).toBeCloseTo(w(a) + g + w(b), 12);
    expect(bake[0][1]).toBeCloseTo(w(c), 12);
    expect(wrapRulesText("Draw a card.", line + g, BAKE_WRAP)[0]).toHaveLength(1);
    // The bake's wider wrap breaks earlier still.
    expect(wrapRulesText("Draw a card.", line + g, BAKE_WRAP_WIDE)[0]).toHaveLength(2);
  });

  it("keeps a pip glued to its punctuation, counts it as a disc, and gives an over-long word its own line", () => {
    const [lines] = wrapRulesText("{T}: Add {G}{G}.", 100, PREVIEW_WRAP);
    const disc = RULES_TEXT.pipDiscEm;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBeCloseTo(disc + w(":") + g + w("Add") + g + disc + RULES_TEXT.pipGapEm + disc + w("."), 12);
    const long = "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch";
    expect(wrapRulesText(`Hi ${long} ok`, 5, PREVIEW_WRAP)).toEqual([[w("Hi"), w(long), w("ok")]]);
  });

  it("wraps each source line as its own paragraph; a blank line is a paragraph with no lines", () => {
    expect(wrapRulesText("Scry 1.\n\nDraw a card.", 100, PREVIEW_WRAP).map((p) => p.length)).toEqual([1, 0, 1]);
  });

  it("sets reminder text in the italic's widths", () => {
    const [[roman]] = wrapRulesText("Hexproof", 100, PREVIEW_WRAP);
    const [[italic]] = wrapRulesText("(Hexproof)", 100, PREVIEW_WRAP);
    expect(roman).toBeCloseTo(w("Hexproof"), 12);
    expect(italic).toBeCloseTo(rulesTextWidthEm("(Hexproof)", true), 12);
    expect(italic).not.toBeCloseTo(w("(Hexproof)"), 3);
  });
});
