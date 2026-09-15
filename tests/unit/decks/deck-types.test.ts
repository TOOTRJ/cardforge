import { describe, expect, it } from "vitest";
import {
  COMMANDER_BRACKETS,
  DECK_TYPES,
  commanderBracket,
  deckTypeByKey,
  describeColors,
  randomDeckSeed,
} from "@/lib/decks/deck-types";

describe("deck types", () => {
  it("have unique keys and only valid colours", () => {
    const keys = new Set(DECK_TYPES.map((t) => t.key));
    expect(keys.size).toBe(DECK_TYPES.length);
    for (const t of DECK_TYPES) {
      for (const c of t.colors) expect(["W", "U", "B", "R", "G"]).toContain(c);
    }
  });

  it("steers Gorgons to black-green and Slivers to five colours", () => {
    expect(describeColors(deckTypeByKey("gorgons")!.colors)).toBe("black-green (B/G)");
    expect(describeColors(deckTypeByKey("slivers")!.colors)).toMatch(/all five/);
    expect(describeColors(deckTypeByKey("eldrazi")!.colors)).toBe("colourless");
    expect(deckTypeByKey("nope")).toBeNull();
  });

  it("exposes the five official Commander brackets in order", () => {
    expect(COMMANDER_BRACKETS.map((b) => `${b.level} ${b.name}`)).toEqual([
      "1 Exhibition",
      "2 Core",
      "3 Upgraded",
      "4 Optimized",
      "5 cEDH",
    ]);
    expect(commanderBracket(3)?.guidance).toMatch(/Bracket 3/);
    expect(commanderBracket(9)).toBeNull();
  });

  it("surprise-me picks deterministically from the lists", () => {
    const seed = randomDeckSeed(() => 0);
    expect(seed.deckType.key).toBe(DECK_TYPES[0].key);
    expect(seed.bracket.level).toBe(2);
    expect(seed.theme.length).toBeGreaterThan(5);
  });
});
