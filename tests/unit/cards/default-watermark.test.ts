import { describe, expect, it } from "vitest";
import {
  DEFAULT_WATERMARK_CARD_TYPES,
  defaultWatermarkFor,
  usesDefaultWatermark,
} from "@/lib/cards/watermark";

describe("default watermark rule (owner decision 2026-09-17)", () => {
  it("covers exactly creatures and the four spell/permanent types", () => {
    expect([...DEFAULT_WATERMARK_CARD_TYPES].sort()).toEqual(
      ["artifact", "creature", "enchantment", "instant", "sorcery"],
    );
    expect(usesDefaultWatermark("land")).toBe(false);
    expect(usesDefaultWatermark("planeswalker")).toBe(false);
    expect(usesDefaultWatermark(null)).toBe(false);
  });

  it("free accounts get the PipGlyph Rose, subscribers get nothing", () => {
    expect(defaultWatermarkFor("creature", false)).toEqual({
      kind: "preset",
      key: "pipglyph-rose",
      size: "normal",
    });
    expect(defaultWatermarkFor("creature", true)).toBeNull();
    expect(defaultWatermarkFor("land", false)).toBeNull();
  });
});
