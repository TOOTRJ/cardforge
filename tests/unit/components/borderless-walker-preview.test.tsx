// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { frameUrl } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// The live-preview half of the borderless planeswalkers (TODO 4.33): the same
// profile the bake draws — the full-bleed art box, Card Conjurer's neutral
// row stripes, the loyalty value on the master's own shield (loyalty/), and
// the tall template's type slot 138 HD px higher. The bake half, with
// pixels, is tests/unit/render/borderless-walker-bake.test.tsx.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const expectRect = (el: HTMLElement, rect: Rect) => {
  expect(parseFloat(el.style.top)).toBeCloseTo(rect.topPct, 6);
  expect(parseFloat(el.style.left)).toBeCloseTo(rect.leftPct, 6);
  expect(parseFloat(el.style.width)).toBeCloseTo(rect.widthPct, 6);
  expect(parseFloat(el.style.height)).toBeCloseTo(rect.heightPct, 6);
};

const walker = (template: string) => (
  <CardPreview
    title="Teferi, Master of Time"
    cost="{2}{U}{U}"
    cardType="planeswalker"
    supertype="Legendary"
    subtypes={["Teferi"]}
    colorIdentity={["blue"]}
    loyalty="3"
    rulesText={"+1: Draw a card, then discard a card.\n−3: Target creature you don't control phases out.\n−10: Take two extra turns after this one."}
    frameStyle={{ template: template as never }}
  />
);

describe("CardPreview — the borderless planeswalkers (4.33)", () => {
  for (const template of ["m15borderlesspw", "m15borderlesspwtall"] as const) {
    it(`${template}: full-bleed art, the neutral light stripes, and the master's own shield`, () => {
      const { container } = render(walker(template));
      const profile = getFrameProfile(template);
      expect(profile.artSlot).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: 91.53 });
      const shield = Array.from(container.querySelectorAll("img")).find(
        (i) => i.getAttribute("src") === frameUrl(`/frames/${template}/loyalty/u.png`),
      ) as HTMLImageElement;
      expect(shield).toBeTruthy();
      expectRect(shield, profile.loyalty!.plateRect!);
      const html = container.innerHTML.replace(/,\s*/g, ",");
      expect(html).toContain("rgba(255,255,255,0.608)");
      expect(html).toContain("rgba(164,164,164,0.706)");
      // m15pw's cream stripes are the bordered frame's alone.
      expect(html).not.toContain("rgba(244,238,226,0.78)");
    });
  }

  // Owner round 15 (2026-09-29): a walker with NO ability text shows the
  // light first stripe in its window, never the bare art — the bake's twin
  // (borderless-walker-bake.test.tsx). The editor keeps its hint rows there.
  const STRIPE_A = "rgba(255,255,255,0.608)";
  const backdropsOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>("div")).filter(
      (el) => el.style.background.replace(/,\s*/g, ",") === STRIPE_A && el.style.zIndex === "9",
    );
  const emptyWalker = (template: string, staticInEditor = false) => (
    <CardPreview
      title="Teferi, Master of Time"
      cost="{2}{U}{U}"
      cardType="planeswalker"
      supertype="Legendary"
      subtypes={["Teferi"]}
      colorIdentity={["blue"]}
      loyalty="3"
      rulesText=""
      staticInEditor={staticInEditor}
      frameStyle={{ template: template as never }}
    />
  );
  for (const template of ["m15borderlesspw", "m15borderlesspwtall"] as const) {
    it(`${template}: a walker with no ability text fills its window with the light first stripe`, () => {
      const { container } = render(emptyWalker(template));
      const fills = backdropsOf(container);
      expect(fills).toHaveLength(1);
      expectRect(fills[0], getFrameProfile(template).rules.rect);
    });

    it(`${template}: the editor shows its hint rows there instead, with no fill under them`, () => {
      const { container } = render(emptyWalker(template, true));
      expect(backdropsOf(container)).toHaveLength(0);
      // The hint rows' stripes (both of them) are there.
      const html = container.innerHTML.replace(/,\s*/g, ",");
      expect(html).toContain(STRIPE_A);
      expect(html).toContain("rgba(164,164,164,0.706)");
    });

    it(`${template}: a walker WITH abilities draws its rows and no fill under them`, () => {
      const { container } = render(walker(template));
      expect(backdropsOf(container)).toHaveLength(0);
    });
  }

  it("leaves the bordered m15pw as it was: no fill in an empty window (the rule is the borderless walkers')", () => {
    const { container } = render(emptyWalker("m15pw"));
    const cream = Array.from(container.querySelectorAll<HTMLElement>("div")).filter(
      (el) => el.style.zIndex === "9" && el.style.background.startsWith("rgba"),
    );
    expect(cream).toHaveLength(0);
  });

  it("draws the tall one's type slot, set symbol and rows 138 HD px higher, the title where it was", () => {
    const regular = getFrameProfile("m15borderlesspw");
    const tall = getFrameProfile("m15borderlesspwtall");
    const shift = (138 / 2100) * 100;
    expect(regular.type.rect.topPct - tall.type.rect.topPct).toBeCloseTo(shift, 9);
    expect(regular.symbolRect!.topPct - tall.symbolRect!.topPct).toBeCloseTo(shift, 9);
    expect(regular.rules.rect.topPct - tall.rules.rect.topPct).toBeCloseTo(shift, 9);
    // The rows' box ends where it did (on the shield's row), so it grows.
    expect(tall.rules.rect.topPct + tall.rules.rect.heightPct).toBeCloseTo(
      regular.rules.rect.topPct + regular.rules.rect.heightPct,
      9,
    );
    expect(tall.title).toEqual(regular.title);
    expect(tall.loyalty!.plateRect).toEqual(regular.loyalty!.plateRect);
  });

  it("is m15pw's anatomy: the rail, the rows' ceiling, the detached cost and the type slot", () => {
    const pw = getFrameProfile("m15pw");
    const bl = getFrameProfile("m15borderlesspw");
    expect(bl.title).toEqual(pw.title);
    expect(bl.type).toEqual(pw.type);
    expect(bl.costRect).toEqual(pw.costRect);
    expect(bl.symbolRect).toEqual(pw.symbolRect);
    expect(bl.footer).toEqual(pw.footer);
    expect(bl.rules.rect).toEqual(pw.rules.rect);
    expect(bl.loyaltyRows!.maxSizePct).toBe(pw.loyaltyRows!.maxSizePct);
    expect({ ...bl.loyalty, plateAssetPathTemplate: undefined }).toEqual({ ...pw.loyalty, plateAssetPathTemplate: undefined });
  });
});
