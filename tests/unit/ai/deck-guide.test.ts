import { describe, expect, it } from "vitest";
import { deckGuideCardLines, deckGuideSchema } from "@/lib/ai/deck-guide";

describe("deckGuideCardLines", () => {
  it("writes one compact line per card with board, cost, type and trimmed rules", () => {
    const lines = deckGuideCardLines([
      { quantity: 1, board: "commander", name: "Stone Matriarch", type_line: "Legendary Creature — Gorgon", mana_cost: "{2}{B}{G}", rules_text: "Deathtouch\n\nWhenever a creature blocks, destroy it." },
      { quantity: 4, board: "main", name: "Forest", type_line: "Basic Land — Forest", mana_cost: null, rules_text: null },
    ]).split("\n");
    expect(lines[0]).toBe("1x Stone Matriarch — [commander] — {2}{B}{G} — Legendary Creature — Gorgon — Deathtouch Whenever a creature blocks, destroy it.");
    expect(lines[1]).toBe("4x Forest — Basic Land — Forest");
  });

  it("caps the list so a 100-card deck fits the prompt", () => {
    const cards = Array.from({ length: 200 }, (_, i) => ({ quantity: 1, board: "main", name: `Card ${i}`, type_line: null, mana_cost: null, rules_text: null }));
    expect(deckGuideCardLines(cards).split("\n")).toHaveLength(130);
  });
});

describe("deckGuideSchema", () => {
  it("trims and clamps every text field and keeps combos structured", () => {
    const parsed = deckGuideSchema.parse({
      overview: "  Grind them out.  ",
      game_plan: ["Ramp.", "Deploy.", "Win."],
      mulligan: "Two lands.",
      combos: [{ cards: ["A", "B"], description: "x".repeat(900) }],
      weaknesses: "Wipes.",
      key_cards: ["A"],
    });
    expect(parsed.overview).toBe("Grind them out.");
    expect(parsed.combos[0].description).toHaveLength(400);
  });

  it("rejects a combo with a single card", () => {
    expect(() =>
      deckGuideSchema.parse({ overview: "x", game_plan: ["a", "b", "c"], mulligan: "m", combos: [{ cards: ["A"], description: "d" }], weaknesses: "w", key_cards: [] }),
    ).toThrow();
  });
});
