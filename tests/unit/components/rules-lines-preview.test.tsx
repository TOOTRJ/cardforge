// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { mainRulesLayout, rulesDraw, secondFaceRulesLayout, type DrawnStats } from "@/lib/cards/rules-box";
import { wordWidthPx, type RulesLayout } from "@/lib/cards/rules-layout";
import { SPLIT_TEXTBOX_BORDER_PX, getFrameProfile } from "@/lib/cards/template-layout";
import { PLACEHOLDER_FLAVOR_TEXT, PLACEHOLDER_RULES_TEXT, RULES_HD_WIDTH } from "@/lib/cards/typography";
import type { FrameTemplate } from "@/types/card";
import { EOE_30, RULES_MATRIX, TLA_112, VOW_63 } from "@/tests/unit/cards/fixtures/rules-texts";

// ---------------------------------------------------------------------------
// The preview half of the v33 rules drawing (TODO 3.29): CardPreview draws
// the SAME lines lib/cards/rules-layout.ts lays out — the lines the bake
// draws (tests/unit/render/rules-no-clip.test.tsx holds Satori to them) —
// at the HD bake's px in cqw, and never lets the browser wrap: nowrap rows
// exactly a line box tall, nowrap words with the line box as their line
// height.
// ---------------------------------------------------------------------------

/** The server markup, parsed: its raw style attributes (happy-dom drops the
 *  cqw lengths a live element's style would hold). */
function render(ui: ReactElement) {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html");
  return { container: doc.body as HTMLElement, unmount: () => {} };
}

const cqwOf = (px: number, template: FrameTemplate) =>
  `${((px / RULES_HD_WIDTH[getFrameProfile(template).orientation === "landscape" ? "landscape" : "portrait"]) * 100).toFixed(3)}cqw`;

/** The layout's lines as the DOM shows them: each run's words and pips'
 *  text run together (pips draw no text; U+2212 as a hyphen). */
function expectedLines(layout: RulesLayout): string[] {
  return layout.blocks.flatMap((b) =>
    b.lines.map((l) =>
      l.runs.map((run) => run.map((item) => (item.t === "w" ? item.v.replace(/−/g, "-") : "")).join("")).join(""),
    ),
  );
}

const creature = (template: FrameTemplate, rulesText: string | null, flavorText: string | null = null): CardPreviewData => ({
  title: "Probe",
  cost: "{2}{W}",
  cardType: "creature",
  subtypes: ["Human"],
  colorIdentity: ["white"],
  rulesText,
  flavorText,
  power: "2",
  toughness: "3",
  frameStyle: { template },
});

/** One declaration of an element's inline style, as written (happy-dom
 *  doesn't parse cqw lengths into el.style). */
function css(el: Element, prop: string): string {
  const style = el.getAttribute("style") ?? "";
  return new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`).exec(style)?.[1].trim() ?? "";
}

function boxes(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="rules-box"]'));
}

function linesOf(box: HTMLElement) {
  return Array.from(box.querySelectorAll<HTMLElement>('[data-testid="rules-line"]'));
}

function expectDrawn(box: HTMLElement, layout: RulesLayout, template: FrameTemplate) {
  const d = rulesDraw(layout, "hd");
  expect(box.getAttribute("data-rules-size")).toBe(String(layout.sizePx));
  expect(css(box, "font-size")).toBe(cqwOf(d.fontPx, template));
  expect(css(box, "overflow")).toBe("hidden");
  const lines = linesOf(box);
  expect(lines.map((l) => l.textContent)).toEqual(expectedLines(layout));
  const model = layout.blocks.flatMap((b) => b.lines);
  lines.forEach((line, li) => {
    // A nowrap row exactly its line box tall, its runs never shrinking.
    expect(css(line, "height")).toBe(cqwOf(d.linePx, template));
    expect(css(line, "flex-wrap")).toBe("nowrap");
    Array.from(line.children).forEach((run, ri) => {
      expect(css(run, "flex-shrink")).toBe("0");
      Array.from(run.children).forEach((item, ii) => {
        expect(css(item, "flex-shrink")).toBe("0");
        const word = model[li].runs[ri][ii];
        const pip = item.querySelector("i.ms-cost");
        if (pip) {
          // A pip in a wrapper with no margin of its own (a pip gap is its
          // padding): mana-font's `.ms-2 { margin-left: inherit !important }`
          // would otherwise hand the {2} disc its run's word gap again.
          expect(word.t).toBe("m");
          expect(css(item, "margin-left")).toBe("");
          expect(css(pip, "margin-left")).toBe("");
          const gapBefore = ii > 0 && model[li].runs[ri][ii - 1].t === "m";
          expect(css(item, "padding-left")).toBe(gapBefore ? cqwOf(d.pipGapPx, template) : "");
        } else if (item.tagName === "SPAN" && !item.className) {
          expect(word.t).toBe("w");
          expect(css(item, "white-space")).toBe("nowrap");
          expect(css(item, "line-height")).toBe(cqwOf(d.linePx, template));
          // The word's ceiled box — the width Satori gives it — so every run
          // after it starts where the bake starts it (the browser would set
          // it at its exact advances: up to 9 HD px of drift along a line).
          if (word.t === "w") expect(css(item, "width")).toBe(cqwOf(wordWidthPx(word, d), template));
        }
      });
    });
  });
}

describe("CardPreview — rules lines", () => {
  const show = (t: FrameTemplate): DrawnStats => ({ pt: Boolean(getFrameProfile(t).pt) });

  for (const template of ["m15", "retro", "m15token", "lotr", "tarkirdragon"] as FrameTemplate[]) {
    it(`draws the layout's lines on ${template}, at the HD bake's px`, () => {
      const p = getFrameProfile(template);
      for (const text of RULES_MATRIX.filter((c) => !["1200 chars", "400 chars"].includes(c.name)).slice(0, 8)) {
        const { container, unmount } = render(<CardPreview {...creature(template, text.rules, text.flavor)} />);
        const [box] = boxes(container);
        const layout = mainRulesLayout({ layout: p, rulesText: text.rules, flavorText: text.flavor, aspect: 7 / 5, show: show(template) });
        expectDrawn(box, layout, template);
        unmount();
      }
    });
  }

  it("draws the print references line for line on M15 (the P/T plate a keep-out)", () => {
    for (const text of [EOE_30, TLA_112]) {
      const { container, unmount } = render(<CardPreview {...creature("m15", text)} />);
      const layout = mainRulesLayout({ layout: getFrameProfile("m15"), rulesText: text, aspect: 7 / 5, show: { pt: true } });
      expectDrawn(boxes(container)[0], layout, "m15");
      unmount();
    }
  });

  it("keeps the flavor bar a 1 CSS px line that advances the layout only 1 HD px, at any editor width", () => {
    const { container } = render(<CardPreview {...creature("m15", "Flying", "Wings of light.")} />);
    const layout = mainRulesLayout({ layout: getFrameProfile("m15"), rulesText: "Flying", flavorText: "Wings of light.", aspect: 7 / 5, show: { pt: true } });
    const flavor = rulesDraw(layout, "hd").blocks.find((b) => b.kind === "flavor")!;
    expect(flavor.kind === "flavor" && flavor.bar).toBeTruthy();
    const block = Array.from(boxes(container)[0].querySelectorAll<HTMLElement>("div")).find((el) => css(el, "border-top") !== "")!;
    expect(css(block, "border-top")).toMatch(/^1px solid /);
    if (flavor.kind === "flavor" && flavor.bar) {
      expect(css(block, "margin-top")).toBe(cqwOf(flavor.bar.above, "m15"));
      // below + the bar's 1 HD px, less the 1 CSS px the border draws.
      expect(css(block, "padding-top")).toBe(`calc(${cqwOf(flavor.bar.below + 1, "m15")} - 1px)`);
    }
  });

  it("draws U+2212 as the hyphen the bake draws", () => {
    const { container } = render(<CardPreview {...creature("m15", "−1: Target creature gets −2/−2.")} />);
    const text = boxes(container)[0].textContent ?? "";
    expect(text).not.toContain("−");
    expect(text).toContain("-2/-2");
  });

  it("sizes a landscape box on the 2100 px HD card", () => {
    const text = "When this Siege enters, search your library for a card. ".repeat(4);
    const { container } = render(
      <CardPreview title="Probe" cardType="battle" subtypes={["Siege"]} defense="5" rulesText={text} frameStyle={{ template: "battle" }} />,
    );
    const layout = mainRulesLayout({ layout: getFrameProfile("battle"), rulesText: text, aspect: 5 / 7, show: { defense: true } });
    expectDrawn(boxes(container)[0], layout, "battle");
  });

  it("keeps a plain-box walker's text out of its shield, like the bake", () => {
    const flavor = "A mind is a labyrinth, and I hold every key. ".repeat(9);
    const { container } = render(
      <CardPreview title="Probe" cardType="planeswalker" subtypes={["Jace"]} loyalty="4" flavorText={flavor} frameStyle={{ template: "m15pw" }} />,
    );
    const layout = mainRulesLayout({ layout: getFrameProfile("m15pw"), rulesText: null, flavorText: flavor, aspect: 7 / 5, show: { loyalty: true } });
    expect(layout.input.keepOuts).toHaveLength(1);
    expectDrawn(boxes(container)[0], layout, "m15pw");
  });

  it("shows the editor's sample in the real type, muted — never in the gallery", () => {
    const { container, unmount } = render(<CardPreview {...creature("m15", null)} staticInEditor />);
    const [box] = boxes(container);
    expect(css(box, "opacity")).toBe("0.5");
    expect(box.textContent?.replace(/\s/g, "")).toBe((PLACEHOLDER_RULES_TEXT + PLACEHOLDER_FLAVOR_TEXT).replace(/\s/g, ""));
    unmount();
    const gallery = render(<CardPreview {...creature("m15", null)} />);
    expect(boxes(gallery.container)).toHaveLength(0);
  });

  it("turns a second face's box in place, laid out in its own frame at its own alignment", () => {
    const back = { title: "Ribbons", cost: "{3}{B}", card_type: "sorcery" as const, rules_text: "Each opponent loses 3 life. You gain life equal to the life lost this way." };
    for (const [template, rotation, justify] of [
      ["aftermath", "rotate(90deg)", "center"],
      ["flip", "rotate(180deg)", "center"],
      ["split", "", "flex-start"],
    ] as const) {
      const { container, unmount } = render(
        <CardPreview {...creature(template, "Destroy target artifact.")} cardType="instant" backFace={back} />,
      );
      const p = getFrameProfile(template);
      const layout = secondFaceRulesLayout({ layout: p, rulesText: back.rules_text, aspect: p.orientation === "landscape" ? 5 / 7 : 7 / 5, show: {} })!;
      const box = boxes(container).find((b) => b.textContent?.startsWith("Each"))!;
      expect(box, template).toBeDefined();
      expect(css(box, "transform"), template).toBe(rotation);
      expect(css(box, "justify-content"), template).toBe(justify);
      expectDrawn(box, layout, template);
      unmount();
    }
  });

  it("pads both split halves past the frame's textbox border, as the bake does", () => {
    const back = { title: "Ribbons", cost: "{X}{B}{B}", card_type: "sorcery" as const, rules_text: "Aftermath (Cast this spell only from your graveyard. Then exile it.)" };
    const front = "(from your graveyard) Cut deals 4 damage to target creature.";
    const { container } = render(<CardPreview {...creature("split", front)} cardType="sorcery" backFace={back} />);
    const p = getFrameProfile("split");
    const halves = [
      [mainRulesLayout({ layout: p, rulesText: front, aspect: 5 / 7, show: {} }), "(from"],
      [secondFaceRulesLayout({ layout: p, rulesText: back.rules_text, aspect: 5 / 7, show: {} })!, "Aftermath"],
    ] as const;
    for (const [layout, first] of halves) {
      const box = boxes(container).find((b) => b.textContent?.startsWith(first))!;
      const d = rulesDraw(layout, "hd");
      // The first v33 cut padded 9 / 18 px from a box that holds the border.
      expect(d.pad.left, first).toBeGreaterThanOrEqual(SPLIT_TEXTBOX_BORDER_PX.left + 24);
      expect(d.pad.right, first).toBeGreaterThanOrEqual(SPLIT_TEXTBOX_BORDER_PX.right + 16);
      expect(css(box, "padding"), first).toBe(
        [d.pad.top, d.pad.right, d.pad.bottom, d.pad.left].map((px) => cqwOf(px, "split")).join(" "),
      );
      expectDrawn(box, layout, "split");
    }
  });

  it("keeps the vow-63 modal dash on its word, the bake's lines", () => {
    const { container } = render(<CardPreview {...creature("m15", VOW_63)} />);
    const layout = mainRulesLayout({ layout: getFrameProfile("m15"), rulesText: VOW_63, aspect: 7 / 5, show: { pt: true } });
    const [box] = boxes(container);
    expectDrawn(box, layout, "m15");
    const texts = linesOf(box).map((l) => l.textContent);
    // Word gaps are margins: "one —" reads "one—" in the DOM.
    expect(texts).toContain("one—");
    expect(texts).not.toContain("—");
  });

  it("mutes the editor's hint on an empty adventure page", () => {
    const { container } = render(
      <CardPreview {...creature("adventure", "Flying")} backFace={{ title: "Swift Strike", card_type: "instant", rules_text: "" }} staticInEditor />,
    );
    const hint = boxes(container).find((b) => b.textContent?.startsWith("Adventure"))!;
    expect(css(hint, "opacity")).toBe("0.55");
  });
});
