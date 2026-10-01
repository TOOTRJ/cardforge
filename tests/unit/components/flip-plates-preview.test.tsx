// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.21a, layout v38 — flip's P/T plates in the LIVE PREVIEW, held to
// what the bake draws (tests/unit/render/flip-plates-bake.test.tsx): the
// bottom creature's plate at its own box (secondFace.pt.plateRect), the
// bake's file for the card's plate key, UNTURNED (no transform: the source
// draws it upside-down, as the card prints it), before (under) the turned
// value; the top creature's plate as every M15 plate (StatOverlay); each
// only when its half has a P/T.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const flip = getFrameProfile("flip");
const BOTTOM = flip.secondFace!.pt!;

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Budoka Gardener",
    cost: "{1}{G}",
    cardType: "creature",
    subtypes: ["Human", "Monk"],
    colorIdentity: ["green"],
    power: "2",
    toughness: "1",
    frameStyle: { template: "flip", finish: "regular" },
    backFace: {
      title: "Dokai, Weaver of Life",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Human", "Monk"],
      power: "3",
      toughness: "3",
    },
    brandMark: false,
    ...over,
  } as unknown as CardPreviewData;
}

const platesOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLImageElement>("img.object-fill")];

describe("the preview draws the bake's flip plates", () => {
  it("the bottom creature's plate: the bake's file at its box, unturned, under its turned value", () => {
    const { container, getByText } = render(<CardPreview {...card()} />);
    const bottom = container.querySelectorAll<HTMLImageElement>("[data-testid='second-face-plate']");
    expect(bottom).toHaveLength(1);
    const plate = bottom[0];
    // The same file the bake preloads (frameAssetPathsFor): the green
    // bottom plate, through frameUrl (the bucket object).
    expect(plate.getAttribute("src")).toContain("flip/pt/g-bottom.");
    // At the profile's plate box, in percent, and never turned.
    expect(parseFloat(plate.style.top)).toBeCloseTo(BOTTOM.plateRect!.topPct, 6);
    expect(parseFloat(plate.style.left)).toBeCloseTo(BOTTOM.plateRect!.leftPct, 6);
    expect(parseFloat(plate.style.width)).toBeCloseTo(BOTTOM.plateRect!.widthPct, 6);
    expect(parseFloat(plate.style.height)).toBeCloseTo(BOTTOM.plateRect!.heightPct, 6);
    expect(plate.style.transform).toBe("");
    // The value turns with its face, and is drawn after (over) the plate.
    const value = getByText("3/3");
    const turned = value.closest<HTMLElement>("div[style*='rotate(180deg)']");
    expect(turned).not.toBeNull();
    expect(plate.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The top creature's plate too (StatOverlay's), its own file.
    const srcs = platesOf(container).map((img) => img.getAttribute("src") ?? "");
    expect(srcs.some((s) => s.includes("flip/pt/g-top."))).toBe(true);
  });

  it("a half with no P/T draws no plate", () => {
    const noBottom = render(
      <CardPreview {...card({ backFace: { title: "Dokai's Essence", card_type: "enchantment", subtypes: [] } } as never)} />,
    );
    expect(noBottom.container.querySelectorAll("[data-testid='second-face-plate']")).toHaveLength(0);
    expect(platesOf(noBottom.container).some((img) => (img.getAttribute("src") ?? "").includes("flip/pt/g-top."))).toBe(true);
    cleanup();
    const noTop = render(<CardPreview {...card({ power: null, toughness: null })} />);
    expect(noTop.container.querySelectorAll("[data-testid='second-face-plate']")).toHaveLength(1);
    expect(platesOf(noTop.container).some((img) => (img.getAttribute("src") ?? "").includes("flip/pt/g-top."))).toBe(false);
  });

  it("follows the card's plate key: a colourless flip draws the pack's colourless plates", () => {
    const { container } = render(<CardPreview {...card({ colorIdentity: ["colorless"], cost: "{3}" })} />);
    const plate = container.querySelector<HTMLImageElement>("[data-testid='second-face-plate']");
    expect(plate?.getAttribute("src")).toContain("flip/pt/c-bottom.");
  });
});
