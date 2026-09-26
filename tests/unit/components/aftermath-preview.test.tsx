// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { secondFaceLineSizes } from "@/lib/cards/render-tiers";
import { RULES_TEXT, ptToPct } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The live-preview half of TODO 0.22: aftermath's bottom half turns 90°
// CLOCKWISE, like the printed Cut // Ribbons (it used to turn 270°). A
// clockwise quarter turn carries a band's start edge to the top, so the name
// (first in the band) reads top → bottom with its cost below it, and the
// sideways art turns with the text. The bake half is pinned on real bakes in
// tests/unit/render/aftermath-bake.test.ts.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("CardPreview — aftermath's second half", () => {
  it("turns the name band, its cost and the second art clockwise", () => {
    const second = getFrameProfile("aftermath").secondFace!;
    expect(second.rotation).toBe(90);
    const { container } = render(
      <CardPreview
        title="Cut"
        cost="{1}{R}"
        cardType="sorcery"
        colorIdentity={["red"]}
        rulesText="Cut deals 4 damage to target creature."
        artUrl="/art/top.png"
        frameStyle={{ template: "aftermath" }}
        backFace={{
          title: "Ribbons",
          cost: "{X}{B}{B}",
          card_type: "sorcery",
          rules_text: "Each opponent loses X life.",
          art_url: "/art/bottom.png",
        }}
      />,
    );

    const name = container.querySelector('span[title="Ribbons"]') as HTMLElement;
    const band = name.parentElement as HTMLElement;
    expect(band.style.transform).toBe("rotate(90deg)");
    expect(band.style.top).toBe(`${second.title.rect.topPct}%`);
    // Name first, cost last: turned clockwise, the name sits above the cost.
    expect(band.firstElementChild).toBe(name);
    expect(band.lastElementChild?.getAttribute("aria-label")).toBe("Cost {X}{B}{B}");

    const art = container.querySelector('img[src="/art/bottom.png"]') as HTMLElement;
    expect((art.parentElement as HTMLElement).style.transform).toBe("rotate(90deg)");
  });

  // The owner's answer (2026-09-25): the bottom half prints at the top half's
  // text sizes, like the printed Cut // Ribbons and Card Conjurer — which are
  // a regular M15 card's name / type / cost sizes, and the 9 pt rules start.
  it("shares one set of text sizes between the halves — M15's", () => {
    const layout = getFrameProfile("aftermath");
    const m15 = getFrameProfile("m15");
    const second = layout.secondFace!;
    expect(second.title.sizePct).toBe(layout.title.sizePct);
    expect(second.type.sizePct).toBe(layout.type.sizePct);
    expect(second.costSizePct).toBe(layout.costSizePct);
    expect(second.rules.sizePct).toBe(layout.rules.sizePct);
    expect(layout.title.sizePct).toBe(m15.title.sizePct);
    expect(layout.type.sizePct).toBe(m15.type.sizePct);
    expect(layout.costSizePct).toBe(m15.costSizePct);
    expect(layout.rules.sizePct).toBe(ptToPct(RULES_TEXT.standardPt));
  });

  // happy-dom drops `cqw` font sizes from element.style, so these read the
  // raw style attributes of the server markup.
  const markup = (ui: React.ReactElement) => {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(ui), "text/html");
    return doc.body;
  };
  const fontSize = (el: Element) => /font-size:([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1] ?? null;
  const turned = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement) if (/rotate\(/.test(e.getAttribute("style") ?? "")) return true;
    return false;
  };
  /** [top half, bottom half] of two matches — the bottom half's are turned. */
  const halves = (els: Element[]) => {
    expect(els).toHaveLength(2);
    expect(els.map(turned).sort()).toEqual([false, true]);
    return [...els].sort((a, b) => Number(turned(a)) - Number(turned(b)));
  };

  it("renders the same words at the same sizes on both halves", () => {
    const rules = "Draw two cards, then discard a card.";
    const body = markup(
      <CardPreview
        title="Memory"
        cost="{4}{U}{U}"
        cardType="sorcery"
        colorIdentity={["blue"]}
        rulesText={rules}
        frameStyle={{ template: "aftermath" }}
        backFace={{ title: "Memory", cost: "{4}{U}{U}", card_type: "sorcery", rules_text: rules }}
      />,
    );
    const spans = [...body.querySelectorAll("span")];
    const [topName, bottomName] = halves(spans.filter((el) => el.getAttribute("title") === "Memory")).map((el) => el.parentElement!);
    const [topType, bottomType] = halves(spans.filter((el) => el.textContent === "Sorcery")).map((el) => el.parentElement!);
    const [topCost, bottomCost] = halves([...body.querySelectorAll('[aria-label="Cost {4}{U}{U}"]')]);
    const [topRules, bottomRules] = halves(
      [...body.querySelectorAll("div")].filter(
        // RulesBody lays each word out as its own box, so match the letters.
        (el) =>
          /font-family:"MPlantin"/.test(el.getAttribute("style") ?? "") &&
          fontSize(el) &&
          el.textContent?.replace(/\s/g, "") === rules.replace(/\s/g, ""),
      ),
    );
    expect(fontSize(topName)).toBe("5.000cqw");
    expect(fontSize(bottomName)).toBe(fontSize(topName));
    expect(fontSize(topType)).toBe("4.350cqw");
    expect(fontSize(bottomType)).toBe(fontSize(topType));
    expect(fontSize(bottomCost)).toBe(fontSize(topCost));
    expect(fontSize(topRules)).toBe(`${(ptToPct(9) * 100).toFixed(3)}cqw`);
    expect(fontSize(bottomRules)).toBe(fontSize(topRules));
  });

  it("shrinks a long bottom name and type line to fit their bars (same math as the bake)", () => {
    const second = getFrameProfile("aftermath").secondFace!;
    const back = {
      title: "Glorious Retribution of the Scorched Sky",
      cost: "{3}{R}{R}",
      card_type: "sorcery" as const,
      supertype: "Legendary",
      subtypes: ["Arcane", "Lesson"],
      rules_text: "Draw a card.",
    };
    const typeLine = "Legendary Sorcery — Arcane Lesson";
    const body = markup(
      <CardPreview title="Probe" cost="{R}" cardType="instant" colorIdentity={["red"]} frameStyle={{ template: "aftermath" }} backFace={back} />,
    );
    const spans = [...body.querySelectorAll("span")];
    const name = spans.find((el) => el.getAttribute("title") === back.title)!.parentElement!;
    const type = spans.find((el) => el.textContent === typeLine)!.parentElement!;
    expect(turned(name) && turned(type)).toBe(true);
    const want = secondFaceLineSizes({ slot: second, name: back.title, typeLine, cost: back.cost });
    expect(want.titleSizePct).toBeLessThan(second.title.sizePct);
    expect(want.typeSizePct).toBeLessThan(second.type.sizePct);
    expect(fontSize(name)).toBe(`${(want.titleSizePct * 100).toFixed(3)}cqw`);
    expect(fontSize(type)).toBe(`${(want.typeSizePct * 100).toFixed(3)}cqw`);
  });
});
