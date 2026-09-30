// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { frameOverlayImageUrl, pickFrameColorKey } from "@/components/cards/frame-layer";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { M15_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.6a — the legendary crown in the LIVE PREVIEW on the real profiles,
// held to what the bake draws (tests/unit/render/crown-bake.test.tsx): for
// every parity case the preview paints the same band (the WebP twin of the
// bake's PNG), keyed the same, over the same rect — the top 410 / 2100 of
// the card — right after the frame master and under every text layer, and
// inside both finish masks; nothing at all where the bake draws nothing.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Kesh, Emberforge Warden",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: "Legendary",
    subtypes: ["Dwarf"],
    colorIdentity: ["white"],
    power: "3",
    toughness: "4",
    frameStyle: { template: "m15", finish: "regular", crown: true },
    brandMark: false,
    ...over,
  };
}

/** What the bake draws for `data` (the same rule: resolveFrameOverlays). */
function bakeOverlays(data: CardPreviewData) {
  const colors = data.colorIdentity as ColorIdentity[] | undefined;
  return resolveFrameOverlays(getFrameProfile(data.frameStyle?.template), data.frameStyle, {
    colors,
    cost: data.cost,
    cardType: data.cardType,
    supertype: data.supertype,
    colorKey: pickFrameColorKey(colors),
  });
}

const overlaysOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-frame-overlay]")];

const cases: Array<[string, Partial<CardPreviewData>, string]> = [
  ["mono white", {}, "w"],
  ["three colours: gold", { colorIdentity: ["white", "blue", "black"], cost: "{W}{U}{B}" }, "m"],
  ["a pair, drawn gold", { colorIdentity: ["white", "blue"], cost: "{1}{W}{U}" }, "m"],
  ["colourless m15: the see-through grey", { colorIdentity: ["colorless"], cost: "{10}" }, "c"],
  ["colourless artifact: silver", { cardType: "artifact", colorIdentity: ["colorless"], cost: "{5}", frameStyle: { template: "m15artifact", crown: true } }, "a"],
  ["blue artifact: its colour", { cardType: "artifact", colorIdentity: ["blue"], cost: "{1}{U}", frameStyle: { template: "m15artifact", crown: true } }, "u"],
  ["white land: its colour", { cardType: "land", cost: null, colorIdentity: ["white"], frameStyle: { template: "m15land", crown: true } }, "w"],
  ["colourless land: the land grey", { cardType: "land", cost: null, colorIdentity: ["colorless"], frameStyle: { template: "m15land", crown: true } }, "l"],
];

describe("the preview draws the bake's crown", () => {
  it.each(cases)("%s → the %s band, the bake's file and rect", (_label, over, key) => {
    const data = card(over);
    const [bake] = bakeOverlays(data);
    expect(bake).toMatchObject({ anatomy: "crown", key, path: `/frames/m15crown/${key}.png` });
    const { container } = render(<CardPreview {...data} />);
    const [crown, ...rest] = overlaysOf(container);
    expect(rest).toHaveLength(0);
    expect(crown.dataset.overlayKey).toBe(key);
    // The WebP twin of the PNG the bake reads (frameUrl: the bucket object).
    expect(crown.style.backgroundImage).toContain(frameOverlayImageUrl(bake.path));
    expect(frameOverlayImageUrl(bake.path)).toContain(`m15crown/${key}.`);
    // The same rect as the bake: the top 410 / 2100 of the card, full width.
    expect(crown.style.top).toBe("0%");
    expect(crown.style.left).toBe("0%");
    expect(crown.style.width).toBe("100%");
    expect(parseFloat(crown.style.height)).toBeCloseTo(M15_CROWN.rect.heightPct, 6);
    expect(bake.rect).toEqual(M15_CROWN.rect);
    // Right after the frame master, at its z-index: over it, under the text.
    const layer = crown.parentElement!;
    expect(container.querySelector("[data-frame-key]")!.nextElementSibling).toBe(layer);
    expect(layer.style.zIndex).toBe("5");
  });

  it("draws nothing where the bake draws nothing: absent, off, not Legendary, a planeswalker, a token, a frame without the crown", () => {
    for (const data of [
      card({ frameStyle: { template: "m15" } }),
      card({ frameStyle: { template: "m15", crown: false } }),
      card({ supertype: null }),
      card({ cardType: "planeswalker", loyalty: "3", frameStyle: { template: "m15pw", crown: true } }),
      card({ cardType: "token", frameStyle: { template: "m15token", crown: true } }),
      card({ frameStyle: { template: "m15snow", crown: true } }),
      card({ frameStyle: { template: "m15devoid", crown: true } }),
      card({ frameStyle: { template: "m15borderless", crown: true } }),
    ]) {
      expect(bakeOverlays(data), JSON.stringify(data.frameStyle)).toEqual([]);
      const { container } = render(<CardPreview {...data} />);
      expect(container.querySelector("[data-frame-overlays]"), JSON.stringify(data.frameStyle)).toBeNull();
      cleanup();
    }
  });

  it.each(["foil", "etched"] as const)("%s: the finish's mask holds the crown band over the bake's rect", (finish) => {
    const { container } = render(<CardPreview {...card({ frameStyle: { template: "m15", finish, crown: true } })} />);
    const band = [...container.querySelector("mask")!.querySelectorAll("image")].at(-1)!;
    expect(band.getAttribute("href")).toContain("m15crown/w.");
    expect(Number(band.getAttribute("width"))).toBe(1500);
    expect(Number(band.getAttribute("height"))).toBeCloseTo(410, 1);
  });
});
