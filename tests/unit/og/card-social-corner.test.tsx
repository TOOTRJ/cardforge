import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cardCornerRadiusPx } from "@/lib/cards/card-corner";
import {
  renderCardSocialImage,
  socialCardBox,
  socialCardCornerRadius,
} from "@/lib/og/card-social";

// ---------------------------------------------------------------------------
// TODO 3.26 — the og:image social composite draws the card at the ONE card
// corner: 4.3 % of the box's SHORT side, rounded to 18 px in BOTH
// orientations (0.043 × width would be 25 px on the 590 × 421 landscape box;
// it used to be a fixed 22 px, rounder than the card).
// ---------------------------------------------------------------------------

describe("socialCardCornerRadius", () => {
  it("is round(4.3 % of the short side) = 18 px, portrait and landscape", () => {
    for (const landscape of [false, true]) {
      const box = socialCardBox(landscape);
      expect(socialCardCornerRadius(landscape)).toBe(
        Math.round(cardCornerRadiusPx(box.width, box.height)),
      );
      expect(socialCardCornerRadius(landscape)).toBe(18);
    }
  });

  it("keeps the old 22 px over a pre-v31 SQUARE bake until the sweep re-bakes it", () => {
    for (const landscape of [false, true]) expect(socialCardCornerRadius(landscape, true)).toBe(22);
  });

  it("sits within half a pixel of the bake's arc on the 421 × 590 / 590 × 421 boxes", () => {
    expect(socialCardBox(false)).toEqual({ width: 421, height: 590 });
    expect(socialCardBox(true)).toEqual({ width: 590, height: 421 });
    for (const landscape of [false, true]) {
      const box = socialCardBox(landscape);
      expect(
        Math.abs(socialCardCornerRadius(landscape) - cardCornerRadiusPx(box.width, box.height)),
      ).toBeLessThan(0.5);
    }
  });
});

describe("the composite's card corner, in pixels", () => {
  it("clips a white card at 18 px (not 22)", async () => {
    const white = await sharp({
      create: { width: 750, height: 1050, channels: 3, background: "#ffffff" },
    })
      .png()
      .toBuffer();
    const res = renderCardSocialImage({
      title: "Probe",
      typeLine: "Creature",
      creatorHandle: null,
      cardImageDataUri: `data:image/png;base64,${white.toString("base64")}`,
      accent: "#335577",
    });
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const o = (y * info.width + x) * info.channels;
      return [data[o], data[o + 1], data[o + 2]];
    };
    const isWhite = (x: number, y: number) => px(x, y).every((v) => v >= 250);

    // Find the card box from the white pixels on its middle row / column.
    const midY = Math.round(info.height / 2);
    let x0 = -1;
    for (let x = 0; x < info.width && x0 < 0; x += 1) if (isWhite(x, midY)) x0 = x;
    const midX = x0 + Math.round(socialCardBox(false).width / 2);
    let y0 = -1;
    for (let y = 0; y < info.height && y0 < 0; y += 1) if (isWhite(midX, y)) y0 = y;
    expect([x0, y0]).toEqual([1200 - 64 - socialCardBox(false).width, 20]);

    // Outside any card corner: the page, not the card.
    expect(isWhite(x0, y0)).toBe(false);
    expect(isWhite(x0 + 3, y0 + 3)).toBe(false);
    // (x0+7, y0+4): inside an 18 px arc (d = −0.9 px), outside a 22 px one.
    expect(isWhite(x0 + 7, y0 + 4)).toBe(true);
    // The straight edges are untouched just past the arc's tangent points.
    expect(isWhite(x0 + 19, y0)).toBe(true);
    expect(isWhite(x0, y0 + 19)).toBe(true);
  }, 60_000);
});
