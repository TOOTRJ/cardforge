// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { fitStatSizePct } from "@/lib/cards/stat-fit";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The preview half of stat shrink-to-fit (TODO 3.18): StatOverlay and the
// flip card's second-face P/T print at the SAME fitStatSizePct() the bake's
// StatBake / SecondFaceBake use, on one line — the bake half is pinned on
// real bakes in tests/unit/render/stat-fit-bake.test.tsx. Read from the
// server markup: happy-dom drops `cqw` font sizes from element.style.
// ---------------------------------------------------------------------------

/** The preview's cqw() — `${pct × 100}cqw` to three decimals. */
const cqw = (pct: number) => `${(pct * 100).toFixed(3)}cqw`;

/** The inline style of the element whose whole text is `text`. */
function styleOf(html: string, text: string): Record<string, string> {
  const at = html.indexOf(`>${text}</`);
  expect(at, text).toBeGreaterThan(0);
  const open = html.lastIndexOf("<", at);
  const style = html.slice(open, at).match(/style="([^"]*)"/);
  expect(style, text).not.toBeNull();
  return Object.fromEntries(
    style![1]
      .split(";")
      .filter(Boolean)
      .map((decl) => {
        const i = decl.indexOf(":");
        return [decl.slice(0, i).trim(), decl.slice(i + 1).trim()];
      }),
  );
}

function statStyles(template: FrameTemplate, power: string, toughness: string, back?: { power: string; toughness: string }) {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Stat Probe"
      cardType="creature"
      colorIdentity={["blue"]}
      power={power}
      toughness={toughness}
      frameStyle={{ template }}
      backFace={back ? { title: "Probe Reborn", card_type: "creature", ...back } : null}
    />,
  );
  return {
    front: styleOf(html, `${power}/${toughness}`),
    back: back ? styleOf(html, `${back.power}/${back.toughness}`) : null,
  };
}

describe("preview stat sizes", () => {
  it("a value that fits keeps the profile size exactly (10/10 on M15 and Alpha)", () => {
    for (const template of ["m15", "agclassic"] as const) {
      const { front } = statStyles(template, "10", "10");
      expect(front["font-size"], template).toBe(cqw(getFrameProfile(template).pt!.sizePct));
      expect(front["white-space"], template).toBe("nowrap");
    }
  });

  it("Alpha *+1/*+1 shrinks to the bake's size, on one line, centred", () => {
    const slot = getFrameProfile("agclassic").pt!;
    const { front } = statStyles("agclassic", "*+1", "*+1");
    const size = fitStatSizePct(slot, "*+1/*+1");
    expect(size).toBeLessThan(slot.sizePct);
    expect(front["font-size"]).toBe(cqw(size));
    expect(front["white-space"]).toBe("nowrap");
    expect(front["flex-shrink"]).toBe("0");
  });

  it("a landscape Battle floors a runaway defense at the landscape hard floor", () => {
    const slot = getFrameProfile("battle").defense!;
    const defense = "9".repeat(16);
    const html = renderToStaticMarkup(
      <CardPreview
        title="Invasion of Probe"
        cardType="battle"
        subtypes={["Siege"]}
        colorIdentity={["red"]}
        defense={defense}
        frameStyle={{ template: "battle" }}
      />,
    );
    const landscape = fitStatSizePct(slot, defense, "landscape");
    expect(landscape).not.toBe(fitStatSizePct(slot, defense, "portrait"));
    expect(styleOf(html, defense)["font-size"]).toBe(cqw(landscape));
  });

  it("the flip card's upside-down second face shrinks 100/100 like SecondFaceBake", () => {
    const slot = getFrameProfile("flip").secondFace!.pt!;
    const { back } = statStyles("flip", "2", "2", { power: "100", toughness: "100" });
    const size = fitStatSizePct(slot, "100/100", "portrait", true);
    expect(size).toBeLessThan(slot.sizePct);
    expect(back!["font-size"]).toBe(cqw(size));
    expect(back!["white-space"]).toBe("nowrap");
  });
});
