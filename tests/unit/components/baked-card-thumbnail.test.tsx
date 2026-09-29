// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// A real bake URL: our storage host, the card-renders bucket. Anything else
// is not drawn (see "only our own bakes" below).
const HOST = "https://auth.pipglyph.com";
const RENDERS = `${HOST}/storage/v1/object/public/card-renders/owner-1`;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", HOST);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const classes = (el: Element | null) => new Set((el?.getAttribute("class") ?? "").split(/\s+/));

function tile(template: string, urls: { thumb?: string | null; png?: string } = {}) {
  const previewData = { title: "Probe", frameStyle: { template } } as CardPreviewData;
  const { container } = render(
    <BakedCardThumbnail
      renderedImageUrl={urls.png ?? `${RENDERS}/probe.png?v=1`}
      renderedThumbUrl={urls.thumb === undefined ? `${RENDERS}/probe.thumb.webp?v=1` : urls.thumb}
      title="Probe"
      previewData={previewData}
    />,
  );
  const outer = container.firstElementChild as HTMLElement;
  const img = container.querySelector("img") as HTMLImageElement;
  return { outer, img, container };
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

// Migration 0126 lets only the service role point a card at a render, but a
// row written before it (when an owner could PATCH rendered_image_url /
// rendered_thumb_url through PostgREST) could hold any picture — a raw <img>
// of an outside host is a viewer-IP tracking pixel and an unmoderated,
// unwatermarked image in every public listing.
describe("BakedCardThumbnail draws only our own bakes", () => {
  const imgSrcs = (container: HTMLElement) =>
    [...container.querySelectorAll("img")].map((el) => el.getAttribute("src") ?? "");

  it("the thumb goes through the /render-cdn proxy", () => {
    const { img } = tile("m15");
    expect(img.getAttribute("src")).toBe("/render-cdn/owner-1/probe.thumb.webp?v=1");
  });

  it.each([
    ["an outside host", "https://tracker.example/pixel.png"],
    ["another storage project", "https://evil.supabase.co/storage/v1/object/public/card-renders/owner-1/probe.png"],
    ["a raw card-art upload", `${HOST}/storage/v1/object/public/card-art/owner-1/upload.png`],
    ["a relative path", "/renders/probe.png"],
  ])("a PNG URL on %s is no render: the live preview, nothing fetched from it", (_label, png) => {
    const { container } = tile("m15", { png, thumb: png });
    expect(imgSrcs(container).some((src) => src.includes(new URL(png, "https://x.test").pathname))).toBe(false);
    expect(container.querySelector(".card-corners.border")).toBeNull();
  });

  it("a thumb that isn't ours is skipped for the (ours) PNG through next/image", () => {
    const { container } = tile("m15", { thumb: "https://tracker.example/pixel.webp" });
    const srcs = imgSrcs(container);
    expect(srcs.some((src) => src.includes("tracker.example"))).toBe(false);
    expect(srcs.some((src) => decodeURIComponent(src).includes("card-renders/owner-1/probe.png"))).toBe(true);
  });
});
