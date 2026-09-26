import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { fitDetachedCostTitle } from "@/lib/cards/title-band";

type Font = {
  unitsPerEm: number;
  charToGlyph(ch: string): { advanceWidth: number };
  getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
};

// ---------------------------------------------------------------------------
// The display face's measured advances (lib/cards/display-metrics.ts) — what
// the title next to a detached cost is fitted with in both renderers. The
// table must match the committed Beleren Bold master the renderers load; if
// the font is ever replaced (TODO 4.8's Beleren2016), this fails until the
// table is re-measured.
// ---------------------------------------------------------------------------

const buf = readFileSync(join(process.cwd(), "public/fonts/Beleren-Bold.ttf"));
const font: Font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const advance = (ch: string) => font.charToGlyph(ch).advanceWidth / font.unitsPerEm;

describe("displayTextWidthEm", () => {
  it("matches Beleren Bold's own advances for printable ASCII and the typographic punctuation", () => {
    const chars = [
      ...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)),
      ..."\u2018\u2019\u201c\u201d\u2013\u2014\u2022\u2026\u2212",
    ];
    for (const ch of chars) {
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
    expect(displayTextWidthEm("ñ")).toBe(displayTextWidthEm("n"));
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
