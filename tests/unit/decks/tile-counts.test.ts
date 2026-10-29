import { describe, expect, it } from "vitest";
import { madeOnPipGlyph } from "@/lib/decks/tile-counts";

// The deck tiles' "made on PipGlyph" line (the "% proxied" replacement, TODO
// DK2.2) — off the stored counts (0143), never the entry rows.
describe("madeOnPipGlyph", () => {
  it("says the share in words", () => {
    expect(madeOnPipGlyph({ cards_count: 60, linked_count: 12 })).toEqual({
      made: 12,
      total: 60,
      pct: 20,
      label: "12 of 60 made on PipGlyph",
    });
  });

  it("an empty deck is 0 of 0, never NaN", () => {
    expect(madeOnPipGlyph({ cards_count: 0, linked_count: 0 })).toMatchObject({ pct: 0, label: "0 of 0 made on PipGlyph" });
  });

  it("never more made than there are cards, never below zero", () => {
    expect(madeOnPipGlyph({ cards_count: 3, linked_count: 9 })).toMatchObject({ made: 3, pct: 100 });
    expect(madeOnPipGlyph({ cards_count: -1, linked_count: -1 })).toMatchObject({ made: 0, total: 0, pct: 0 });
  });
});
