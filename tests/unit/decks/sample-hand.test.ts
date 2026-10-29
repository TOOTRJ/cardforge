import { describe, expect, it } from "vitest";
import {
  bottomCountFor,
  canMulligan,
  drawCard,
  entryIdOfKey,
  keepHand,
  libraryKeys,
  mulligan,
  openingHand,
  seededRandom,
  shuffle,
} from "@/lib/decks/sample-hand";

// ---------------------------------------------------------------------------
// The sample hand (TODO DK7.2): a seeded shuffle, the opening seven and the
// London mulligan (CR 103.5: draw seven, bottom one per mulligan; the first
// free in multiplayer, 103.5c).
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

describe("the opening hand and the London mulligan", () => {
  it("seven cards, the rest the library", () => {
    const state = openingHand(DECK, seededRandom(1));
    expect(state.hand).toHaveLength(7);
    expect(state.library).toHaveLength(53);
    expect([...state.hand, ...state.library].sort()).toEqual([...DECK].sort());
    expect(state).toMatchObject({ mulligans: 0, toBottom: 0, drawn: 0 });
  });

  it("each mulligan draws seven again and owes one more card to the bottom", () => {
    const random = seededRandom(9);
    const first = mulligan(openingHand(DECK, random), DECK, random, false);
    expect(first).toMatchObject({ mulligans: 1, toBottom: 1 });
    expect(first.hand).toHaveLength(7);
    const second = mulligan(first, DECK, random, false);
    expect(second).toMatchObject({ mulligans: 2, toBottom: 2 });
    expect(second.hand).toHaveLength(7);
    expect([...second.hand, ...second.library].sort()).toEqual([...DECK].sort());
  });

  it("the first mulligan is free in multiplayer", () => {
    expect(bottomCountFor(1, true)).toBe(0);
    expect(bottomCountFor(2, true)).toBe(1);
    expect(bottomCountFor(1, false)).toBe(1);
    const random = seededRandom(3);
    expect(mulligan(openingHand(DECK, random), DECK, random, true)).toMatchObject({ mulligans: 1, toBottom: 0 });
  });

  it("keeping puts exactly the owed cards on the bottom, in the order chosen", () => {
    const random = seededRandom(5);
    const state = mulligan(mulligan(openingHand(DECK, random), DECK, random, false), DECK, random, false);
    const [a, b, c] = state.hand;
    // The wrong number of cards, or a card not in the hand: refused.
    expect(keepHand(state, [a])).toBe(state);
    expect(keepHand(state, [a, "nope#0"])).toBe(state);
    expect(keepHand(state, [a, a])).toBe(state);
    const kept = keepHand(state, [b, a]);
    expect(kept.hand).toHaveLength(5);
    expect(kept.hand).not.toContain(a);
    expect(kept.toBottom).toBe(0);
    expect(kept.library.slice(-2)).toEqual([b, a]);
    expect(kept.hand).toContain(c);
  });

  it("no draw before the hand is kept; then the library's top card", () => {
    const random = seededRandom(11);
    const owed = mulligan(openingHand(DECK, random), DECK, random, false);
    expect(drawCard(owed)).toBe(owed);
    const kept = keepHand(owed, [owed.hand[0]]);
    const drawn = drawCard(kept);
    expect(drawn.hand).toEqual([...kept.hand, kept.library[0]]);
    expect(drawn.library).toEqual(kept.library.slice(1));
    expect(drawn.drawn).toBe(1);
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

  it("a mulligan always leaves a card to keep", () => {
    let state = openingHand(DECK, seededRandom(2));
    const random = seededRandom(2);
    let taken = 0;
    while (canMulligan(state, DECK.length, false)) {
      state = mulligan(state, DECK, random, false);
      taken += 1;
    }
    expect(taken).toBe(6);
    expect(state.hand.length - state.toBottom).toBe(1);
    expect(canMulligan(openingHand(DECK, seededRandom(2)), 0, false)).toBe(false);
  });
});
