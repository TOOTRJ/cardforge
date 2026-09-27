// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import type { CardPreviewData } from "@/components/cards/card-preview";

// ---------------------------------------------------------------------------
// TODO 3.26 — the gallery tile's corners. A v31 bake has transparent rounded
// corners, so the tile must (a) put the card's #101015 directly behind the
// image, never the page colour (a pale rim showed in LIGHT theme where the
// tile's clip inside its 1 px border is a hair tighter than the image's arc),
// and (b) round a LANDSCAPE card's own corners in a 7:5 inner box, not the
// empty 5:7 letterbox (so pre-v31 square battle bakes round too).
// ---------------------------------------------------------------------------

afterEach(cleanup);

const classes = (el: Element | null) => new Set((el?.getAttribute("class") ?? "").split(/\s+/));

function tile(template: string, urls: { thumb?: string | null; png?: string } = {}) {
  const previewData = { title: "Probe", frameStyle: { template } } as CardPreviewData;
  const { container } = render(
    <BakedCardThumbnail
      renderedImageUrl={urls.png ?? "/renders/probe.png"}
      renderedThumbUrl={urls.thumb === undefined ? "/renders/probe.thumb.webp" : urls.thumb}
      title="Probe"
      previewData={previewData}
    />,
  );
  const outer = container.firstElementChild as HTMLElement;
  const img = container.querySelector("img") as HTMLImageElement;
  return { outer, img };
}

describe("BakedCardThumbnail corners", () => {
  it("portrait: the 5:7 tile is the card box and the image sits on #101015", () => {
    const { outer, img } = tile("m15");
    const o = classes(outer);
    for (const c of ["aspect-[5/7]", "overflow-hidden", "card-corners", "border", "bg-background"]) {
      expect(o.has(c), c).toBe(true);
    }
    expect(img.parentElement).toBe(outer);
    const i = classes(img);
    expect(i.has("bg-[#101015]")).toBe(true);
    expect(i.has("object-cover")).toBe(true);
    expect(outer.querySelector(".card-corners-landscape")).toBeNull();
  });

  it("portrait without a thumb (the HD PNG through next/image) keeps the backdrop", () => {
    const { img } = tile("modern", { thumb: null });
    expect(classes(img).has("bg-[#101015]")).toBe(true);
    expect(classes(img).has("object-cover")).toBe(true);
  });

  it.each(["battle", "split"])(
    "landscape (%s): the card gets its own centred 7:5 box with the landscape corner",
    (template) => {
      const { outer, img } = tile(template);
      // The 5:7 grid tile stays (grid alignment, letterbox), centring the card.
      const o = classes(outer);
      for (const c of ["aspect-[5/7]", "card-corners", "flex", "items-center"]) {
        expect(o.has(c), c).toBe(true);
      }
      const box = img.parentElement as HTMLElement;
      expect(box).not.toBe(outer);
      expect(box.parentElement).toBe(outer);
      const b = classes(box);
      for (const c of ["relative", "aspect-[7/5]", "w-full", "overflow-hidden", "card-corners-landscape"]) {
        expect(b.has(c), c).toBe(true);
      }
      // Never the portrait pair on a 7:5 box (a 90 × 46 px ellipse at HD).
      expect(b.has("card-corners")).toBe(false);
      const i = classes(img);
      expect(i.has("bg-[#101015]")).toBe(true);
      expect(i.has("object-cover")).toBe(true);
      expect(i.has("object-contain")).toBe(false);
    },
  );

  it("landscape without a thumb puts the next/image fill inside the 7:5 box too", () => {
    const { outer, img } = tile("battle", { thumb: null });
    const box = img.parentElement as HTMLElement;
    expect(box.parentElement).toBe(outer);
    expect(classes(box).has("card-corners-landscape")).toBe(true);
    expect(classes(img).has("bg-[#101015]")).toBe(true);
  });
});
