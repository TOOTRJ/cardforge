import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/validation/card";

describe("slugify", () => {
  it("lowercases, folds diacritics and collapses runs to single hyphens", () => {
    expect(slugify("Café  Ünïcode — Wyrm!")).toBe("cafe-unicode-wyrm");
  });
  it("never leaves a trailing hyphen after the length cut", () => {
    expect(slugify("abc-def", 4)).toBe("abc");
  });
  it("uses the fallback when nothing survives — and an empty one when asked", () => {
    expect(slugify("!!!")).toBe("untitled-card");
    expect(slugify("!!!", 64, "")).toBe("");
  });
});
