// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { frameOverlayImageUrl, pickFrameColorKey } from "@/components/cards/frame-layer";
import { resolveFrameOverlays } from "@/lib/cards/anatomy";
import { M20_TOKEN_CROWN, getFrameProfile } from "@/lib/cards/template-layout";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.48's crown in the LIVE PREVIEW on the real profiles, held to what
// the bake draws (tests/unit/render/m20-token-anatomy-bake.test.tsx; the
// pair masters and plates are in the shared two-colour table,
// tests/unit/render/two-colour-cases.ts): the same band (the WebP twin of
// the bake's PNG), keyed the same, over the same rect — rows 0–259 of the
// card — right after the frame master; nothing where the bake draws nothing.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function token(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Scion of the Deep",
    cost: null,
    cardType: "token",
    supertype: "Legendary Creature",
    subtypes: ["Octopus"],
    colorIdentity: ["blue"],
    power: "8",
    toughness: "8",
    frameStyle: { template: "m20token", finish: "regular", crown: true },
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

describe("the preview draws the bake's full-art token crown", () => {
  it.each([
    ["blue, textless", {}, "u"],
    ["white, the regular box", { colorIdentity: ["white"], rulesText: "Flying", frameStyle: { template: "m20tokentext", crown: true } }, "w"],
    ["red, the tall box", { colorIdentity: ["red"], rulesText: "Flying", frameStyle: { template: "m20tokentall", crown: true } }, "r"],
    ["three colours: gold", { colorIdentity: ["white", "blue", "black"], frameStyle: { template: "m20token", crown: true } }, "m"],
    ["a pair drawn gold", { colorIdentity: ["green", "white"], frameStyle: { template: "m20token", crown: true } }, "m"],
    ["a pair drawn as its pair", { colorIdentity: ["green", "white"], frameStyle: { template: "m20tokentext", crown: true, twoColor: true } }, "gw"],
    ["colourless: CC's grey crown", { colorIdentity: ["colorless"], frameStyle: { template: "m20token", crown: true } }, "c"],
    ["colourless artifact: the silver A crown", { colorIdentity: ["colorless"], supertype: "Legendary Artifact", power: null, toughness: null, frameStyle: { template: "m20tokenartifacttext", crown: true } }, "a"],
    ["blue artifact: its colour", { colorIdentity: ["blue"], supertype: "Legendary Artifact Creature", frameStyle: { template: "m20tokenartifact", crown: true } }, "u"],
  ] as Array<[string, Partial<CardPreviewData>, string]>)("%s → the %s band at the band's slot", (_label, over, key) => {
    const data = token(over);
    const [bake] = bakeOverlays(data);
    expect(bake).toMatchObject({ anatomy: "crown", key, path: `/frames/m20tokencrown/${key}.png`, rect: M20_TOKEN_CROWN.rect });
    const { container } = render(<CardPreview {...data} />);
    const [crown, ...rest] = overlaysOf(container);
    expect(rest).toHaveLength(0);
    expect(crown.dataset.overlayKey).toBe(key);
    expect(crown.style.backgroundImage).toContain(frameOverlayImageUrl(bake.path));
    expect(parseFloat(crown.style.top)).toBeCloseTo(0, 6);
    expect(parseFloat(crown.style.height)).toBeCloseTo((260 / 2100) * 100, 6);
    expect(container.querySelector("[data-frame-key]")!.nextElementSibling).toBe(crown.parentElement);
  });

  it("draws nothing where the bake draws nothing: absent (every stored token), off, not Legendary, the 2014–19 arch", () => {
    for (const data of [
      token({ frameStyle: { template: "m20token" } }),
      token({ frameStyle: { template: "m20token", crown: false } }),
      token({ supertype: "Creature" }),
      token({ colorIdentity: ["white"], frameStyle: { template: "m15token", crown: true } }),
      token({ colorIdentity: ["white"], rulesText: "Flying", frameStyle: { template: "m15tokentext", crown: true } }),
    ]) {
      expect(bakeOverlays(data), JSON.stringify(data.frameStyle)).toEqual([]);
      const { container } = render(<CardPreview {...data} />);
      expect(container.querySelector("[data-frame-overlays]"), JSON.stringify(data.frameStyle)).toBeNull();
      cleanup();
    }
  });
});
