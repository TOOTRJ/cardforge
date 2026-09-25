// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { FrameThumb } from "@/components/creator/frame-pickers";
import type { ColorIdentity, FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Two-colour Dragon Wing in the browser: the live preview draws the same two
// clipped halves as the bake (tests/unit/render/bake-dragon-split.test.ts),
// the etched sheen masks with both, and the creator's frame thumbnail shows
// the card's own split instead of the gold "m" frame.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

function preview(template: FrameTemplate, colorIdentity: ColorIdentity[], finish: "regular" | "etched" = "regular") {
  return render(
    <CardPreview
      title="Split Test"
      cardType="instant"
      colorIdentity={colorIdentity}
      frameStyle={{ template, finish }}
    />,
  ).container;
}

describe("FrameLayer — two-colour split", () => {
  it("draws Bar (black + white) as white wings left, black right, each half clipped", () => {
    const container = preview("tarkirdragon", ["black", "white"]);
    const left = container.querySelector<HTMLElement>('[data-frame-split="left"]');
    const right = container.querySelector<HTMLElement>('[data-frame-split="right"]');
    expect(left?.dataset.frameKey).toBe("w");
    expect(right?.dataset.frameKey).toBe("b");
    expect(left?.style.backgroundImage).toContain("/frames/tarkirdragon/w.webp");
    expect(right?.style.backgroundImage).toContain("/frames/tarkirdragon/b.webp");
    // The left half runs 1 px past the seam, under the right half.
    expect(left?.getAttribute("style")).toContain("clip-path: inset(0 calc(50% - 1px) 0 0)");
    expect(right?.getAttribute("style")).toContain("clip-path: inset(0 0 0 50%)");
    // One frame layer holding both halves; no gold frame underneath.
    expect(left?.parentElement).toBe(right?.parentElement);
    expect(container.innerHTML).not.toContain("/frames/tarkirdragon/m.webp");
  });

  it.each<[string, FrameTemplate, ColorIdentity[], string]>([
    ["multicolor", "tarkirdragon", ["multicolor"], "/frames/tarkirdragon/m.webp"],
    ["three colours", "tarkirdragon", ["white", "blue", "black"], "/frames/tarkirdragon/m.webp"],
    ["mono", "tarkirdragon", ["white"], "/frames/tarkirdragon/w.webp"],
    ["two colours on a frame without the split", "m15", ["black", "white"], "/frames/m15/m.webp"],
  ])("keeps one frame for %s", (_label, template, colors, url) => {
    const container = preview(template, colors);
    expect(container.querySelector("[data-frame-split]")).toBeNull();
    expect(container.innerHTML).toContain(url);
  });

  it("etched: the sheen's mask holds both halves", () => {
    const container = preview("tarkirdragon", ["black", "white"], "etched");
    const images = container.querySelectorAll("mask image");
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("href")).toContain("/frames/tarkirdragon/w.webp");
    expect(images[1].getAttribute("href")).toContain("/frames/tarkirdragon/b.webp");
    const leftClip = images[0].getAttribute("clip-path")?.match(/^url\(#(.+)\)$/)?.[1];
    const rightClip = images[1].getAttribute("clip-path")?.match(/^url\(#(.+)\)$/)?.[1];
    // Seam at 750 of the 1500-wide viewBox; the left half runs 2 units past it.
    expect(container.querySelector(`[id="${leftClip}"] rect`)?.getAttribute("width")).toBe("752");
    expect(container.querySelector(`[id="${rightClip}"] rect`)?.getAttribute("x")).toBe("750");
  });

  it("etched on a mono card keeps the single unclipped mask image", () => {
    const container = preview("tarkirdragon", ["white"], "etched");
    const images = container.querySelectorAll("mask image");
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute("clip-path")).toBeNull();
  });
});

describe("FrameThumb — creator frame tiles", () => {
  it("shows a two-colour card's own split on Dragon Wing", () => {
    const { container } = render(
      <FrameThumb template="tarkirdragon" colorKey="m" colorIdentity={["black", "white"]} />,
    );
    const keys = [...container.querySelectorAll<HTMLElement>("[data-frame-split]")].map((el) => el.dataset.frameKey);
    expect(keys).toEqual(["w", "b"]);
  });

  it("keeps the single frame when the tile shows another colour, or the frame has no split", () => {
    const other = render(
      <FrameThumb template="tarkirdragon" colorKey="w" colorIdentity={["black", "white"]} />,
    ).container;
    expect(other.querySelector("[data-frame-split]")).toBeNull();
    expect(other.innerHTML).toContain("/frames/tarkirdragon/w.webp");
    const m15 = render(<FrameThumb template="m15" colorKey="m" colorIdentity={["black", "white"]} />).container;
    expect(m15.querySelector("[data-frame-split]")).toBeNull();
    expect(m15.innerHTML).toContain("/frames/m15/m.webp");
  });
});
