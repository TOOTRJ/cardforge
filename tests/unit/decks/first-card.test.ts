import { describe, expect, it } from "vitest";
import { firstCardBoard, isLegendaryCreature } from "@/lib/decks/first-card";
import { formatHasCommander } from "@/lib/decks/format-rules";
import { DECK_FORMAT_VALUES } from "@/types/deck";

// ---------------------------------------------------------------------------
// "Build a deck around this card" (TODO DK8.3): a legendary creature starts
// a Commander, Brawl or Standard Brawl deck in its commander zone; every
// other card, and every other format, starts on the main board.
// ---------------------------------------------------------------------------

const card = (card_type: string | null, supertype: string | null) => ({ card_type, supertype });

describe("isLegendaryCreature — what the card IS (card_type + supertype)", () => {
  it.each([
    [card("creature", "Legendary"), true],
    [card("creature", "Legendary Snow"), true],
    [card("creature", "legendary"), true],
    // "Legendary Artifact Creature" saved with the artifact as its type.
    [card("artifact", "Legendary Creature"), true],
    [card("enchantment", "Legendary Creature"), true],
    [card("creature", null), false],
    [card("creature", "Snow"), false],
    [card("artifact", "Legendary"), false],
    [card("planeswalker", "Legendary"), false],
    [card("token", "Legendary Creature"), false],
    [card("emblem", "Legendary Creature"), false],
    [card(null, null), false],
  ])("%j → %s", (facts, expected) => {
    expect(isLegendaryCreature(facts)).toBe(expected);
  });
});

describe("firstCardBoard", () => {
  const legend = card("creature", "Legendary");

  it("the commander zone in every commander format but Oathbreaker", () => {
    for (const format of DECK_FORMAT_VALUES) {
      const expected = formatHasCommander(format) && format !== "oathbreaker" ? "commander" : "main";
      expect(firstCardBoard(format, legend), format).toBe(expected);
    }
  });

  it("anything else is the main board", () => {
    expect(firstCardBoard("commander", card("creature", null))).toBe("main");
    expect(firstCardBoard("commander", card("instant", "Legendary"))).toBe("main");
    expect(firstCardBoard("oathbreaker", card("planeswalker", "Legendary"))).toBe("main");
  });
});
