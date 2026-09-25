// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// The browser half of frames plan 4.2: once a template's assets are in the
// frames bucket, the live preview must draw the SAME objects the bake reads —
// the frame background from the WebP object, the P/T plate's <source> from
// the plate's WebP object and its <img> fallback from the PNG object (each
// variant has its own hash).
// ---------------------------------------------------------------------------

const hash = (c: string) => c.repeat(12);
const entry = (c: string) => ({ hash: hash(c), sha256: c.repeat(64), bytes: 1, width: 1, height: 1 });
const MANIFEST: FrameManifest = {
  version: 1,
  bucket: "frames",
  files: {
    "m15/u.png": entry("1"),
    "m15/u.webp": entry("2"),
    "m15/pt/u.png": entry("3"),
    "m15/pt/u.webp": entry("4"),
  },
};

let restore: () => void = () => {};
afterEach(() => {
  restore();
  cleanup();
});

describe("CardPreview — bucket-hosted frames", () => {
  it("draws the frame and the P/T plate from their bucket objects", () => {
    restore = setFrameStorageForTests({ manifest: MANIFEST, origin: "https://b.example/frames" });
    const { container } = render(
      <CardPreview
        title="Bucket Test"
        cardType="creature"
        colorIdentity={["blue"]}
        power="2"
        toughness="3"
        frameStyle={{ template: "m15" }}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain("https://b.example/frames/m15/u.222222222222.webp");
    const source = container.querySelector('source[type="image/webp"]');
    expect(source?.getAttribute("srcset")).toBe("https://b.example/frames/m15/pt/u.444444444444.webp");
    const img = source?.parentElement?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://b.example/frames/m15/pt/u.333333333333.png");
    expect(html).not.toContain("/frames/m15/u.webp");
  });
});
