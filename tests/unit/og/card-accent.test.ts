import { describe, expect, it } from "vitest";
import { cardAccentColor } from "@/lib/og/card-accent";
import { BRAND, MANA_HEX } from "@/lib/brand/constants";

// REGRESSION: cards.color_identity holds identity words ("red"), but the
// composite tested them against MANA_HEX's letter keys — so every card's
// social-card accent (and Discord's embed bar) came out colorless grey.
describe("cardAccentColor", () => {
  it("maps a mono-colored card's identity word to its mana color", () => {
    expect(cardAccentColor(["red"])).toBe(MANA_HEX.R);
    expect(cardAccentColor(["white"])).toBe(MANA_HEX.W);
  });
  it("is gold for multicolor — the stored value or two+ colors", () => {
    expect(cardAccentColor(["multicolor"])).toBe(BRAND.gold);
    expect(cardAccentColor(["blue", "black"])).toBe(BRAND.gold);
  });
  it("is neutral for colorless and empty identities", () => {
    expect(cardAccentColor([])).toBe(MANA_HEX.C);
    expect(cardAccentColor(["colorless"])).toBe(MANA_HEX.C);
  });
  it("still accepts WUBRG letters", () => {
    expect(cardAccentColor(["G"])).toBe(MANA_HEX.G);
  });
});
