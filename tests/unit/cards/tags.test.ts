import { describe, expect, it } from "vitest";
import { cardTagsSchema } from "@/lib/validation/card";

describe("cardTagsSchema", () => {
  it("lowercases, trims, and dedupes", () => {
    expect(cardTagsSchema.parse(["Dragons", " dragons ", "TOKENS"])).toEqual([
      "dragons",
      "tokens",
    ]);
  });

  it("strips disallowed characters but keeps spaces and hyphens", () => {
    expect(cardTagsSchema.parse(["d@ragon$!", "elder dragon", "co-op"])).toEqual([
      "dragon",
      "elder dragon",
      "co-op",
    ]);
  });

  it("caps at 12 tags", () => {
    const many = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    expect(cardTagsSchema.parse(many)).toHaveLength(12);
  });

  it("drops empty and overlong tags", () => {
    expect(cardTagsSchema.parse(["", "   ", "a".repeat(31)])).toEqual([]);
  });

  it("defaults to an empty array", () => {
    expect(cardTagsSchema.parse(undefined)).toEqual([]);
  });
});
