import { describe, expect, it } from "vitest";
import * as sampleHand from "@/lib/decks/sample-hand";
import { drawCard, entryIdOfKey, libraryKeys, openingHand, seededRandom, shuffle } from "@/lib/decks/sample-hand";

// ---------------------------------------------------------------------------
// The sample hand (TODO DK7.2): a seeded shuffle, the opening seven and a
// card at a time. No mulligan (owner 2026-10-30, TODO DK11 (f)).
// ---------------------------------------------------------------------------

const DECK = libraryKeys([
  { id: "forest", quantity: 24 },
  { id: "bolt", quantity: 4 },
  { id: "elf", quantity: 32 },
]);

describe("the library", () => {
  it("one key per copy; a key names its entry", () => {
    expect(DECK).toHaveLength(60);
    expect(DECK.filter((key) => entryIdOfKey(key) === "bolt")).toEqual(["bolt#0", "bolt#1", "bolt#2", "bolt#3"]);
    expect(new Set(DECK).size).toBe(60);
  });
});

describe("the seeded shuffle", () => {
  it("one seed, one order — and every card still there", () => {
    const a = shuffle(DECK, seededRandom(42));
    const b = shuffle(DECK, seededRandom(42));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...DECK].sort());
    expect(shuffle(DECK, seededRandom(43))).not.toEqual(a);
  });

  it("the generator stays in [0, 1)", () => {
    const random = seededRandom(7);
    for (let i = 0; i < 1000; i += 1) {
      const x = random();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("the opening hand and the draws", () => {
  it("seven cards, the rest the library", () => {
    const state = openingHand(DECK, seededRandom(1));
    expect(state.hand).toHaveLength(7);
    expect(state.library).toHaveLength(53);
    expect([...state.hand, ...state.library].sort()).toEqual([...DECK].sort());
    expect(state).toEqual({ hand: state.hand, library: state.library, drawn: 0 });
  });

  it("a draw takes the library's top card", () => {
    const opening = openingHand(DECK, seededRandom(11));
    const drawn = drawCard(opening);
    expect(drawn.hand).toEqual([...opening.hand, opening.library[0]]);
    expect(drawn.library).toEqual(opening.library.slice(1));
    expect(drawn.drawn).toBe(1);
    expect(drawCard(drawn).drawn).toBe(2);
  });

  it("an empty library draws nothing", () => {
    const tiny = libraryKeys([{ id: "a", quantity: 7 }]);
    const state = openingHand(tiny, seededRandom(1));
    expect(state.library).toEqual([]);
    expect(drawCard(state)).toBe(state);
  });

  it("a deck smaller than seven deals what it has", () => {
    const tiny = libraryKeys([{ id: "a", quantity: 3 }]);
    expect(openingHand(tiny, seededRandom(1)).hand).toHaveLength(3);
  });

  it("the London mulligan is gone with its controls (owner 2026-10-30)", () => {
    for (const name of ["mulligan", "keepHand", "canMulligan", "isHandKept", "bottomCountFor"]) {
      expect(name in sampleHand, name).toBe(false);
    }
  });
});
