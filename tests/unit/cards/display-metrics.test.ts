import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { displayTextEm, displayTextWidthEm, kernWidening } from "@/lib/cards/display-metrics";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { fitDetachedCostTitle } from "@/lib/cards/title-band";

type Font = {
  unitsPerEm: number;
  charToGlyph(ch: string): { advanceWidth: number };
  getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
};

// ---------------------------------------------------------------------------
// lib/cards/display-metrics.ts holds hand-kept tables of Beleren Bold's
// advance widths and widening kerning pairs (the CardDisplay face both
// renderers draw names and type lines in), read by two fits: the title next
// to a detached cost (displayTextWidthEm) and aftermath's sideways name bars
// (displayTextEm). Re-read the committed master the renderers load and hold
// every entry to it; if the font is ever replaced (TODO 4.8's Beleren2016),
// this fails until the tables are re-measured.
// ---------------------------------------------------------------------------

const buf = readFileSync(join(process.cwd(), "public/fonts/Beleren-Bold.ttf"));
const font: Font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const advance = (ch: string) => font.charToGlyph(ch).advanceWidth / font.unitsPerEm;
/** An advance in thousandths of an em, rounded UP (displayTextEm's unit). */
const perMille = (ch: string) => Math.ceil((font.charToGlyph(ch).advanceWidth * 1000) / font.unitsPerEm) / 1000;
/** How far the font kerns a pair apart (+) or together (−), per-mille. */
const kern = (pair: string) =>
  font.getAdvanceWidth(pair, 1000, { kerning: true }) - font.getAdvanceWidth(pair, 1000, { kerning: false });
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i));
const EXTRA = [..."‘’“”–—•…−"];

describe("displayTextWidthEm", () => {
  it("matches Beleren Bold's own advances for printable ASCII and the typographic punctuation", () => {
    for (const ch of [...ASCII, ...EXTRA]) {
      expect(displayTextWidthEm(ch), JSON.stringify(ch)).toBeCloseTo(advance(ch), 3);
    }
    // A name: the advances' sum, to the table's rounding (half a thousandth
    // of an em per character).
    const name = "Miner the Miner, Damned Delver";
    const sum = Array.from(name).reduce((w, ch) => w + advance(ch), 0);
    expect(Math.abs(displayTextWidthEm(name) - sum)).toBeLessThanOrEqual(name.length * 0.0005);
  });

  it("measures an accented letter as its base letter, and a combining accent as nothing", () => {
    expect(displayTextWidthEm("ñ")).toBe(displayTextWidthEm("n"));
    expect(displayTextWidthEm("Ō")).toBe(displayTextWidthEm("O"));
    // Never narrower than Beleren draws it (ō is drawn 0.034 em narrower
    // than o; the rest on their base's advance).
    for (const ch of "ñÑōŌóéúÁíüç") expect(displayTextWidthEm(ch)).toBeGreaterThanOrEqual(advance(ch) - 0.0005);
    expect(displayTextWidthEm("ñ")).toBe(displayTextWidthEm("n"));
  });

  it("counts a character it does not know at a full em (wider than any capital here)", () => {
    expect(displayTextWidthEm("漢")).toBe(1);
    expect(displayTextWidthEm("W")).toBeLessThan(1);
  });

  it("leaves a fitted title room for the pairs Beleren kerns wider (TITLE_FIT_HEADROOM)", () => {
    // The table leaves kerning out. A few pairs widen a name — "Belfry
    // Spirit" draws 1.2 % wider than its advances — so a name fitted to
    // exactly its width would lose its last letter to the ellipsis. Kerned
    // the way both renderers draw it, each still fits.
    const p = getFrameProfile("m15pw");
    // Each against a cost long enough that it must shrink (above the floor).
    for (const [title, pips] of [
      ["Belfry Spirit", 12],
      ["Azkaban", 14],
      ["Raikage Office", 12],
      ["Kikyo Zoldyck", 12],
    ] as const) {
      const fit = fitDetachedCostTitle(p, title, "{W}".repeat(pips))!;
      expect(fit.text).toBe(title);
      expect(fit.sizePct, title).toBeLessThan(p.title.sizePct);
      const kerned =
        font.getAdvanceWidth(title, 1, { kerning: true }) + title.length * (p.title.letterSpacingEm ?? 0);
      expect(kerned * fit.sizePct, title).toBeLessThanOrEqual(fit.widthPct);
    }
  });

  it("adds the letter spacing after every character and measures capitals for an uppercase slot", () => {
    expect(displayTextWidthEm("Wing", { letterSpacingEm: 0.05 })).toBeCloseTo(displayTextWidthEm("Wing") + 4 * 0.05, 12);
    expect(displayTextWidthEm("Wing", { uppercase: true })).toBe(displayTextWidthEm("WING"));
    expect(displayTextWidthEm("")).toBe(0);
  });
});

describe("displayTextEm — Beleren Bold's metrics", () => {
  it("matches the font's advance for every printable ASCII character", () => {
    for (const ch of ASCII) expect(displayTextEm(ch), JSON.stringify(ch)).toBe(perMille(ch));
  });

  it("matches the font for the non-ASCII marks it lists", () => {
    for (const ch of EXTRA) expect(displayTextEm(ch), ch).toBe(perMille(ch));
  });

  it("lists every ASCII pair the font kerns apart, and no other", () => {
    let widening = 0;
    for (const a of ASCII) {
      for (const b of ASCII) {
        const k = kern(a + b);
        const want = k > 0 ? Math.ceil(k - 1e-9) : 0;
        if (want) widening += 1;
        expect(kernWidening(a + b), JSON.stringify(a + b)).toBe(want);
      }
    }
    expect(widening).toBeGreaterThan(200);
  });

  it("measures a line no narrower than the browser sets it", () => {
    for (const line of ["Ribbons", "Ryusei, the Falling Star", "WWWWWWWWWWWW", "AVAVAVAV", "Legendary Sorcery — Arcane Lesson"]) {
      const kerned = font.getAdvanceWidth(line, 1, { kerning: true });
      expect(displayTextEm(line), line).toBeGreaterThanOrEqual(kerned - 1e-9);
      // …and no wider than its letters plus the pairs that widen it.
      expect(displayTextEm(line), line).toBeLessThanOrEqual(font.getAdvanceWidth(line, 1, { kerning: false }) + 0.35 * line.length);
    }
    // "Ry" sets 0.31 em wider than its two letters in the browser.
    expect(displayTextEm("Ry")).toBeCloseTo(perMille("R") + perMille("y") + 0.309, 10);
  });

  it("takes an accented letter's base width, and errs long for glyphs it doesn't list", () => {
    expect(displayTextEm("ñ")).toBe(perMille("n"));
    expect(displayTextEm("龍")).toBe(0.7);
  });
});
