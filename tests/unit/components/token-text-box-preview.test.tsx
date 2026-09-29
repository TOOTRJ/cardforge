// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { mainRulesLayout, rulesDraw } from "@/lib/cards/rules-box";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The preview half of TODO 4.49 (b)'s rules box: CardPreview draws the text-box
// token's ONE line centred — the same whole HD px of indent the bake draws
// (tests/unit/render/token-text-box-bake.test.tsx measures the bake), read off
// the one layout (rulesDraw) — and two or more lines from the left, with no
// scrim behind them. Read from the server markup (happy-dom drops the cqw
// lengths a live element's style would hold).
// ---------------------------------------------------------------------------

function lines(template: string, rulesText: string, power: string | null = "2") {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Knight"
      cardType="token"
      supertype="Creature"
      subtypes={["Knight"]}
      colorIdentity={["white"]}
      rulesText={rulesText}
      power={power}
      toughness={power}
      rarity="common"
      frameStyle={{ template: template as "m15tokentext" }}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return {
    html,
    lines: Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="rules-line"]')),
  };
}

const cqw = (px: number) => `${((px / RULES_HD_WIDTH.portrait) * 100).toFixed(3)}cqw`;
const marginLeft = (el: Element) => /(?:^|;)\s*margin-left:\s*([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1].trim() ?? "";

describe("CardPreview — the text-box token's rules (TODO 4.49 (b))", () => {
  it.each(["m15tokentext", "m15tokenartifacttext"])("%s: indents ONE line by the layout's HD px — the bake's", (template) => {
    const { lines: drawn } = lines(template, "Vigilance");
    expect(drawn).toHaveLength(1);
    const layout = mainRulesLayout({ layout: getFrameProfile(template), rulesText: "Vigilance", aspect: 7 / 5, show: { pt: true } });
    const block = rulesDraw(layout, "hd").blocks[0];
    const indent = block.kind === "blank" ? 0 : block.indents[0];
    expect(indent).toBeGreaterThan(400);
    expect(marginLeft(drawn[0])).toBe(cqw(indent));
  });

  it("draws two or more lines from the left, with no margin", () => {
    const { lines: drawn } = lines("m15tokentext", "Flying\nVigilance\nLifelink", null);
    expect(drawn).toHaveLength(3);
    for (const line of drawn) expect(marginLeft(line)).toBe("");
  });

  it("leaves a single line at the left on the textless token (no alignSingleLine)", () => {
    const { lines: drawn } = lines("m15token", "Vigilance");
    expect(drawn).toHaveLength(1);
    expect(marginLeft(drawn[0])).toBe("");
  });

  it.each(["m15tokentext", "m15tokenartifacttext"])(
    "%s: CC's symbol box moved up with the re-cut pill, and the textless token's print-moved P/T plate",
    (template) => {
      const p = getFrameProfile(template);
      // CC's setSymbolBounds (80.13 / 82.34 / 12 × 4.1: right edge 92.13 %W)
      // 292 px up with the band — centred on 70.48 %H, on the pill the
      // re-cut put onto the prints. NOT the textless token's print pass
      // (82.73 top): that moved the symbol down on CC's un-moved pill.
      expect(p.symbolRect).toEqual({ topPct: 82.34 - (292 / 2100) * 100, leftPct: 80.13, widthPct: 12, heightPct: 4.1 });
      expect(p.symbolRect!.topPct + p.symbolRect!.heightPct / 2).toBeCloseTo(70.485, 3);
      // The P/T: the textless token's slot as is — M15's value box, CC's
      // plate box 0.13 %H lower, where the text-box prints put it too.
      expect(p.pt!.plateRect).toEqual({ topPct: 88.61, leftPct: 75.73, widthPct: 18.8, heightPct: 7.33 });
      expect(p.pt!.plateRect).toEqual(getFrameProfile("m15token").pt!.plateRect);
      expect(p.pt!.rect).toEqual(getFrameProfile("m15").pt!.rect);
    },
  );

  it.each(["m15tokentext", "m15tokenartifacttext"])(
    "%s: the type band on its own re-cut pill — CC's band 292 px up, not the textless re-cut's",
    (template) => {
      const p = getFrameProfile(template);
      // CC's token band (82.14 %H, centred on CC's textless pill) moved 292
      // px up with this master's own re-cut (TOKEN_REGULAR_RECUT): centred on
      // the pill's interior, 1424–1530 px at HD. The textless masters' re-cut
      // (TOKEN_RECUT_PX: M15TOKEN's band 8 px lower, its dy 8 px higher) is
      // not this master's — spread from M15TOKEN, the band would sit 8 px
      // low in the pill.
      expect(p.type.rect).toEqual({ topPct: 82.14 - (292 / 2100) * 100, leftPct: 8.54, widthPct: 83.59, heightPct: 4.2 });
      const centre = ((p.type.rect.topPct + p.type.rect.heightPct / 2) / 100) * 2100;
      expect(Math.abs(centre - (1424 + 1530 + 1) / 2)).toBeLessThanOrEqual(0.5);
      expect(p.type.rect.topPct).toBeCloseTo(getFrameProfile("m15token").type.rect.topPct - ((292 + 8) / 2100) * 100, 9);
      // The text: the print pass's offset on CC's pill (+4 px at HD) and 8 px
      // higher to the prints' 1500 — which comes to M15TOKEN's dy (+4 px,
      // then its re-cut's 8 px pull-back). Spread from M15TOKEN it would be
      // 8 px higher still, on a band 8 px lower.
      expect(p.type.dy).toBeCloseTo(getFrameProfile("m15token").type.dy!, 12);
      // The art slot is its own (the window ends at 1408 px), not the
      // textless re-cut's taller one.
      expect(p.artSlot).toEqual({ topPct: 12.0, leftPct: 6.5, widthPct: 87, heightPct: 55.2 });
    },
  );

  it("draws no scrim behind the text-box token's rules (the textless token keeps its own)", () => {
    expect(getFrameProfile("m15tokentext").rules.backdropHex).toBeUndefined();
    expect(lines("m15tokentext", "Vigilance").html).not.toContain("rgba(10,8,6,0.5)");
    expect(lines("m15token", "Vigilance").html).toContain("rgba(10,8,6,0.5)");
  });
});
