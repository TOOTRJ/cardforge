import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { MPLANTIN_LINE_METRICS, rulesTextGlyphsEm, rulesTextInkEm, rulesTextWidthEm } from "@/lib/cards/rules-metrics";

type Font = {
  unitsPerEm: number;
  tables: Record<string, unknown>;
  hasChar(ch: string): boolean;
  charToGlyph(ch: string): { advanceWidth: number };
  getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
};

// ---------------------------------------------------------------------------
// lib/cards/rules-metrics.ts holds hand-kept tables of MPlantin's advances
// (the rules-text face both renderers draw, regular and italic), which
// lib/cards/rules-layout.ts breaks every rules line with. Re-read the
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
/** Latin-1 and Latin Extended-A, the no-break space included. */
const LATIN_EXT = Array.from({ length: 0x180 - 0xa0 }, (_, i) => String.fromCharCode(0xa0 + i));

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

  it("matches each face's OWN glyph through Latin-1 and Latin Extended-A — an em where the face has none", () => {
    let checked = 0;
    for (const [font, italic] of [
      [REGULAR, false],
      [ITALIC, true],
    ] as const) {
      for (const ch of LATIN_EXT) {
        const label = `${italic ? "italic" : "regular"} ${JSON.stringify(ch)}`;
        // A face without the glyph: a fallback draws it, budgeted a full em.
        const advance = font.hasChar(ch) ? font.charToGlyph(ch).advanceWidth / font.unitsPerEm : 1;
        expect(rulesTextWidthEm(ch, italic), label).toBeCloseTo(advance, 9);
        checked += 1;
      }
    }
    expect(checked).toBe(2 * 224);
    // Not its base letter's width (layout v33 review): the italic ě, ř, ő
    // are wider than e, r, o; Œ is past an em; «» and ß are far under one.
    expect(rulesTextWidthEm("ě", true)).toBeCloseTo(0.423, 9);
    expect(rulesTextWidthEm("e", true)).toBeCloseTo(0.385, 9);
    expect(rulesTextWidthEm("ř", true)).toBeCloseTo(0.388, 9);
    expect(rulesTextWidthEm("ő", true)).toBeCloseTo(0.497, 9);
    expect(rulesTextWidthEm("Œ")).toBeCloseTo(1.031, 9);
    expect(rulesTextWidthEm("«")).toBeCloseTo(0.344, 9);
    expect(rulesTextWidthEm("ß")).toBeCloseTo(0.573, 9);
    // The regular master maps Ò, Ý, ý (and most of Extended-A) to an EMPTY
    // glyph (lib/validation/card-glyphs.ts warns): both renderers advance
    // its 0.278 em.
    expect(rulesTextWidthEm("Ò")).toBeCloseTo(0.278, 9);
    // The regular master has no Ā: a fallback face draws it.
    expect(REGULAR.hasChar("Ā")).toBe(false);
    expect(rulesTextWidthEm("Ā")).toBe(1);
    expect(rulesTextWidthEm("Ā", true)).toBeCloseTo(0.698, 9);
  });

  it("measures the minus sign as the hyphen both renderers draw, a combining accent as nothing, anything past Extended-A at an em", () => {
    expect(rulesTextWidthEm("−")).toBe(rulesTextWidthEm("-"));
    expect(rulesTextWidthEm("é")).toBe(rulesTextWidthEm("e")); // a combining accent rides on its letter
    expect(rulesTextWidthEm("漢")).toBe(1);
    // A precomposed letter neither face's tables cover is a fallback's.
    expect(rulesTextWidthEm("ạ")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Layout v33 (TODO 3.29): lib/cards/rules-layout.ts places each line's
// baseline from the faces' hhea metrics and keeps each line's INK (an
// accented capital's, a pip's) inside the box and out of the stat badges,
// from the extents below. Held to both masters like the advances.
// ---------------------------------------------------------------------------

type Face = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  hasChar(ch: string): boolean;
  charToGlyph(ch: string): { getBoundingBox(): { y1: number; y2: number } };
};

describe("MPLANTIN_LINE_METRICS", () => {
  it("is each face's hhea ascender / descender — a 0.999 em content area — and neither face has GSUB ligatures", () => {
    for (const [font, key] of [
      [REGULAR, "regular"],
      [ITALIC, "italic"],
    ] as const) {
      const face = font as unknown as Face;
      expect(MPLANTIN_LINE_METRICS[key].ascent, key).toBe(face.ascender / face.unitsPerEm);
      expect(MPLANTIN_LINE_METRICS[key].descent, key).toBe(-face.descender / face.unitsPerEm);
      expect(MPLANTIN_LINE_METRICS[key].ascent + MPLANTIN_LINE_METRICS[key].descent, key).toBeCloseTo(0.999, 9);
      // No ligature substitution: the browser and Satori set the same glyphs.
      expect(font.tables.gsub, key).toBeUndefined();
    }
  });
});

describe("rulesTextInkEm", () => {
  const faces = [REGULAR, ITALIC] as unknown as Face[];
  /** The larger of the two faces' glyph bounds, em. */
  const bounds = (ch: string) => {
    let ascent = 0;
    let descent = 0;
    for (const face of faces) {
      const box = face.charToGlyph(ch).getBoundingBox();
      ascent = Math.max(ascent, box.y2 / face.unitsPerEm);
      descent = Math.max(descent, -box.y1 / face.unitsPerEm);
    }
    return { ascent, descent };
  };
  const LATIN = [
    ...Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i)),
    ..."‘’“”–—•…",
    ...Array.from({ length: 0x180 - 0xa1 }, (_, i) => String.fromCharCode(0xa1 + i)),
  ];
  const inBothFaces = (ch: string) => faces.every((face) => face.hasChar(ch));

  it("reaches at least as far as every glyph both faces draw, ASCII to Latin Extended-A", () => {
    let checked = 0;
    for (const ch of LATIN.filter(inBothFaces)) {
      const ink = rulesTextInkEm(ch);
      const real = bounds(ch);
      expect(ink.ascent, JSON.stringify(ch)).toBeGreaterThanOrEqual(real.ascent - 1e-9);
      expect(ink.descent, JSON.stringify(ch)).toBeGreaterThanOrEqual(real.descent - 1e-9);
      // …and no further than the letters' default or the glyph itself (the
      // table holds control-point bounds, a hair past the drawn curve's).
      expect(ink.ascent, JSON.stringify(ch)).toBeLessThanOrEqual(Math.max(0.7, real.ascent) + 0.005);
      expect(ink.descent, JSON.stringify(ch)).toBeLessThanOrEqual(Math.max(0.2, real.descent) + 0.005);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(250);
    // The accented capitals rise ≈ 0.1 em past a 0.98 em line box's top.
    expect(rulesTextInkEm("Å").ascent).toBeCloseTo(0.904, 9);
    expect(rulesTextInkEm("É").ascent).toBeCloseTo(0.901, 9);
    expect(rulesTextInkEm("Élan").ascent).toBeCloseTo(0.901, 9);
    expect(rulesTextInkEm("Flying").ascent).toBe(0.7);
    expect(rulesTextInkEm("Flying").descent).toBe(0.2);
  });

  it("measures what one face lacks — or no face has — at the fallback's extremes; U+2212 as a hyphen", () => {
    const oneFace = LATIN.filter((ch) => !inBothFaces(ch) && /\p{L}/u.test(ch));
    expect(oneFace.length).toBeGreaterThan(0);
    for (const ch of oneFace) expect(rulesTextInkEm(ch), JSON.stringify(ch)).toEqual({ ascent: 1.07, descent: 0.38 });
    expect(rulesTextInkEm("漢")).toEqual({ ascent: 1.07, descent: 0.38 });
    expect(rulesTextInkEm("é")).toEqual({ ascent: 1.07, descent: 0.38 }); // a decomposed accent
    expect(rulesTextInkEm("−")).toEqual(rulesTextInkEm("-"));
    expect(rulesTextInkEm("")).toEqual({ ascent: 0, descent: 0 });
  });
});

describe("rulesTextGlyphsEm — each glyph's own ink, for the keep-outs", () => {
  const faces = [REGULAR, ITALIC] as unknown as (Face & { hasChar(ch: string): boolean })[];
  const LATIN = [
    ...Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i)),
    ..."‘’“”–—•…",
    ...Array.from({ length: 0x180 - 0xa1 }, (_, i) => String.fromCharCode(0xa1 + i)),
  ].filter((ch) => faces.every((f) => f.hasChar(ch)));

  it("holds every glyph both faces draw to its outline — never under it, at most a hundredth of an em over", () => {
    for (const ch of LATIN) {
      let ascent = 0;
      let descent = 0;
      for (const face of faces) {
        const box = face.charToGlyph(ch).getBoundingBox();
        ascent = Math.max(ascent, box.y2 / face.unitsPerEm);
        descent = Math.max(descent, -box.y1 / face.unitsPerEm);
      }
      const [g] = rulesTextGlyphsEm(ch);
      const band = rulesTextInkEm(ch);
      expect(g, JSON.stringify(ch)).toBeDefined();
      expect(g.ascent, JSON.stringify(ch)).toBeGreaterThanOrEqual(Math.min(ascent, band.ascent) - 1e-9);
      expect(g.descent, JSON.stringify(ch)).toBeGreaterThanOrEqual(Math.min(descent, band.descent) - 1e-9);
      expect(g.ascent, JSON.stringify(ch)).toBeLessThanOrEqual(ascent + 0.01 + 1e-9);
      expect(g.descent, JSON.stringify(ch)).toBeLessThanOrEqual(descent + 0.01 + 1e-9);
      // Never past the band the line's clip insets use.
      expect(g.ascent).toBeLessThanOrEqual(band.ascent);
      expect(g.descent).toBeLessThanOrEqual(band.descent);
    }
    expect(LATIN.length).toBeGreaterThan(250);
  });

  it("places each glyph at the sum of the advances before it, skips the space, and budgets what no face has", () => {
    const glyphs = rulesTextGlyphsEm("to kens.");
    expect(glyphs.map((g) => g.x)).toEqual([0, 1, 3, 4, 5, 6, 7].map((i) => rulesTextWidthEm("to kens.".slice(0, i))));
    // "tokens." has no descender: its deepest glyph dips 0.02 em, where the
    // band gives every letter 0.20.
    expect(Math.max(...rulesTextGlyphsEm("tokens.").map((g) => g.descent))).toBeCloseTo(0.02, 9);
    expect(rulesTextInkEm("tokens.").descent).toBe(0.2);
    expect(Math.max(...rulesTextGlyphsEm("panic").map((g) => g.descent))).toBeCloseTo(0.2, 9);
    // An italic glyph's overhang rides with it.
    expect(rulesTextGlyphsEm("f", true)[0]).toMatchObject({ left: 0.127, right: 0.157 });
    // A character no face has: the fallback's extremes; a combining accent
    // over the letter before it.
    expect(rulesTextGlyphsEm("漢")[0]).toMatchObject({ ascent: 1.07, descent: 0.38, left: 0.1, right: 0.1 });
    const decomposed = rulesTextGlyphsEm("e\u0301");
    expect(decomposed).toHaveLength(2);
    expect(decomposed[1]).toMatchObject({ x: 0, advance: rulesTextWidthEm("e"), ascent: 1.07 });
  });
});

describe("the web font's metric overrides (app/globals.css)", () => {
  it("are each face's hhea — the line box the layout models, on every platform", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const rules = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]).filter((b) => /font-family:\s*"MPlantin"/.test(b));
    expect(rules).toHaveLength(2);
    for (const [font, key] of [
      [REGULAR, "regular"],
      [ITALIC, "italic"],
    ] as const) {
      const rule = rules.find((b) => (key === "italic" ? /font-style:\s*italic/ : /font-style:\s*normal/).test(b))!;
      const pct = (name: string) => Number(new RegExp(`${name}:\\s*([0-9.]+)%`).exec(rule)?.[1]);
      const hhea = (font.tables as { hhea: { lineGap: number } }).hhea;
      expect(pct("ascent-override") / 100, key).toBeCloseTo(MPLANTIN_LINE_METRICS[key].ascent, 9);
      expect(pct("descent-override") / 100, key).toBeCloseTo(MPLANTIN_LINE_METRICS[key].descent, 9);
      // The face's own line gap: a `line-height: normal` MPlantin box keeps
      // its macOS height.
      expect(pct("line-gap-override") / 100, key).toBeCloseTo(hhea.lineGap / font.unitsPerEm, 9);
    }
  });
});
