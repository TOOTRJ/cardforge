import { describe, expect, it } from "vitest";
import { RESERVED_CARD_SLUGS, isReservedCardSlug, slugify } from "@/lib/validation/card";

describe("reserved card slugs", () => {
  it("treats route words as reserved, case-insensitively", () => {
    expect(isReservedCardSlug("edit")).toBe(true);
    expect(isReservedCardSlug("Edit")).toBe(true);
    expect(isReservedCardSlug("emberbound-wyrm")).toBe(false);
  });

  it("covers the editor segment that used to shadow a card", () => {
    expect(RESERVED_CARD_SLUGS.has("edit")).toBe(true);
    // A title of just "Edit" slugifies to the reserved word — the action's
    // uniqueness pass is what suffixes it.
    expect(slugify("Edit")).toBe("edit");
  });
});
