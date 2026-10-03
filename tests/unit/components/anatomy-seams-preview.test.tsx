// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// TODO 4.6.0 — the anatomy seams in the LIVE PREVIEW, with the anatomy 4.6a
// / 4.6b will declare (tests/unit/cards/anatomy-fixture.ts). The crown band
// is an overlay layer right after the frame, at its z-index, drawn only
// when the card's switch is on and it qualifies; the two-colour look paints
// the pair master and (hybrid) the grey plate; both finish masks carry the
// overlay. The bake's twins: tests/unit/render/anatomy-seams-bake.test.tsx.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { declaredGetFrameProfile } = await import("../cards/anatomy-fixture");
  return { ...real, getFrameProfile: declaredGetFrameProfile(real.getFrameProfile) };
});

import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";

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

const overlaysOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>("[data-frame-overlay]")];

describe("the crown overlay layer", () => {
  it("draws the band right after the frame, at the frame's z-index, keyed by the card's colour", () => {
    const { container } = render(<CardPreview {...card()} />);
    const [crown, ...rest] = overlaysOf(container);
    expect(rest).toHaveLength(0);
    expect(crown.dataset.frameOverlay).toBe("crown");
    expect(crown.dataset.overlayKey).toBe("w");
    expect(crown.style.backgroundImage).toContain("/frames/m15crown/w.webp");
    expect(crown.style.height).toBe("19.52%");
    const layer = crown.parentElement!;
    expect(layer.style.zIndex).toBe("5");
    // In DOM order right after the frame master (same z-index: later = over).
    const frame = container.querySelector("[data-frame-key]")!;
    expect(frame.nextElementSibling).toBe(layer);
  });

  it("draws nothing — no element at all — with the switch absent or off, or on a card that doesn't qualify", () => {
    for (const data of [
      card({ frameStyle: { template: "m15" } }),
      card({ frameStyle: { template: "m15", crown: false } }),
      card({ supertype: null }),
      card({ supertype: "Lengendary" }),
      card({ cardType: "planeswalker", frameStyle: { template: "m15pw", crown: true } }),
      card({ frameStyle: { template: "m15devoid", crown: true } }),
    ]) {
      const { container } = render(<CardPreview {...data} />);
      expect(container.querySelector("[data-frame-overlays]"), JSON.stringify(data.frameStyle)).toBeNull();
      cleanup();
    }
  });

  it("keys a colourless artifact's crown to the silver, a land's to the land grey, a gold card's to gold", () => {
    const keyOf = (data: CardPreviewData) => {
      const { container } = render(<CardPreview {...data} />);
      const key = overlaysOf(container)[0]?.dataset.overlayKey;
      cleanup();
      return key;
    };
    expect(keyOf(card({ cardType: "artifact", colorIdentity: ["colorless"], frameStyle: { template: "m15artifact", crown: true } }))).toBe("a");
    expect(keyOf(card({ cardType: "land", cost: null, colorIdentity: ["colorless"], frameStyle: { template: "m15land", crown: true } }))).toBe("l");
    expect(keyOf(card({ colorIdentity: ["white", "blue", "black"] }))).toBe("m");
    expect(keyOf(card({ colorIdentity: ["white", "blue"], cost: "{1}{W}{U}" }))).toBe("m");
  });
});

describe("the two-colour look", () => {
  it("paints the pair master and keys the crown to the pair with the switch on", () => {
    const { container } = render(
      <CardPreview
        {...card({ colorIdentity: ["blue", "white"], cost: "{1}{W}{U}", frameStyle: { template: "m15", crown: true, twoColor: true } })}
      />,
    );
    expect(container.querySelector("[data-frame-key]")?.getAttribute("data-frame-key")).toBe("wu");
    expect(overlaysOf(container)[0].dataset.overlayKey).toBe("wu");
  });

  it("stays the gold master with the switch absent — a stored pair keeps its look", () => {
    const { container } = render(
      <CardPreview {...card({ colorIdentity: ["white", "black"], cost: "{1}{W}{B}", frameStyle: { template: "m15" } })} />,
    );
    expect(container.querySelector("[data-frame-key]")?.getAttribute("data-frame-key")).toBe("m");
  });

  it("a hybrid cost paints the hybrid master and the grey plate", () => {
    const { container } = render(
      <CardPreview
        {...card({ supertype: null, colorIdentity: ["green", "white"], cost: "{G/W}{G/W}", frameStyle: { template: "m15", twoColor: true } })}
      />,
    );
    expect(container.querySelector("[data-frame-key]")?.getAttribute("data-frame-key")).toBe("gw-h");
    const plates = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
    expect(plates.some((src) => src.includes("/frames/m15/pt/c."))).toBe(true);
    expect(plates.some((src) => src.includes("/frames/m15/pt/m."))).toBe(false);
  });
});

describe("the finishes mask the overlay with the frame", () => {
  it.each(["foil", "etched"] as const)("%s: the mask holds the frame, then the crown band over its rect", (finish) => {
    const { container } = render(<CardPreview {...card({ frameStyle: { template: "m15", finish, crown: true } })} />);
    const mask = container.querySelector("mask")!;
    const images = [...mask.querySelectorAll("image")].map((img) => img.getAttribute("href") ?? "");
    expect(images.at(-1)).toContain("/frames/m15crown/w.webp");
    const band = [...mask.querySelectorAll("image")].at(-1)!;
    expect(Number(band.getAttribute("height"))).toBeCloseTo(2100 * 0.1952, 1);
    expect(Number(band.getAttribute("width"))).toBe(1500);
  });

  it.each(["foil", "etched"] as const)("%s: no overlay image when the card draws none", (finish) => {
    const { container } = render(<CardPreview {...card({ frameStyle: { template: "m15", finish } })} />);
    const images = [...container.querySelector("mask")!.querySelectorAll("image")].map((img) => img.getAttribute("href") ?? "");
    expect(images.some((href) => href.includes("m15crown"))).toBe(false);
  });
});
