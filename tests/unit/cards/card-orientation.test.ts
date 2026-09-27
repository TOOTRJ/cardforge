import { describe, expect, it } from "vitest";
import { cardCornersClass, isLandscapeFrame } from "@/lib/cards/card-orientation";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

describe("isLandscapeFrame", () => {
  it("is true exactly for the 7:5 profiles", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      expect(isLandscapeFrame({ template }), template).toBe(
        getFrameProfile(template).orientation === "landscape",
      );
    }
    expect(isLandscapeFrame({ template: "battle" })).toBe(true);
    expect(isLandscapeFrame({ template: "split", finish: "foil" })).toBe(true);
  });

  it("falls back to the portrait default for anything that isn't a known template", () => {
    for (const value of [null, undefined, {}, "battle", 42, { template: 7 }, { template: "nope" }]) {
      expect(isLandscapeFrame(value)).toBe(false);
    }
  });
});

describe("cardCornersClass", () => {
  it("picks the pair that is circular on the box", () => {
    expect(cardCornersClass(false)).toBe("card-corners");
    expect(cardCornersClass(true)).toBe("card-corners-landscape");
  });
});
