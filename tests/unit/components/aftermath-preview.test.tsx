// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";

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
});
