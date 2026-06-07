import { describe, expect, it } from "vitest";
import {
  frameStyleRequiresPremium,
  isPremiumFinish,
  isPremiumFrameTemplate,
} from "@/types/card";

describe("premium finish gating", () => {
  it("flags our own premium finishes", () => {
    expect(isPremiumFinish("foil")).toBe(true);
    expect(isPremiumFinish("etched")).toBe(true);
    expect(isPremiumFinish("showcase")).toBe(true);
  });

  it("keeps regular + borderless free", () => {
    expect(isPremiumFinish("regular")).toBe(false);
    expect(isPremiumFinish("borderless")).toBe(false);
    expect(isPremiumFinish(null)).toBe(false);
    expect(isPremiumFinish(undefined)).toBe(false);
  });
});

describe("premium frame gating (IP-safe)", () => {
  it("NEVER gates WotC-derived frame trade dress", () => {
    // Hard rule: no WotC frame is ever paywalled.
    for (const template of [
      "m15",
      "agclassic",
      "lotr",
      "avatar",
      "bloomburrow",
      "tarkirdragon",
    ] as const) {
      expect(isPremiumFrameTemplate(template)).toBe(false);
    }
  });
});

describe("frameStyleRequiresPremium", () => {
  it("is true when the finish is premium", () => {
    expect(frameStyleRequiresPremium({ finish: "foil" })).toBe(true);
    expect(frameStyleRequiresPremium({ finish: "showcase", template: "m15" })).toBe(
      true,
    );
  });

  it("is false for free finishes/frames and empty/null styles", () => {
    expect(frameStyleRequiresPremium({ finish: "regular", template: "lotr" })).toBe(
      false,
    );
    expect(frameStyleRequiresPremium({})).toBe(false);
    expect(frameStyleRequiresPremium(null)).toBe(false);
    expect(frameStyleRequiresPremium(undefined)).toBe(false);
  });
});
