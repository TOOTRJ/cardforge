import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import { drawsManaGem, hasManaGlyph, manaGemSpec, manaGlyphSuffixes, MANA_GEM_BG, MANA_SYMBOL_INK, SPLIT_GEM } from "@/lib/cards/mana-gem";
import { manaGlyphPx, SYMBOL_STYLES, symbolStyle } from "@/lib/cards/symbol-style";
import { getManaCodepoint } from "@/lib/render/card-fonts";

// ---------------------------------------------------------------------------
// lib/cards/mana-gem.ts — the one description of a card's mana pip that the
// bake's ManaGem and the preview's CardPip both draw.
//
// The numbers here are what every stored bake was drawn with (they moved out
// of lib/render/card-image.tsx unchanged): a change to one is a change to
// stored PNGs — a layout bump, not an edit. The preview-vs-bake comparison
// itself is tests/unit/render/mana-gem-parity.test.tsx.
// ---------------------------------------------------------------------------

const modern = symbolStyle("modern");
const WUBRG = ["w", "u", "b", "r", "g"];

describe("the stored bake's pip, as data", () => {
  it("disc colours, ink and the split disc's proportions are the bake's own", () => {
    expect(MANA_GEM_BG).toEqual({ w: "#f0f2c0", u: "#b5cde3", b: "#aca29a", r: "#db8664", g: "#93b483", c: "#beb9b2" });
    expect(MANA_SYMBOL_INK).toBe("#150d08");
    expect(SPLIT_GEM).toEqual({ angleDeg: 135, halfOfDisc: 0.42, top: { top: 0.07, left: 0.1 }, bottom: { top: 0.5, left: 0.52 } });
  });

  it("a one-colour symbol: its colour's disc (grey for everything else), the glyph at manaGlyphPx", () => {
    for (const c of WUBRG) {
      expect(manaGemSpec(c, 73, modern)).toEqual({ kind: "solid", suffix: c, bg: MANA_GEM_BG[c], ink: "#150d08", glyphPx: 53 });
      // Phyrexian: the colour's disc, the same size as any other symbol.
      expect(manaGemSpec(`${c}p`, 73, modern)).toEqual({ kind: "solid", suffix: `${c}p`, bg: MANA_GEM_BG[c], ink: "#150d08", glyphPx: 53 });
    }
    // Generic, variable, snow, tap, untap, energy: the colourless grey disc
    // and the same dark ink — the untap disc is NOT mana-font's black one.
    for (const suffix of ["7", "x", "s", "tap", "untap", "e", "c"]) {
      expect(manaGemSpec(suffix, 60, modern)).toEqual({ kind: "solid", suffix, bg: "#beb9b2", ink: "#150d08", glyphPx: manaGlyphPx(60) });
    }
  });

  it("a split disc: the 135° fill and both halves in whole px of the disc", () => {
    expect(manaGemSpec("wu", 73, modern)).toEqual({
      kind: "split",
      suffix: "wu",
      ink: "#150d08",
      background: "linear-gradient(135deg, #f0f2c0 50%, #b5cde3 50%)",
      halfPx: 31,
      top: { suffix: "w", bg: "#f0f2c0", topPx: 5, leftPx: 7 },
      bottom: { suffix: "u", bg: "#b5cde3", topPx: 37, leftPx: 38 },
    });
    // Either order (mana-font has a class for only ten of the twenty), and
    // a twobrid's generic half on the grey.
    const uw = manaGemSpec("uw", 60, modern);
    expect(uw.kind === "split" && [uw.top.suffix, uw.bottom.suffix, uw.background]).toEqual(["u", "w", "linear-gradient(135deg, #b5cde3 50%, #f0f2c0 50%)"]);
    const two = manaGemSpec("2g", 60, modern);
    expect(two.kind === "split" && [two.top.suffix, two.top.bg, two.bottom.suffix, two.halfPx]).toEqual(["2", "#beb9b2", "g", 25]);
  });

  it("the style's own {T}, for every style", () => {
    for (const spec of Object.values(SYMBOL_STYLES)) {
      const gem = manaGemSpec("tap", 73, spec);
      expect(gem.suffix).toBe(spec.tapSuffix);
      expect(hasManaGlyph(spec.tapSuffix), spec.id).toBe(true);
      expect(manaGemSpec("g", 73, spec)).toEqual(manaGemSpec("g", 73, modern));
    }
  });
});

describe("which symbols the font has a glyph for", () => {
  /** What card text can reach (tokenSuffix): digits, one or two characters,
   *  tap / untap and a style's own tap. */
  const reachable = (suffix: string) => /^\d+$/.test(suffix) || suffix.length <= 2 || /^(un)?tap(-[a-z0-9]+)?$/.test(suffix);

  it("the browser's list is the bake's codepoint map, for everything card text can reach", () => {
    const sheet = fs.readFileSync(path.join(process.cwd(), "node_modules/mana-font/css/mana.css"), "utf8");
    const inFont = [...new Set([...sheet.matchAll(/\.ms-([\w-]+)::before/g)].map((m) => m[1].toLowerCase()))]
      .filter(reachable)
      .filter((suffix) => getManaCodepoint(suffix) != null);
    expect(inFont.length).toBeGreaterThan(60);
    expect([...manaGlyphSuffixes()].sort()).toEqual(inFont.sort());
    for (const suffix of inFont) expect(hasManaGlyph(suffix), suffix).toBe(true);
  });

  it("a card draws a pip exactly where the bake does", () => {
    const suffixOf = (text: string) => tokenSuffix(tokenize(text)[0])!;
    const drawn = ["{G}", "{0}", "{16}", "{20}", "{X}", "{S}", "{T}", "{Q}", "{E}", "{C}", "{W/U}", "{U/W}", "{2/G}", "{G/P}", "{100}"];
    const none = ["{C/P}", "{W/U/P}", "{C/W}", "{3/W}", "{W/W}", "{21}", "{1/2}", "{CHAOS}", "{A}"];
    for (const text of drawn) expect(drawsManaGem(suffixOf(text), modern), text).toBe(true);
    for (const text of none) {
      expect(drawsManaGem(suffixOf(text), modern), text).toBe(false);
      // …as the bake: no codepoint and no split disc.
      expect(getManaCodepoint(suffixOf(text)), text).toBeNull();
    }
  });
});

describe("the bake keeps no pip table of its own", () => {
  it("lib/render/card-image.tsx reads manaGemSpec and holds no disc colour or ink", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/render/card-image.tsx"), "utf8");
    expect(source).toMatch(/manaGemSpec\(/);
    expect(source).not.toMatch(/MANA_GEM_BG|MANA_SYMBOL_INK/);
    for (const hex of [...Object.values(MANA_GEM_BG), MANA_SYMBOL_INK]) expect(source.toLowerCase(), hex).not.toContain(hex);
  });

  it("the preview's CardPip reads it too, and takes no mana-font cost class", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/cards/mana-cost-glyphs.tsx"), "utf8");
    const cardPip = source.slice(source.indexOf("export function CardPip"), source.indexOf("export function cardPipDraws"));
    expect(cardPip).toMatch(/manaGemSpec\(/);
    expect(cardPip).not.toMatch(/ms-cost|ms-shadow|previewShadowClass/);
  });
});
