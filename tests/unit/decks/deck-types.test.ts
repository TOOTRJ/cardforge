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

  // Wizards' rules (2025-02-11 checklists; 2025-10-21 removed the tutor
  // limits and set the turns; 2026-02-09 changed no bracket rule): the AI is
  // told the Game Changer caps and never a tutor limit the brackets dropped.
  it("tells the AI the brackets' current rules", () => {
    const guidance = (level: number) => commanderBracket(level)!.guidance;
    expect(guidance(1)).toMatch(/No Game Changers/);
    expect(guidance(2)).toMatch(/No Game Changers/);
    expect(guidance(3)).toMatch(/At most three Game Changers \(the commander counts\)/);
    expect(guidance(4)).toMatch(/any Game Changers/);
    for (const level of [1, 2, 3]) expect(guidance(level)).toMatch(/no mass land denial/i);
    expect(guidance(1)).toMatch(/no extra-turn cards/);
    for (const level of [2, 3]) expect(guidance(level)).toMatch(/extra-turn cards only in low numbers, never chained or looped/);
    expect(guidance(1)).toMatch(/nine or more turns/);
    expect(guidance(2)).toMatch(/eight or more turns/);
    expect(guidance(3)).toMatch(/six or more turns/);
    for (const b of COMMANDER_BRACKETS) {
      expect(b.guidance).not.toMatch(/tutors? only|no tutors|narrow (tutors|ones)/i);
      expect(b.guidance).not.toMatch(/precon/i);
    }
    expect(commanderBracket(2)!.blurb).not.toMatch(/precon/i);
  });

  it("surprise-me picks deterministically from the lists", () => {
    const seed = randomDeckSeed(() => 0);
    expect(seed.deckType.key).toBe(DECK_TYPES[0].key);
    expect(seed.bracket.level).toBe(2);
    expect(seed.theme.length).toBeGreaterThan(5);
  });
});
