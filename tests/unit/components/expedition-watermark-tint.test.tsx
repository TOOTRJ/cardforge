// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { watermarkInk } from "@/lib/cards/watermark";
import type { FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.11 wave 1: a two-colour Expedition's watermark tints with the master
// its frame paints — the plain land `c` (frame_style.plainLandMaster) — not
// the gold card's neutral ink. The bake's twin is pinned by the visual case
// `expeditionland/wu/land-long@plain-land-watermark` (tests/visual/matrix.ts).
// ---------------------------------------------------------------------------

afterEach(cleanup);

const norm = (css: string) => css.replace(/\s+/g, "").toLowerCase();
const rgbOf = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
};

function watermarkColour(template: string, frameStyle: Partial<FrameStyle>): string | null {
  const { container } = render(
    <CardPreview
      title="Flooded Strand"
      cardType="land"
      colorIdentity={["multicolor"]}
      rulesText="{T}, Pay 1 life, Sacrifice this land: Search your library for a Plains or Island card."
      frameStyle={{ template, finish: "regular", ...frameStyle } as FrameStyle}
      watermark={{ kind: "mana", key: "u" }}
    />,
  );
  const mark = container.querySelector<HTMLElement>("i.ms.ms-u");
  return mark ? norm(mark.style.color) : null;
}

describe("the watermark of a two-colour Expedition (TODO 4.11)", () => {
  const C = [norm(watermarkInk("c")), rgbOf(watermarkInk("c"))];
  const GOLD = [norm(watermarkInk("m")), rgbOf(watermarkInk("m"))];

  for (const template of ["expeditionland", "expeditionlandbfz"]) {
    it(`${template}: tints with the plain land master c it paints`, () => {
      expect(C).toContain(watermarkColour(template, { plainLandMaster: true }));
    });
    it(`${template}: without the key, the gold card's neutral ink, as before`, () => {
      expect(GOLD).toContain(watermarkColour(template, {}));
    });
  }

  it("the key changes nothing on a frame without the stand-in", () => {
    expect(GOLD).toContain(watermarkColour("m15land", { plainLandMaster: true }));
  });
});
