// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { frameOverlayImageUrl, pickFrameColorKey } from "@/components/cards/frame-layer";
import { resolveHoloStamp } from "@/lib/cards/anatomy";
import { HOLO_STAMP_OVAL_ART } from "@/lib/cards/holo-stamp-art";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.9c — the holofoil stamp in the LIVE PREVIEW on the real profiles,
// held to what the bake draws (tests/unit/render/holo-stamp-bake.test.tsx):
// the notch as a frame overlay (the WebP twin of the bake's PNG, keyed the
// same, over the slot's rect, inside both finish masks like the crown) and
// the oval as our bitmap over the stamp's art rect at z 7 — above the
// sheens (z 6), under the text; nothing at all where the bake draws
// nothing (absent, Never, Auto on a common, a token, an emblem, a pair
// master, a frame without the notch).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Kesh, Emberforge Warden",
    cost: "{2}{B}{B}",
    cardType: "creature",
    subtypes: ["Phyrexian", "Praetor"],
    rarity: "mythic",
    colorIdentity: ["black"],
    power: "4",
    toughness: "5",
    frameStyle: { template: "m15", finish: "regular", stamp: "auto" },
    brandMark: true,
    ...over,
  };
}

/** What the bake resolves for `data` (the same rule: resolveHoloStamp). */
function bakeStamp(data: CardPreviewData) {
  const colors = data.colorIdentity as ColorIdentity[] | undefined;
  return resolveHoloStamp(getFrameProfile(data.frameStyle?.template), data.frameStyle, {
    colors,
    cost: data.cost,
    cardType: data.cardType,
    supertype: data.supertype,
    rarity: data.rarity,
    colorKey: pickFrameColorKey(colors),
  });
}

const pct = (v: number) => `${v}%`;

const cases: Array<[string, Partial<CardPreviewData>, string]> = [
  ["mythic black on m15", {}, "m15holostamp/b"],
  ["rare gold", { rarity: "rare", colorIdentity: ["white", "blue", "black"], cost: "{W}{U}{B}" }, "m15holostamp/m"],
  ["colourless artifact: the silver notch", { cardType: "artifact", colorIdentity: ["colorless"], cost: "{5}", frameStyle: { template: "m15artifact", stamp: "auto" } }, "m15holostamp/a"],
  ["colourless land: the taupe notch", { cardType: "land", cost: null, colorIdentity: ["colorless"], frameStyle: { template: "m15land", stamp: "auto" } }, "m15holostamp/l"],
  ["devoid: the grey notch", { colorIdentity: ["red"], frameStyle: { template: "m15devoid", stamp: "auto" } }, "m15holostamp/c"],
  ["snow: its colour", { colorIdentity: ["green"], frameStyle: { template: "m15snow", stamp: "auto" } }, "m15holostamp/g"],
  ["Always on a common", { rarity: "common", frameStyle: { template: "m15", stamp: "oval" } }, "m15holostamp/b"],
  ["the walker's own piece", { cardType: "planeswalker", loyalty: "4", power: null, toughness: null, colorIdentity: ["colorless"], cost: "{4}", frameStyle: { template: "m15pw", stamp: "auto" } }, "m15pwholostamp/c"],
];

describe("the preview draws the bake's stamp", () => {
  it.each(cases)("%s: the notch overlay and the oval at the bake's rects", (_label, over, path) => {
    const data = card(over);
    const want = bakeStamp(data)!;
    expect(want.notch.path).toBe(`/frames/${path}.png`);
    const { container } = render(<CardPreview {...data} />);
    const notch = container.querySelector<HTMLElement>('[data-frame-overlay="holoStamp"]')!;
    expect(notch).not.toBeNull();
    expect(notch.getAttribute("data-overlay-key")).toBe(want.notch.key);
    expect(notch.style.backgroundImage).toBe(`url("${frameOverlayImageUrl(want.notch.path)}")`);
    expect(notch.style.top).toBe(pct(want.notch.rect.topPct));
    expect(notch.style.left).toBe(pct(want.notch.rect.leftPct));
    expect(notch.style.width).toBe(pct(want.notch.rect.widthPct));
    expect(notch.style.height).toBe(pct(want.notch.rect.heightPct));
    const oval = container.querySelector<HTMLElement>("[data-holo-stamp]")!;
    expect(oval).not.toBeNull();
    expect(oval.getAttribute("data-holo-stamp")).toBe("oval");
    expect(oval.getAttribute("data-stamp-key")).toBe(want.notch.key);
    expect(oval.style.backgroundImage).toBe(`url("${HOLO_STAMP_OVAL_ART.dataUri}")`);
    expect(oval.style.top).toBe(pct(want.artRect.topPct));
    expect(oval.style.left).toBe(pct(want.artRect.leftPct));
    expect(oval.style.width).toBe(pct(want.artRect.widthPct));
    expect(oval.style.height).toBe(pct(want.artRect.heightPct));
    // Above the sheens (z 6), under the text layers.
    expect(oval.style.zIndex).toBe("7");
  });

  it("the walker's oval sits 7 px higher than M15's", () => {
    const m15 = bakeStamp(card())!;
    const pw = bakeStamp(card({ cardType: "planeswalker", loyalty: "4", colorIdentity: ["white"], cost: "{3}{W}", frameStyle: { template: "m15pw", stamp: "auto" } }))!;
    expect(((m15.artRect.topPct - pw.artRect.topPct) / 100) * 2100).toBeCloseTo(7, 6);
  });

  it("draws nothing where the bake draws nothing", () => {
    for (const data of [
      card({ frameStyle: { template: "m15", finish: "regular" } }),
      card({ frameStyle: { template: "m15", finish: "regular", stamp: "none" } }),
      card({ rarity: "common" }),
      card({ rarity: "uncommon" }),
      card({ cardType: "token", frameStyle: { template: "m15token", stamp: "oval" } }),
      card({ cardType: "emblem", frameStyle: { template: "emblem", stamp: "oval" } }),
      card({ cardType: "token", frameStyle: { template: "m15", stamp: "oval" } }),
      card({ frameStyle: { template: "m15borderless", stamp: "oval" } }),
      card({ colorIdentity: ["white", "blue"], cost: "{W}{U}", frameStyle: { template: "m15", stamp: "oval", twoColor: true } }),
    ]) {
      expect(bakeStamp(data), JSON.stringify(data.frameStyle)).toBeNull();
      const { container } = render(<CardPreview {...data} />);
      expect(container.querySelector('[data-frame-overlay="holoStamp"]'), JSON.stringify(data.frameStyle)).toBeNull();
      expect(container.querySelector("[data-holo-stamp]"), JSON.stringify(data.frameStyle)).toBeNull();
      cleanup();
    }
  });

  it("the notch rides with the crown in one overlay layer, inside the finish masks", () => {
    const data = card({ supertype: "Legendary", frameStyle: { template: "m15", finish: "foil", crown: true, stamp: "auto" } });
    const { container } = render(<CardPreview {...data} />);
    const overlays = [...container.querySelectorAll<HTMLElement>("[data-frame-overlay]")].map((el) => el.getAttribute("data-frame-overlay"));
    expect(overlays).toEqual(["crown", "holoStamp"]);
    // Both images in the foil mask (the sheen lists them), the oval not.
    const sheen = container.querySelector("svg [data-foil-overlays], svg");
    expect(sheen).not.toBeNull();
    const masks = container.innerHTML;
    expect(masks).toContain(frameOverlayImageUrl("/frames/m15holostamp/b.png"));
    expect(masks).toContain(frameOverlayImageUrl("/frames/m15crown/b.png"));
    const oval = container.querySelector<HTMLElement>("[data-holo-stamp]")!;
    expect(oval.closest("svg")).toBeNull();
  });
});
