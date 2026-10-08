// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { CardPip, ManaCostGlyphs } from "@/components/cards/mana-cost-glyphs";
import { metricsFor } from "@/lib/cards/rules-layout";
import { costRowHdPx } from "@/lib/cards/render-tiers";
import { manaGemSpec } from "@/lib/cards/mana-gem";
import {
  bakedShadowHex,
  discShadowCss,
  discShadowPx,
  manaGlyphPx,
  previewDiscShadowCss,
  symbolStyle,
  type SymbolStyleSpec,
} from "@/lib/cards/symbol-style";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { COST_DISC_PCT, RULES_HD_WIDTH } from "@/lib/cards/typography";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Every pip a CARD's preview draws — cost rows, rules text, the flipside
// strip, the saga rail — is the bake's ManaGem (lib/render/card-image.tsx)
// at the stored HD bake's whole px, written in em of its disc:
//
//   - the disc's shadow: ONE layer, discShadowPx left and down (0.06 / 0.07
//     of the disc, each at least 1 px), in the colour the PNG holds
//     (bakedShadowHex: the bake's filter lands #111 on #0d0d0d). mana-font's
//     `.ms-shadow` is two layers in em of the PIP's font — 0.044–0.046 of
//     the disc — and drew a 73 px cost disc's shadow 3.2 / 3.7 px where the
//     PNG has 4 / 5 (measured in Chromium, 2026-10-07);
//   - a one-colour symbol at manaGlyphPx of its disc in rules text too:
//     mana-font's own box (a 1.3 em disc) made it 1 ÷ 1.3 = 0.769 of the
//     disc, the bake 0.73 — a 60 px rules disc's tree 45 px tall, the
//     PNG's 42.
//
// WHAT each symbol is (disc colour, ink, a split disc's halves, no disc for a
// symbol without a glyph) is held to the bake's own nodes in
// tests/unit/render/mana-gem-parity.test.tsx.
//
// The pickers, deck lists and articles keep mana-font's own look.
// ---------------------------------------------------------------------------

function render(ui: ReactElement): HTMLElement {
  return new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html").body as HTMLElement;
}

function css(el: Element, prop: string): string {
  const style = el.getAttribute("style") ?? "";
  return new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(style)?.[1].trim() ?? "";
}

const em = (length: string) => {
  expect(length.endsWith("em"), `${length} in em`).toBe(true);
  return Number.parseFloat(length);
};

/** A `box-shadow` written in em → its layers as [x, y, colour]. */
function shadowLayers(value: string): Array<{ x: number; y: number; color: string }> {
  return value
    .split(",")
    .map((layer) => layer.trim().split(/\s+/))
    .map(([x, y, blur, color]) => {
      expect(blur).toBe("0");
      return { x: em(x), y: em(y), color };
    });
}

/** The pip's own font size in the bake's px, given its disc's. */
const pipFontPx = (pip: Element, discPx: number) => em(css(pip, "font-size")) * discPx;

/** The colour "modern"'s #111 shadow has in a stored PNG. */
const BAKED_SHADOW = "#0d0d0d";

function expectBakeShadow(pip: Element, discPx: number, color = BAKED_SHADOW) {
  const layers = shadowLayers(css(pip, "box-shadow"));
  expect(layers).toHaveLength(1);
  const { left, down } = discShadowPx(symbolStyle("modern"), discPx);
  // A split disc is in the row's own em (1 em = the disc).
  const fontPx = pip.tagName === "SPAN" ? discPx : pipFontPx(pip.tagName === "IMG" ? pip.parentElement! : pip, discPx);
  expect(layers[0].x * fontPx).toBeCloseTo(-left, 1);
  expect(layers[0].y * fontPx).toBeCloseTo(down, 1);
  expect(layers[0].color).toBe(color);
}

/** A style with flat discs and its own {T} (what "1997" is). */
const FLAT: SymbolStyleSpec = {
  ...symbolStyle("modern"),
  discShadow: null,
  previewShadowClass: null,
  previewShadowCss: null,
  costRowShadowDiscs: 0,
  tapSuffix: "tap-4ed",
};

const RULES = "{T}, {2}{G}{W/U}: Draw a card.\n{Q}: Untap it.";

const card = (template: FrameTemplate, more: Partial<CardPreviewData> = {}): CardPreviewData => ({
  title: "Probe",
  cost: "{X}{W/U}{G}",
  cardType: "creature",
  subtypes: ["Human"],
  colorIdentity: ["green"],
  rulesText: RULES,
  flavorText: null,
  power: "2",
  toughness: "3",
  frameStyle: { template },
  ...more,
});

const costPips = (body: HTMLElement) =>
  Array.from(body.querySelector('[role="img"][aria-label^="Cost"]')!.children);
const rulesPips = (body: HTMLElement) =>
  Array.from(body.querySelectorAll('[data-testid="rules-box"] [data-pip]'));
/** The layout's inline disc in the HD bake's px, from the size the box says
 *  it drew (RulesMetrics.pipPx). */
function rulesDiscPx(body: HTMLElement, template: FrameTemplate): number {
  const sizePx = Number(body.querySelector('[data-testid="rules-box"]')!.getAttribute("data-rules-size"));
  expect(sizePx).toBeGreaterThan(0);
  return metricsFor(sizePx, undefined, "hd", getFrameProfile(template).symbolStyle).pipPx;
}

describe("the preview's disc shadow is the bake's", () => {
  it("the stored PNG's shadow colour: the bake's filter lands #111 on #0d0d0d", () => {
    expect(bakedShadowHex("#111")).toBe(BAKED_SHADOW);
    expect(bakedShadowHex("#111111")).toBe(BAKED_SHADOW);
    // sRGB → linear → a whole 8-bit step → sRGB: the ends hold, the mid-tones move a level or none.
    expect(bakedShadowHex("#000")).toBe("#000000");
    expect(bakedShadowHex("#fff")).toBe("#ffffff");
    expect(bakedShadowHex("#808080")).toBe("#808080");
  });

  it("previewDiscShadowCss is discShadowCss's one layer, in em", () => {
    const modern = symbolStyle("modern");
    for (const discPx of [8, 42, 60, 73, 84]) {
      const { left, down } = discShadowPx(modern, discPx);
      expect(discShadowCss(modern, discPx)).toBe(`${-left}px ${down}px 0 #111`);
      const [layer, ...rest] = shadowLayers(previewDiscShadowCss(modern, discPx, discPx)!);
      expect(rest).toEqual([]);
      expect(layer.x * discPx).toBeCloseTo(-left, 2);
      expect(layer.y * discPx).toBeCloseTo(down, 2);
    }
    // At least 1 px each way, as the bake's.
    expect(previewDiscShadowCss(modern, 8, 8)).toBe(`-0.1250em 0.1250em 0 ${BAKED_SHADOW}`);
    // In em of the element that carries it.
    expect(previewDiscShadowCss(modern, 73, 53)).toBe(`${(-4 / 53).toFixed(4)}em ${(5 / 53).toFixed(4)}em 0 ${BAKED_SHADOW}`);
    expect(previewDiscShadowCss(FLAT, 73, 53)).toBeUndefined();
  });

  it("a cost row's discs: one layer, 4 px left and 5 down of a 73 px disc", () => {
    const { discPx } = costRowHdPx(COST_DISC_PCT);
    expect(discShadowPx(symbolStyle("modern"), discPx)).toEqual({ left: 4, down: 5 });
    const pips = costPips(render(<CardPreview {...card("m15")} />));
    expect(pips).toHaveLength(3);
    for (const pip of pips) expectBakeShadow(pip, discPx);
  });

  it("the rules pips are FLAT (layout v49: the M15-era prints shadow the cost alone) — every symbol class, the untap too", () => {
    const body = render(<CardPreview {...card("m15")} />);
    const pips = rulesPips(body);
    expect(pips.map((p) => p.getAttribute("data-pip"))).toEqual(["tap", "2", "g", "wu", "untap"]);
    for (const pip of pips) {
      expect(css(pip, "box-shadow"), pip.getAttribute("data-pip") ?? "").toBe("");
      expect(pip.className).not.toContain("ms-shadow");
    }
    // …while the same card's cost row keeps its one layer.
    const { discPx } = costRowHdPx(COST_DISC_PCT);
    for (const pip of costPips(body)) expectBakeShadow(pip, discPx);
    // The untap symbol is the prints': a white arrow on a near-black disc.
    const untap = pips[4];
    expect([css(untap, "background-color"), css(untap, "color")]).toEqual(["#211f23", "#ffffff"]);
    expect([css(pips[0], "background-color"), css(pips[0], "color")]).toEqual(["#beb9b2", "#150d08"]);
  });

  it("a larger disc carries its own size's shadow: a Phyrexian cost pip 88 px, 5 left and 6 down", () => {
    const body = render(<ManaCostGlyphs cost="{2}{G/P}{G/U/P}" disc={{ size: "4.8667cqw", gap: "0.6cqw", px: 73 }} />);
    const [plain, phyrexian, split] = Array.from(body.querySelectorAll("[data-pip]"));
    expect(shadowLayers(css(plain, "box-shadow")).map((l) => [l.x * pipFontPx(plain, 73), l.y * pipFontPx(plain, 73)].map(Math.round))).toEqual([[-4, 5]]);
    expect(shadowLayers(css(phyrexian, "box-shadow")).map((l) => [l.x * pipFontPx(phyrexian, 73), l.y * pipFontPx(phyrexian, 73)].map(Math.round))).toEqual([[-5, 6]]);
    // A split disc's shadow is in the row's em (1 em = a plain disc).
    expect(shadowLayers(css(split, "box-shadow")).map((l) => [l.x * 73, l.y * 73].map(Math.round))).toEqual([[-5, 6]]);
    // The discs: 73, 88 and 88 px.
    expect(em(css(plain, "width")) * pipFontPx(plain, 73)).toBeCloseTo(73, 1);
    expect(em(css(phyrexian, "width")) * pipFontPx(phyrexian, 73)).toBeCloseTo(88, 1);
    expect(em(css(split, "width")) * 73).toBeCloseTo(88, 1);
    // The energy symbol has no disc to shadow.
    const energy = render(<ManaCostGlyphs cost="{E}" disc={{ size: "4.8667cqw", gap: "0.6cqw", px: 73 }} />).querySelector("[data-pip]")!;
    expect([css(energy, "box-shadow"), css(energy, "background-color")]).toEqual(["", ""]);
  });

  it("an owner's pip image carries it too", () => {
    const src = "https://pips.example/g.png";
    const body = render(<ManaCostGlyphs cost="{G}" disc={{ size: "4.8667cqw", gap: "0.6cqw", px: 73 }} overrides={{ G: src }} />);
    expectBakeShadow(body.querySelector("img")!, 73);
  });

  it("a frame with flat discs draws none", () => {
    const body = render(
      <>
        <ManaCostGlyphs cost="{X}{W/U}{G}" disc={{ size: "4.8667cqw", gap: "0.6cqw", px: 73 }} overrides={{ G: "https://pips.example/g.png" }} symbols={FLAT} />
        <CardPip suffix="untap" discPx={60} symbols={FLAT} />
      </>,
    );
    const pips = Array.from(body.querySelectorAll("[data-pip], img"));
    expect(pips).toHaveLength(4);
    for (const pip of pips) {
      expect(css(pip, "box-shadow")).toBe("");
      expect(pip.className).not.toContain("ms-shadow");
    }
  });

  it("outside a card the pips keep mana-font's own shadow", () => {
    const body = render(<ManaCostGlyphs cost="{G}{2}" size="md" overrides={{ G: "https://pips.example/g.png" }} />);
    const [img, pip] = [body.querySelector("img")!, body.querySelector("i")!];
    expect(pip.className).toContain("ms-shadow");
    expect(pip.getAttribute("style")).toBeNull();
    expect(css(img, "box-shadow")).toBe(symbolStyle("modern").previewShadowCss);
  });

  it("mana-font still draws `.ms-shadow` as the two layers the pickers keep (a card's pip takes no `ms-cost` class)", () => {
    const sheet = fs.readFileSync(path.join(process.cwd(), "node_modules/mana-font/css/mana.css"), "utf8");
    expect(/\.ms-cost\.ms-shadow \{([^}]*)\}/.exec(sheet)?.[1]).toMatch(/box-shadow:\s*-0\.06em 0\.07em 0 #111, 0 0\.06em 0 #111/);
    expect(/\.ms-cost\.ms-shadow\.ms-untap \{([^}]*)\}/.exec(sheet)?.[1]).toMatch(/#fff/);
  });
});

describe("a rules pip's glyph is the bake's share of its disc", () => {
  for (const template of ["m15", "modern", "split"] as FrameTemplate[]) {
    it(`${template}: one-colour symbols at manaGlyphPx, split discs at the bake's halves`, () => {
      const body = render(<CardPreview {...card(template)} />);
      const profile = getFrameProfile(template);
      const discPx = rulesDiscPx(body, template);
      const width = RULES_HD_WIDTH[profile.orientation === "landscape" ? "landscape" : "portrait"];
      const pips = rulesPips(body);
      expect(pips.length).toBeGreaterThanOrEqual(5);
      for (const pip of pips) {
        // The wrapper's font size is the layout's disc, in cqw.
        expect(css(pip.parentElement!, "font-size")).toBe(`${((discPx / width) * 100).toFixed(3)}cqw`);
        // Never mana-font's cost classes: their look is not the stored card's.
        expect(pip.className).not.toMatch(/ms-cost|ms-shadow/);
        if (pip.getAttribute("data-pip") === "wu") {
          const gem = manaGemSpec("wu", discPx, symbolStyle(profile.symbolStyle));
          if (gem.kind !== "split") throw new Error("a hybrid is a split disc");
          // A hybrid's disc is a plain pip's: one em of the row.
          expect(em(css(pip, "width"))).toBe(1);
          expect(em(css(pip, "height"))).toBe(1);
          const halves = Array.from(pip.children);
          expect(halves.map((h) => h.className)).toEqual(["ms ms-w", "ms ms-u"]);
          for (const half of halves) expect(pipFontPx(half, discPx)).toBeCloseTo(gem.halfPx, 1);
          continue;
        }
        const fontPx = pipFontPx(pip, discPx);
        // The untap arrow is 0.9 of its disc (layout v49), every other
        // symbol here mana-font's share.
        expect(fontPx).toBeCloseTo(pip.getAttribute("data-pip") === "untap" ? Math.round(discPx * 0.9) : manaGlyphPx(discPx), 1);
        // Its box exactly one disc, whatever the glyph's size.
        expect(em(css(pip, "width")) * fontPx).toBeCloseTo(discPx, 1);
        expect(em(css(pip, "height")) * fontPx).toBeCloseTo(discPx, 1);
        // mana-font's line box, in its own proportion to the disc.
        expect(em(css(pip, "line-height")) * fontPx).toBeCloseTo((discPx * 1.35) / 1.3, 1);
        expect(css(pip, "flex-shrink")).toBe("0");
      }
    });
  }

  it("CardPip draws the style's own {T} and an owner's image at one disc", () => {
    const tap = render(<CardPip suffix="tap" discPx={60} symbols={FLAT} />).querySelector("i")!;
    expect(tap.className).toBe("ms ms-tap-4ed");
    expect(tap.getAttribute("data-pip")).toBe("tap-4ed");
    const img = render(
      <CardPip suffix="g" discPx={60} symbols={symbolStyle("modern")} overrideSrc="https://pips.example/g.png" />,
    ).querySelector("img")!;
    expect(css(img, "width")).toBe("1.3em");
    expect(em(css(img.parentElement!, "font-size")) * 1.3).toBeCloseTo(1, 3);
  });
});
