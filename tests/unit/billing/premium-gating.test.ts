import { describe, expect, it } from "vitest";
import {
  frameStyleRequiresPremium,
  isPremiumFinish,
  isPremiumFrameTemplate,
} from "@/types/card";

describe("premium finish gating", () => {
  it("keeps every finish free (owner decision, 2026-07-10)", () => {
    // The paid tease is premium custom frames (coming soon), not finishes.
    expect(isPremiumFinish("foil")).toBe(false);
    expect(isPremiumFinish("etched")).toBe(false);
    expect(isPremiumFinish("showcase")).toBe(false);
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
  it("is false for every finish and empty/null styles (no premium content ships yet)", () => {
    expect(frameStyleRequiresPremium({ finish: "foil" })).toBe(false);
    expect(frameStyleRequiresPremium({ finish: "showcase", template: "m15" })).toBe(
      false,
    );
    expect(frameStyleRequiresPremium({ finish: "regular", template: "lotr" })).toBe(
      false,
    );
    expect(frameStyleRequiresPremium({})).toBe(false);
    expect(frameStyleRequiresPremium(null)).toBe(false);
    expect(frameStyleRequiresPremium(undefined)).toBe(false);
  });
});
