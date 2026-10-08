// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { costRowHdPx } from "@/lib/cards/render-tiers";
import { costPipGapPx, MANA_GLYPH_OF_DISC, manaGlyphPx, symbolStyleOf } from "@/lib/cards/symbol-style";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { COST_DISC_PCT, RULES_HD_WIDTH } from "@/lib/cards/typography";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The preview's COST ROW is the stored bake's: every disc the profile's
// `costSizePct` of the card's width and the pips COST_PIP_GAP of a disc
// apart, both at the HD bake's whole px (lib/render/card-image.tsx
// CostGlyphs: fpx of the size, the gap rounded, at least 1 px), in cqw.
//
// It was not, in any frame, until 2026-10-07: the row set a font size of
// disc ÷ 1.3 on the pips' PARENT, mana-font's `.ms-cost { font-size: 0.95em;
// width: 1.3em }` made each disc 1.235 of it — 5 % short — and the gap was
// 0.12 em of that parent (0.092 disc). A six-pip M15 cost began 35 HD px
// right of the PNG's (measured in Chromium: 69.1 px discs every 75.8 px;
// the bake 73 every 82).
// ---------------------------------------------------------------------------

/** The server markup, parsed: its raw style attributes (happy-dom drops the
 *  cqw lengths a live element's style would hold). */
function render(ui: ReactElement): HTMLElement {
  return new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html").body as HTMLElement;
}

/** One declaration of an element's inline style, as written. */
function css(el: Element, prop: string): string {
  const style = el.getAttribute("style") ?? "";
  return new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(style)?.[1].trim() ?? "";
}

const num = (length: string, unit: string) => {
  expect(length.endsWith(unit), `${length} in ${unit}`).toBe(true);
  return Number.parseFloat(length);
};

const card = (template: FrameTemplate, cost: string, more: Partial<CardPreviewData> = {}): CardPreviewData => ({
  title: "Probe",
  cost,
  cardType: template === "battle" ? "battle" : "creature",
  subtypes: ["Human"],
  colorIdentity: ["green"],
  rulesText: "Trample",
  flavorText: null,
  power: "2",
  toughness: "3",
  frameStyle: { template },
  ...more,
});

const costRow = (body: HTMLElement) => {
  const row = body.querySelector('[role="img"][aria-label^="Cost"]');
  expect(row).not.toBeNull();
  return row!;
};

/** What the profile says, as the HD bake draws it. */
function baked(template: FrameTemplate) {
  const profile = getFrameProfile(template);
  const orientation = profile.orientation === "landscape" ? "landscape" : "portrait";
  const width = RULES_HD_WIDTH[orientation];
  const discPx = Math.round((profile.costSizePct ?? profile.title.sizePct) * width);
  // The gap is the symbol style's (COST_PIP_GAP of the disc on every style
  // but "original", TODO 4.10c: the 1993 prints set their discs 12 px apart).
  return { width, discPx, gapPx: costPipGapPx(symbolStyleOf(profile), discPx) };
}

describe("the preview's cost row is the stored bake's", () => {
  it("costRowHdPx is CostGlyphs' disc and gap at the stored width", () => {
    expect(costRowHdPx(COST_DISC_PCT)).toEqual({ discPx: 73, gapPx: 9, cardWidthPx: 1500 });
    expect(costRowHdPx(0.04)).toEqual({ discPx: 60, gapPx: 7, cardWidthPx: 1500 });
    expect(costRowHdPx(0.04, "landscape")).toEqual({ discPx: 84, gapPx: 10, cardWidthPx: 2100 });
    // Never a gap that rounds away.
    expect(costRowHdPx(0.002).gapPx).toBe(1);
  });

  for (const template of ["m15", "retro", "agclassic", "battle"] as FrameTemplate[]) {
    it(`${template}: disc diameter and pitch from costSizePct and COST_PIP_GAP`, () => {
      const row = costRow(render(<CardPreview {...card(template, "{2}{G}{G}{G}{G}{G}")} />));
      const { width, discPx, gapPx } = baked(template);
      // 1 em of the row is one disc; the gap is the bake's.
      const discCqw = num(css(row, "font-size"), "cqw");
      const gapCqw = num(css(row, "column-gap"), "cqw");
      expect((discCqw * width) / 100).toBeCloseTo(discPx, 2);
      expect((gapCqw * width) / 100).toBeCloseTo(gapPx, 2);
      expect(((discCqw + gapCqw) * width) / 100).toBeCloseTo(discPx + gapPx, 2);
      // No em gap from a class on top of it.
      expect(row.className).not.toMatch(/\bgap-/);

      const pips = Array.from(row.children);
      expect(pips).toHaveLength(6);
      for (const pip of pips) {
        // A style's own symbol IMAGE (Alpha's {G}, TODO 4.10c): the whole
        // pip, one disc across — no glyph to size.
        const image = pip.querySelector("img");
        if (image) {
          const em = num(css(pip, "font-size"), "em");
          expect(em * num(css(image, "width"), "em")).toBeCloseTo(1, 3);
          expect(em * num(css(image, "height"), "em")).toBeCloseTo(1, 3);
          expect(css(pip, "flex-shrink")).toBe("0");
          continue;
        }
        // The glyph at the bake's whole px (MANA_GLYPH_OF_DISC of the disc,
        // rounded as ManaGem rounds it), its box one disc.
        const glyphEm = num(css(pip, "font-size"), "em");
        expect(glyphEm * discPx).toBeCloseTo(manaGlyphPx(discPx), 2);
        expect(Math.abs(glyphEm - MANA_GLYPH_OF_DISC)).toBeLessThan(0.5 / discPx + 1e-4);
        expect(glyphEm * num(css(pip, "width"), "em")).toBeCloseTo(1, 3);
        expect(glyphEm * num(css(pip, "height"), "em")).toBeCloseTo(1, 3);
        expect(css(pip, "flex-shrink")).toBe("0");
      }
    });
  }

  it("a split disc is one disc wide too (its halves: tests/unit/render/mana-gem-parity.test.tsx)", () => {
    const row = costRow(render(<CardPreview {...card("m15", "{W/U}{2/G}{G}")} />));
    const [hybrid, twobrid, mono] = Array.from(row.children);
    for (const pip of [hybrid, twobrid]) {
      // In the row's own em (1 em = the disc): no font size of its own.
      expect(css(pip, "font-size")).toBe("");
      expect(css(pip, "width")).toBe("1em");
      expect(css(pip, "height")).toBe("1em");
      expect(css(pip, "flex-shrink")).toBe("0");
    }
    expect(num(css(mono, "font-size"), "em") * 73).toBeCloseTo(manaGlyphPx(73), 2);
  });

  it("an owner's pip image is one disc wide too, and the pickers' rows are as they were", () => {
    const src = "https://pips.example/g.png";
    const row = costRow(
      render(<ManaCostGlyphs cost="{G}{2}" disc={{ size: "4.8667cqw", gap: "0.6cqw", px: 73 }} overrides={{ G: src }} />),
    );
    expect(css(row, "font-size")).toBe("4.8667cqw");
    expect(css(row, "column-gap")).toBe("0.6cqw");
    const img = row.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(src);
    expect(css(img, "width")).toBe("1.3em");
    expect(num(css(img.parentElement!, "font-size"), "em") * 1.3).toBeCloseTo(1, 3);

    // No `disc`: the fixed px size and gap token, mana-font's own boxes.
    const picker = costRow(render(<ManaCostGlyphs cost="{G}{2}" size="md" />));
    expect(css(picker, "font-size")).toBe("20px");
    expect(css(picker, "column-gap")).toBe("");
    expect(picker.className).toMatch(/\bgap-1\b/);
    for (const pip of Array.from(picker.children)) expect(pip.getAttribute("style")).toBeNull();
  });

  it("mana-font still draws `.ms-cost` as the row assumes", () => {
    const sheet = fs.readFileSync(path.join(process.cwd(), "node_modules/mana-font/css/mana.css"), "utf8");
    const block = /\.ms-cost \{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    // The 0.95 em that made a parent-sized disc 5 % small; the box an
    // owner's image still takes on a card, and the line proportion a card's
    // one-colour pip keeps (CardPip).
    expect(block).toMatch(/font-size:\s*0\.95em/);
    expect(block).toMatch(/width:\s*1\.3em/);
    expect(block).toMatch(/height:\s*1\.3em/);
    expect(block).toMatch(/line-height:\s*1\.35em/);
  });
});
