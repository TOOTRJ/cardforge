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

  it("draws no scrim behind the text-box token's rules (the textless token keeps its own)", () => {
    expect(getFrameProfile("m15tokentext").rules.backdropHex).toBeUndefined();
    expect(lines("m15tokentext", "Vigilance").html).not.toContain("rgba(10,8,6,0.5)");
    expect(lines("m15token", "Vigilance").html).toContain("rgba(10,8,6,0.5)");
  });
});
