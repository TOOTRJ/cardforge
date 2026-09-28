// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TextSlot.dy (TODO 4.20, layout v32) in the live preview: the front-face
// name and type line spans translate by dy in cqw (dy × the card's width,
// exactly), their bands, the pips (costDy) and the set symbol stay put. The
// bake half — the same move in whole px (Math.round(dy × width)) — is
// measured on a real bake in tests/unit/render/text-dy-bake.test.tsx. The
// shipped family profiles carry their own dy (tests/unit/cards/
// m15-text-sizes.test.ts pins them); here the m15 profile gets the dy each
// case needs through a wrapped getFrameProfile.
// ---------------------------------------------------------------------------

const slotDy = vi.hoisted(() => ({ title: undefined as number | undefined, type: undefined as number | undefined }));

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  return {
    ...real,
    getFrameProfile: (template?: string) => {
      const profile = real.getFrameProfile(template);
      return {
        ...profile,
        title: { ...profile.title, dy: slotDy.title },
        type: { ...profile.type, dy: slotDy.type },
      };
    },
  };
});

afterEach(() => {
  cleanup();
  slotDy.title = undefined;
  slotDy.type = undefined;
});

function renderProbe() {
  const { container } = render(
    <CardPreview
      title="Probe Name"
      cost="{W}"
      cardType="creature"
      subtypes={["Bear"]}
      colorIdentity={["white"]}
      power="2"
      toughness="2"
      frameStyle={{ template: "m15" }}
    />,
  );
  const p = getFrameProfile("m15");
  const name = container.querySelector('span[title="Probe Name"]') as HTMLElement;
  const titleBand = name.parentElement as HTMLElement;
  const typeBand = Array.from(container.querySelectorAll<HTMLElement>("div")).find(
    (div) => div.style.top === `${p.type.rect.topPct}%` && div.style.left === `${p.type.rect.leftPct}%`,
  ) as HTMLElement;
  const typeLine = typeBand.firstElementChild as HTMLElement;
  const cost = container.querySelector('[aria-label="Cost {W}"]') as HTMLElement;
  return { p, name, titleBand, typeBand, typeLine, cost };
}

describe("CardPreview — TextSlot.dy", () => {
  it("translates only the name and type line spans, by dy in cqw", () => {
    slotDy.title = 0.0107;
    slotDy.type = -0.0081;
    const { p, name, titleBand, typeBand, typeLine, cost } = renderProbe();
    expect(p.title.dy).toBe(0.0107);
    expect(typeLine.textContent).toMatch(/^Creature\s—\sBear$/);

    // dy is a fraction of the card WIDTH; cqw is 1 % of it.
    expect(name.style.transform).toBe("translateY(1.070cqw)");
    expect(typeLine.style.transform).toBe("translateY(-0.810cqw)");
    // The bands stay on their rects.
    expect(titleBand.style.top).toBe(`${p.title.rect.topPct}%`);
    expect(titleBand.style.transform).toBe("");
    expect(typeBand.style.transform).toBe("");
    // The pips keep costDy's nudge, the set symbol none of its own.
    expect(cost.style.transform).toBe(`translateY(${(p.costDy! * 100).toFixed(3)}cqw)`);
    const symbol = typeLine.nextElementSibling as HTMLElement;
    expect(symbol).not.toBeNull();
    expect(symbol.style.transform).toBe("");
  });

  it("leaves the spans untransformed when dy is unset or 0", () => {
    for (const dy of [undefined, 0]) {
      slotDy.title = dy;
      slotDy.type = dy;
      const { name, typeLine } = renderProbe();
      expect(name.style.transform).toBe("");
      expect(typeLine.style.transform).toBe("");
      cleanup();
    }
  });
});
