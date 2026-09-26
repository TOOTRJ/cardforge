// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The live-preview half of the planeswalker title bar (frame review round 4):
// the m15pw name and its detached mana cost sit lower in Card Conjurer's
// taller title plate — the name through its title rect, the pips through
// costDy inside the cost box. The bake half is pinned on a real bake in
// tests/unit/render/pw-cost-bake.test.tsx.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("CardPreview — m15pw title bar", () => {
  it("places the name in its lowered title rect and nudges the detached cost down by costDy", () => {
    const p = getFrameProfile("m15pw");
    const { container } = render(
      <CardPreview
        title="Probe Walker"
        cost="{2}{W}"
        cardType="planeswalker"
        colorIdentity={["white"]}
        loyalty="4"
        frameStyle={{ template: "m15pw" }}
      />,
    );

    const name = container.querySelector('span[title="Probe Walker"]') as HTMLElement;
    const band = name.parentElement as HTMLElement;
    expect(band.style.top).toBe(`${p.title.rect.topPct}%`);
    expect(band.style.top).toBe("4.18%");
    expect(band.style.alignItems).toBe("center");

    const cost = container.querySelector('[aria-label="Cost {2}{W}"]') as HTMLElement;
    // Its own box (costRect), not the name's band.
    expect(band.contains(cost)).toBe(false);
    const box = cost.parentElement as HTMLElement;
    expect(box.style.top).toBe(`${p.costRect!.topPct}%`);
    expect(box.style.justifyContent).toBe("flex-end");
    expect(p.costDy).toBe(0.004);
    expect(cost.style.transform).toBe(`translateY(${(p.costDy! * 100).toFixed(3)}cqw)`);
  });
});
