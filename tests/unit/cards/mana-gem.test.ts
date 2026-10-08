import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";
import {
  drawsManaGem,
  ENERGY_GEM,
  hasManaGlyph,
  LARGE_PIP_SCALE,
  manaGemSpec,
  manaGlyphSuffixes,
  MANA_GEM_BG,
  MANA_SYMBOL_INK,
  PHYREXIAN_GLYPH_OF_DISC,
  PHYREXIAN_SPLIT_GEM,
  pipDiscPx,
  pipRisePx,
  pipScale,
  SNOW_FLAKE_MITRE,
  SNOW_GEM,
  SPLIT_GEM,
  UNTAP_GEM,
} from "@/lib/cards/mana-gem";
import { SNOW_FLAKE_BOX, SNOW_FLAKE_PATH } from "@/lib/cards/snow-flake-path";
import { costRowWidthPct } from "@/lib/cards/render-tiers";
import { metricsFor, pipTopOf, pipWidthPx, RULES_TARGETS, runWidthPx } from "@/lib/cards/rules-layout";
import { tokenizeRulesText } from "@/lib/cards/rules-text";
import { manaGlyphPx, SYMBOL_STYLES, symbolStyle } from "@/lib/cards/symbol-style";
import { getManaCodepoint } from "@/lib/render/card-fonts";

// ---------------------------------------------------------------------------
// lib/cards/mana-gem.ts — the one description of a card's mana pip that the
// bake's ManaGem and the preview's CardPip both draw.
//
// The numbers here are what every stored bake is drawn with: a change to one
// is a change to stored PNGs — a layout bump, not an edit. Layout v49 (the
// symbols as printed, owner round 43) changed five drawings and added the
// two-colour Phyrexian disc; the first describe holds what did NOT move, the
// second what did, each to the print measurement it was set from. The preview-vs-bake comparison
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
      expect(manaGemSpec(c, 73, modern)).toEqual({ kind: "solid", suffix: c, discPx: 73, bg: MANA_GEM_BG[c], ink: "#150d08", glyphPx: 53 });
    }
    // Generic, variable, colourless, tap: the grey disc, the dark ink, the
    // plain pip's own disc.
    for (const suffix of ["7", "x", "tap", "c", "0", "20"]) {
      expect(manaGemSpec(suffix, 60, modern)).toEqual({ kind: "solid", suffix, discPx: 60, bg: "#beb9b2", ink: "#150d08", glyphPx: manaGlyphPx(60) });
    }
  });

  it("a split disc: the 135° fill and both halves in whole px of the disc", () => {
    expect(manaGemSpec("wu", 73, modern)).toEqual({
      kind: "split",
      suffix: "wu",
      // A hybrid's disc is a plain pip's (its size is not part of v49).
      discPx: 73,
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

describe("layout v49: the symbols as printed, as data", () => {
  const INK = "#150d08";
  const styles = Object.values(SYMBOL_STYLES);

  it("Phyrexian: the colour's disc ×1.2 of a plain pip's (print 1.175 ± 0.020 cost, 1.21 ± 0.08 text), the symbol 0.91 of it (print 0.904 / 0.913)", () => {
    expect(LARGE_PIP_SCALE).toBe(1.2);
    expect(PHYREXIAN_GLYPH_OF_DISC).toBe(0.91);
    for (const c of WUBRG) {
      // 73 → 88 (cost), 60 → 72 (9-point rules text); the glyph 0.91 of the LARGER disc.
      expect(manaGemSpec(`${c}p`, 73, modern)).toEqual({ kind: "solid", suffix: `${c}p`, discPx: 88, bg: MANA_GEM_BG[c], ink: INK, glyphPx: 80 });
      expect(manaGemSpec(`${c}p`, 60, modern)).toEqual({ kind: "solid", suffix: `${c}p`, discPx: 72, bg: MANA_GEM_BG[c], ink: INK, glyphPx: 66 });
      expect(pipScale(`${c}P`)).toBe(1.2);
    }
    // Every disc of the rules ladder and the cost sizes: whole px, the rise
    // half the growth (the odd px below).
    for (const pip of [33, 38, 41, 44, 47, 50, 53, 60, 66, 72, 73]) {
      const disc = pipDiscPx("gp", pip);
      expect(disc).toBe(Math.round(pip * 1.2));
      expect(pipRisePx("gp", pip)).toBe(Math.floor((disc - pip) / 2));
      expect(pipDiscPx("g", pip)).toBe(pip);
      expect(pipRisePx("g", pip)).toBe(0);
    }
  });

  it("only the Phyrexian symbols are larger: not a hybrid, a twobrid, nor a symbol no card draws", () => {
    for (const suffix of ["wu", "uw", "2g", "cw", "s", "e", "untap", "tap", "x", "7", "cp", "wwp", "2wp", "p"]) expect(pipScale(suffix), suffix).toBe(1);
    for (const pair of ["wu", "gu", "ug", "rw"]) expect(pipScale(`${pair}p`), pair).toBe(1.2);
  });

  it("two-colour Phyrexian: the split fill on the larger disc, a Phyrexian symbol in each half (print: each 0.453 ± 0.051 tall, 0.169 ± 0.029 off centre)", () => {
    expect(PHYREXIAN_SPLIT_GEM).toEqual({ halfOfDisc: 0.45, top: { top: 0.096, left: 0.105 }, bottom: { top: 0.436, left: 0.445 } });
    expect(manaGemSpec("gwp", 60, modern)).toEqual({
      kind: "split",
      suffix: "gwp",
      discPx: 72,
      ink: INK,
      background: "linear-gradient(135deg, #93b483 50%, #f0f2c0 50%)",
      halfPx: 32,
      top: { suffix: "p", bg: "#93b483", topPx: 7, leftPx: 8 },
      bottom: { suffix: "p", bg: "#f0f2c0", topPx: 31, leftPx: 32 },
    });
    // The half symbol's centre (its em box is as tall as its ink: 1 em),
    // off the disc's centre along the diagonal, as a share of the disc.
    for (const disc of [72, 88]) {
      const gem = manaGemSpec("gwp", disc / 1.2, modern);
      if (gem.kind !== "split") throw new Error("split");
      expect(gem.discPx).toBe(disc);
      const off = (half: { topPx: number }) => (half.topPx + gem.halfPx / 2 - disc / 2) / disc;
      expect(-off(gem.top)).toBeGreaterThan(0.14);
      expect(-off(gem.top)).toBeLessThan(0.2);
      expect(off(gem.bottom)).toBeGreaterThan(0.14);
      expect(off(gem.bottom)).toBeLessThan(0.2);
    }
    // The tokenizer reads the three-part form, either order; the font has the glyph both halves draw.
    expect(tokenize("{G/U/P}")).toEqual([{ kind: "hybrid", left: "G", right: "U", phyrexian: true }]);
    expect(tokenSuffix(tokenize("{u/g/p}")[0])).toBe("ugp");
    expect(tokenSuffix(tokenize("{G/U}")[0])).toBe("gu");
    expect(getManaCodepoint("p")).not.toBeNull();
  });

  it("untap: a white arrow on a near-black disc (print: disc #202123, arrow #fefdfe, 0.639 ± 0.008 of the disc tall) — in every style", () => {
    expect(UNTAP_GEM).toEqual({ bg: "#211f23", ink: "#ffffff", glyphOfDisc: 0.9 });
    for (const style of styles) {
      expect(manaGemSpec("untap", 73, style), style.id).toEqual({ kind: "solid", suffix: "untap", discPx: 73, bg: "#211f23", ink: "#ffffff", glyphPx: 66 });
    }
    // mana-font's arrow is 0.704 em tall: 0.9 × 0.704 = 0.634 of the disc.
    expect(UNTAP_GEM.glyphOfDisc * 0.704).toBeCloseTo(0.634, 3);
  });

  it("snow: the generic disc and the flake as ONE SVG description (print: 0.921 ± 0.009 of the disc, outline 0.056 of the flake)", () => {
    expect(SNOW_GEM).toEqual({ flakeOfDisc: 0.94, fill: "#ffffff", outlineOfDisc: 0.062, fillOfDisc: 0.012 });
    expect(SNOW_FLAKE_MITRE).toBe(2.5);
    const gem = manaGemSpec("s", 73, modern);
    if (gem.kind !== "solid" || !gem.flake) throw new Error("flake");
    expect({ ...gem, flake: undefined }).toEqual({ kind: "solid", suffix: "s", discPx: 73, bg: "#beb9b2", ink: INK, glyphPx: 53, flake: undefined });
    expect(gem.flake.sizePx).toBe(69);
    expect(gem.flake.fill).toBe("#ffffff");
    expect(gem.flake.d).toBe(SNOW_FLAKE_PATH);
    // The viewBox is a square centred on the path's own box, and the path's
    // box plus one outline each side spans it.
    const [x, y, w, h] = gem.flake.viewBox.split(" ").map(Number);
    const [x0, y0, x1, y1] = SNOW_FLAKE_BOX;
    expect(w).toBe(h);
    expect(x + w / 2).toBeCloseTo((x0 + x1) / 2, 2);
    expect(y + h / 2).toBeCloseTo((y0 + y1) / 2, 2);
    expect(Math.max(x1 - x0, y1 - y0) + gem.flake.outlineWidth).toBeCloseTo(w, 1);
    // In px: an outline 0.062 of the disc each side of the white parts
    // (≈ 4.5 px drawn under the white, ≈ 3 px of it showing at 73: the
    // white is grown 0.012 of the disc over it), the same shares at any size.
    const unit = gem.flake.sizePx / w;
    expect((gem.flake.outlineWidth / 2) * unit).toBeCloseTo(73 * 0.062, 1);
    expect((gem.flake.fillWidth / 2) * unit).toBeCloseTo(73 * 0.012, 1);
    for (const style of styles) expect(manaGemSpec("s", 73, style), style.id).toEqual(gem);
  });

  it("energy: no disc (bg null) and a symbol 1.04 of the cell (0.863 em tall: 0.897 of a pip's disc; print 0.895 ± 0.012) — in every style", () => {
    expect(ENERGY_GEM).toEqual({ glyphOfDisc: 1.04 });
    for (const style of styles) {
      expect(manaGemSpec("e", 60, style), style.id).toEqual({ kind: "solid", suffix: "e", discPx: 60, bg: null, ink: INK, glyphPx: 62 });
    }
    expect(ENERGY_GEM.glyphOfDisc * 0.863).toBeCloseTo(0.897, 2);
  });

  it("the snow path is the font's own glyph data, with its licence named", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "lib/cards/snow-flake-path.ts"), "utf8");
    expect(source).toMatch(/SIL Open Font License 1\.1/);
    expect(source).toMatch(/mana-font/);
    expect(SNOW_FLAKE_PATH.startsWith("M500 736.3")).toBe(true);
    // One path of straight segments (no curves): what both renderers stroke.
    expect(SNOW_FLAKE_PATH).toMatch(/^[ML0-9. ]+$/);
  });
});

describe("which symbols the font has a glyph for", () => {
  /** What card text can reach (tokenSuffix): digits, one to three characters
   *  (the two-colour Phyrexian "gup" is three), tap / untap and a style's
   *  own tap. */
  const reachable = (suffix: string) =>
    /^\d+$/.test(suffix) || suffix.length <= 2 || /^[wubrg]{2}p$/.test(suffix) || /^(un)?tap(-[a-z0-9]+)?$/.test(suffix);

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
    // The two-colour Phyrexian disc draws in either order (v49): a split
    // disc needs no class of its own, only the "p" both halves draw.
    const drawn = ["{G}", "{0}", "{16}", "{20}", "{X}", "{S}", "{T}", "{Q}", "{E}", "{C}", "{W/U}", "{U/W}", "{2/G}", "{G/P}", "{100}", "{W/U/P}", "{U/W/P}", "{G/W/P}"];
    const none = ["{C/P}", "{W/W/P}", "{C/W/P}", "{2/W/P}", "{C/W}", "{3/W}", "{W/W}", "{21}", "{1/2}", "{CHAOS}", "{A}"];
    for (const text of drawn) expect(drawsManaGem(suffixOf(text), modern), text).toBe(true);
    for (const text of none) {
      expect(drawsManaGem(suffixOf(text), modern), text).toBe(false);
      // …as the bake: no codepoint and no split disc.
      expect(getManaCodepoint(suffixOf(text)), text).toBeNull();
      expect(manaGemSpec(suffixOf(text), 60, modern).kind, text).toBe("solid");
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

// The larger Phyrexian disc is MEASURED, not only drawn: the rules layout's
// run widths and pip tops and the cost row's room for the name all read
// pipScale — so a line breaks for the disc the card draws.
describe("layout v49: the layout and the cost row measure a pip's own disc", () => {
  const run = (text: string) => tokenizeRulesText(text)[0].filter((item) => item.t === "m");

  it("a rules run: a Phyrexian pip is 1.2 pips wide, on a plain pip's centre, at every size and both targets", () => {
    for (const target of RULES_TARGETS) {
      for (const sizePx of [42, 50, 64, 76]) {
        const m = metricsFor(sizePx, undefined, target);
        const [plain] = run("{G}");
        const [phy] = run("{G/P}");
        const [split] = run("{G/U/P}");
        if (plain.t !== "m" || phy.t !== "m" || split.t !== "m") throw new Error("pips");
        expect(pipWidthPx(plain, m)).toBe(m.pipPx);
        expect(pipWidthPx(phy, m)).toBe(Math.round(m.pipPx * 1.2));
        expect(pipWidthPx(split, m)).toBe(Math.round(m.pipPx * 1.2));
        // The same centre (the odd px below): top + half the disc.
        const grow = pipWidthPx(phy, m) - m.pipPx;
        expect(pipTopOf(plain, m)).toBe(m.pipTopPx);
        expect(pipTopOf(phy, m)).toBe(m.pipTopPx - Math.floor(grow / 2));
        expect(Math.abs(pipTopOf(phy, m) + pipWidthPx(phy, m) / 2 - (m.pipTopPx + m.pipPx / 2))).toBeLessThanOrEqual(0.5);
        // It is centred on the capitals like every pip, so it rises a
        // little ABOVE its line box (2–3 px at HD; the layout's ink boxes
        // and its clip check measure that top) and never reaches the box's
        // bottom: two such discs on consecutive lines stay apart.
        expect(pipTopOf(phy, m)).toBeLessThanOrEqual(0);
        expect(pipTopOf(phy, m)).toBeGreaterThanOrEqual(-Math.ceil(0.05 * m.fontPx));
        expect(pipTopOf(phy, m) + pipWidthPx(phy, m)).toBeLessThan(m.linePx);
        expect(m.linePx + pipTopOf(phy, m) - (pipTopOf(phy, m) + pipWidthPx(phy, m))).toBeGreaterThanOrEqual(1);
        // A run of pips: each its own disc, a hairline between two.
        expect(runWidthPx(run("{2}{G/P}{G/P}"), m)).toBe(m.pipPx + 2 * pipWidthPx(phy, m) + 2 * m.pipGapPx);
        expect(runWidthPx(run("{2}{G}{G}"), m)).toBe(3 * m.pipPx + 2 * m.pipGapPx);
        // No inline pip keeps a shadow clear, in any style.
        for (const style of Object.keys(SYMBOL_STYLES) as Array<keyof typeof SYMBOL_STYLES>) {
          expect(metricsFor(sizePx, undefined, target, style)).toMatchObject({ pipShadowPx: 0, pipShadowLeftPx: 0 });
        }
      }
    }
  });

  it("an untap, snow or energy pip is a plain pip's cell: no line moves for them", () => {
    const m = metricsFor(64);
    expect(runWidthPx(run("{Q}{S}{E}"), m)).toBe(runWidthPx(run("{T}{2}{G}"), m));
    for (const item of run("{Q}{S}{E}")) if (item.t === "m") expect(pipTopOf(item, m)).toBe(m.pipTopPx);
  });

  it("the cost row: a Phyrexian disc takes 0.2 of a disc more of the bar, in every style", () => {
    for (const style of Object.values(SYMBOL_STYLES)) {
      for (const disc of [0.04, 0.0487]) {
        const plain = costRowWidthPct("{2}{G}{G}", disc, style);
        expect(costRowWidthPct("{2}{G/P}{G}", disc, style) - plain).toBeCloseTo(0.2 * disc, 12);
        expect(costRowWidthPct("{2}{G/U/P}{G/P}", disc, style) - plain).toBeCloseTo(0.4 * disc, 12);
        expect(costRowWidthPct("{Q}{S}{E}", disc, style)).toBeCloseTo(plain, 12);
        // The modern row still measures its cost shadow (v49 left it alone).
        expect(costRowWidthPct("{G}", disc, style)).toBeCloseTo((1 + style.costRowShadowDiscs) * disc + costRowWidthPct("{G}", 0, style), 12);
      }
    }
    expect(SYMBOL_STYLES.modern.costRowShadowDiscs).toBe(0.1);
  });
});
