// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { adventureRulesLayout, mainRulesLayout, rulesDraw, secondFaceRulesLayout, type DrawnStats } from "@/lib/cards/rules-box";
import type { RulesLayout } from "@/lib/cards/rules-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";
import type { FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// The preview half of TODO 4.21e: CardPreview draws a centred card's lines at
// the ONE layout's whole HD px of indent — the same px the bake draws
// (tests/unit/render/rules-align-bake.test.tsx measures the bake) — in every
// rules box of the card, and none with the switch left or absent. Read from
// the server markup (happy-dom drops the cqw lengths of a live element).
// ---------------------------------------------------------------------------

type Seed = {
  template: FrameStyle["template"];
  cardType: string;
  rulesText: string;
  flavorText?: string;
  power?: string;
  back?: { rules_text: string; power?: string; toughness?: string };
  show: DrawnStats;
};

const SEEDS: Record<string, Seed> = {
  m15: { template: "m15", cardType: "creature", rulesText: "Flying, vigilance\n{T}: Add {G}{G}.", flavorText: "Up, and away.", power: "2", show: { pt: true } },
  split: { template: "split", cardType: "instant", rulesText: "Discard a card, then draw two cards.", back: { rules_text: "Furious deals 3 damage to each creature without flying." }, show: {} },
  adventure: { template: "adventure", cardType: "creature", rulesText: "Whenever this creature attacks, draw a card.", power: "4", back: { rules_text: "Stomp deals 2 damage to any target." }, show: { pt: true } },
  flip: { template: "flip", cardType: "creature", rulesText: "Flying", power: "1", back: { rules_text: "Vigilance, lifelink", power: "3", toughness: "3" }, show: { pt: true, secondFacePt: true } },
  aftermath: { template: "aftermath", cardType: "sorcery", rulesText: "Draw two cards.", back: { rules_text: "Each opponent discards a card." }, show: {} },
  battle: { template: "battle", cardType: "battle", rulesText: "When this Siege enters, draw a card.", show: { defense: true } },
  emblem: { template: "emblem", cardType: "emblem", rulesText: "Creatures you control get +1/+1.\nAt the beginning of your upkeep, draw a card.", show: {} },
  m15tokentext: { template: "m15tokentext", cardType: "token", rulesText: "Flying\nVigilance", power: "2", show: { pt: true } },
};

function drawn(seed: Seed, rulesAlign?: "left" | "center") {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Probe"
      cardType={seed.cardType as "creature"}
      supertype={seed.cardType === "token" ? "Creature" : null}
      subtypes={[]}
      colorIdentity={seed.cardType === "emblem" ? [] : ["red"]}
      rulesText={seed.rulesText}
      flavorText={seed.flavorText ?? null}
      power={seed.power ?? null}
      toughness={seed.power ?? null}
      defense={seed.cardType === "battle" ? "5" : null}
      rarity="common"
      frameStyle={{ template: seed.template, ...(rulesAlign ? { rulesAlign } : {}) }}
      backFace={seed.back ? ({ title: "Back", card_type: "sorcery", ...seed.back } as never) : null}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="rules-line"]'));
}

const marginLeft = (el: Element) => /(?:^|;)\s*margin-left:\s*([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1].trim() ?? "";

/** Every rules box's indents (HD px) the layout gives the card, in the
 *  order the preview draws its boxes' lines: by line count they are matched
 *  as a multiset below (the DOM order of the boxes is the renderer's). */
function layoutIndents(seed: Seed, rulesAlign?: "left" | "center"): number[] {
  const layout = getFrameProfile(seed.template);
  const aspect = layout.orientation === "landscape" ? 5 / 7 : 7 / 5;
  const boxes: (RulesLayout | null)[] = [
    mainRulesLayout({ layout, rulesText: seed.rulesText, flavorText: seed.flavorText ?? null, aspect, show: seed.show, rulesAlign }),
    seed.back ? adventureRulesLayout({ layout, rulesText: seed.back.rules_text, aspect, show: seed.show, rulesAlign }) : null,
    seed.back ? secondFaceRulesLayout({ layout, rulesText: seed.back.rules_text, aspect, show: seed.show, rulesAlign }) : null,
  ];
  return boxes.flatMap((b) => (b ? rulesDraw(b, "hd").blocks.flatMap((blk) => (blk.kind === "blank" ? [] : blk.indents)) : []));
}

describe("CardPreview — a centred card's rules lines (TODO 4.21e)", () => {
  it.each(Object.entries(SEEDS))("%s: every line of every box indented by the layout's HD px", (_name, seed) => {
    const width = RULES_HD_WIDTH[getFrameProfile(seed.template).orientation === "landscape" ? "landscape" : "portrait"];
    const cqw = (px: number) => (px > 0 ? `${((px / width) * 100).toFixed(3)}cqw` : "");
    const lines = drawn(seed, "center");
    const indents = layoutIndents(seed, "center");
    expect(lines.length).toBe(indents.length);
    expect(indents.filter((i) => i > 0).length).toBeGreaterThanOrEqual(Math.min(2, indents.length));
    expect(lines.map(marginLeft).sort()).toEqual(indents.map(cqw).sort());
  });

  it.each(Object.entries(SEEDS))("%s: no margin with the switch left or absent — but the token's own single line", (_name, seed) => {
    for (const value of [undefined, "left"] as const) {
      const lines = drawn(seed, value);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(marginLeft(line)).toBe("");
    }
  });

  it("a frame without the choice ignores the key (a walker's text in the plain box)", () => {
    const html = renderToStaticMarkup(
      <CardPreview title="Probe" cardType="creature" subtypes={[]} colorIdentity={["red"]} rulesText="Flying" power="2" toughness="2" rarity="common" frameStyle={{ template: "m15pw", rulesAlign: "center" }} />,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const lines = Array.from(doc.querySelectorAll('[data-testid="rules-line"]'));
    expect(lines.length).toBe(1);
    expect(marginLeft(lines[0])).toBe("");
  });
});
