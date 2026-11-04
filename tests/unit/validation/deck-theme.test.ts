import { describe, expect, it } from "vitest";
import { deckSlugFromUrl, deckThemeSchema } from "@/lib/validation/deck-theme";

// "Featured themed decks" (migration 0167): the admin's theme form and the
// deck link it pastes. The schema mirrors deck_themes' CHECKs.

describe("deckSlugFromUrl", () => {
  it.each([
    ["https://www.pipglyph.com/deck/ember-wyrm-tribal", "ember-wyrm-tribal"],
    ["/deck/Ember-Wyrm-Tribal/", "ember-wyrm-tribal"],
    ["https://www.pipglyph.com/deck/ember-wyrm-tribal?face=back#entry-1", "ember-wyrm-tribal"],
    ["ember-wyrm-tribal", "ember-wyrm-tribal"],
  ])("%s → %s", (input, slug) => {
    expect(deckSlugFromUrl(input)).toBe(slug);
  });

  it.each(["", "/card/someone/a-card", "/deck/", "not a slug!", "/deck/a--b"])("%s → null", (input) => {
    expect(deckSlugFromUrl(input)).toBeNull();
  });
});

describe("deckThemeSchema", () => {
  it("trims, and an empty blurb is no blurb", () => {
    expect(deckThemeSchema.parse({ title: "  Dragons  ", blurb: "   " })).toEqual({ title: "Dragons", blurb: null });
    expect(deckThemeSchema.parse({ title: "Dragons" })).toEqual({ title: "Dragons", blurb: null });
  });

  it("refuses an empty title and the over-long ones", () => {
    expect(deckThemeSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(deckThemeSchema.safeParse({ title: "x".repeat(61) }).success).toBe(false);
    expect(deckThemeSchema.safeParse({ title: "ok", blurb: "x".repeat(161) }).success).toBe(false);
    expect(deckThemeSchema.safeParse({ title: "x".repeat(60), blurb: "x".repeat(160) }).success).toBe(true);
  });
});
