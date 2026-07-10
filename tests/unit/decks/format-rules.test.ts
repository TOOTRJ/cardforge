import { describe, expect, it } from "vitest";
import { isBasicLand, validateDeck } from "@/lib/decks/format-rules";
import type { DeckBoard } from "@/types/deck";

type Entry = { name: string; board: DeckBoard; quantity: number };

const entry = (
  name: string,
  quantity = 1,
  board: DeckBoard = "main",
): Entry => ({ name, board, quantity });

/** N uniquely-named filler cards. */
const filler = (count: number, board: DeckBoard = "main"): Entry[] =>
  Array.from({ length: count }, (_, i) => entry(`Filler ${i}`, 1, board));

const codes = (warnings: ReturnType<typeof validateDeck>) =>
  warnings.map((w) => w.code);

describe("validateDeck — commander", () => {
  it("accepts a legal 100-card singleton deck", () => {
    const deck = [
      entry("Atraxa, Praetors' Voice", 1, "commander"),
      ...filler(89),
      entry("Island", 10),
    ];
    expect(validateDeck("commander", deck)).toEqual([]);
  });

  it("flags wrong deck size (commander counts toward 100)", () => {
    const deck = [entry("Atraxa, Praetors' Voice", 1, "commander"), ...filler(95)];
    expect(codes(validateDeck("commander", deck))).toContain("deck_size");
  });

  it("flags singleton violations but exempts basics and Relentless Rats", () => {
    const deck = [
      entry("Krenko, Mob Boss", 1, "commander"),
      entry("Lightning Bolt", 2),
      entry("Mountain", 30),
      entry("Relentless Rats", 25),
      ...filler(42),
    ];
    const warnings = validateDeck("commander", deck);
    expect(codes(warnings)).toEqual(["copy_limit"]);
    expect(warnings[0].message).toContain("Lightning Bolt");
  });

  it("enforces fixed-count exceptions (Seven Dwarves ≤ 7, Nazgûl ≤ 9)", () => {
    const ok = [
      entry("Some Commander", 1, "commander"),
      entry("Seven Dwarves", 7),
      entry("Nazgûl", 9),
      ...filler(83),
    ];
    expect(validateDeck("commander", ok)).toEqual([]);

    const over = [
      entry("Some Commander", 1, "commander"),
      entry("Seven Dwarves", 8),
      ...filler(91),
    ];
    expect(codes(validateDeck("commander", over))).toContain("copy_limit");
  });

  it("flags a missing commander and more than two", () => {
    expect(codes(validateDeck("commander", filler(100)))).toContain(
      "commander_count",
    );
    const three = [
      entry("A", 1, "commander"),
      entry("B", 1, "commander"),
      entry("C", 1, "commander"),
      ...filler(97),
    ];
    expect(codes(validateDeck("commander", three))).toContain(
      "commander_count",
    );
  });

  it("allows two partner commanders", () => {
    const deck = [
      entry("Thrasios, Triton Hero", 1, "commander"),
      entry("Tymna the Weaver", 1, "commander"),
      ...filler(98),
    ];
    expect(validateDeck("commander", deck)).toEqual([]);
  });

  it("counts copies case-insensitively across boards", () => {
    const deck = [
      entry("Cmd", 1, "commander"),
      entry("Sol Ring", 1, "main"),
      entry("SOL RING", 1, "side"),
      ...filler(98),
    ];
    expect(codes(validateDeck("commander", deck))).toContain("copy_limit");
  });
});

describe("validateDeck — 60-card constructed", () => {
  it("accepts a legal Standard deck with sideboard", () => {
    const deck = [
      entry("Lightning Strike", 4),
      entry("Mountain", 20),
      ...filler(36),
      entry("Duress", 4, "side"),
      ...filler(11, "side").map((e) => ({ ...e, name: `SB ${e.name}` })),
    ];
    expect(validateDeck("standard", deck)).toEqual([]);
  });

  it("flags under-60 mainboards", () => {
    expect(codes(validateDeck("modern", filler(59)))).toContain("deck_size");
  });

  it("counts the 4-of limit across main + side", () => {
    const deck = [
      entry("Lightning Bolt", 3),
      entry("Mountain", 20),
      ...filler(37),
      entry("Lightning Bolt", 2, "side"),
    ];
    expect(codes(validateDeck("legacy", deck))).toContain("copy_limit");
  });

  it("flags oversized sideboards", () => {
    const deck = [...filler(60), ...filler(16, "side")];
    expect(codes(validateDeck("pioneer", deck))).toContain("sideboard_size");
  });

  it("flags a commander zone in non-commander formats", () => {
    const deck = [...filler(60), entry("Someone", 1, "commander")];
    expect(codes(validateDeck("standard", deck))).toContain("commander_count");
  });

  it("companion sits outside the 60 and only one is allowed", () => {
    const withCompanion = [...filler(60), entry("Lurrus", 1, "companion")];
    expect(validateDeck("standard", withCompanion)).toEqual([]);

    const twoCompanions = [
      ...filler(60),
      entry("Lurrus", 1, "companion"),
      entry("Yorion", 1, "companion"),
    ];
    expect(codes(validateDeck("standard", twoCompanions))).toContain(
      "companion_count",
    );
  });
});

describe("validateDeck — other formats", () => {
  it("Standard Brawl is exactly 60 incl. commander, singleton", () => {
    const legal = [entry("Cmd", 1, "commander"), ...filler(59)];
    expect(validateDeck("standard_brawl", legal)).toEqual([]);
    expect(codes(validateDeck("standard_brawl", filler(60)))).toContain(
      "commander_count",
    );
  });

  it("Limited is 40+ with no copy limit", () => {
    const deck = [entry("Grizzly Bears", 12), ...filler(28)];
    expect(validateDeck("limited", deck)).toEqual([]);
    expect(codes(validateDeck("limited", filler(39)))).toContain("deck_size");
  });

  it("Casual has no rules at all", () => {
    const chaos = [entry("Black Lotus", 40), entry("Someone", 3, "commander")];
    expect(validateDeck("casual", chaos)).toEqual([]);
  });

  it("maybeboard never counts toward anything", () => {
    const deck = [...filler(60), entry("Lightning Bolt", 30, "maybe")];
    expect(validateDeck("modern", deck)).toEqual([]);
  });
});

describe("isBasicLand", () => {
  it("recognizes basics and snow basics, any casing", () => {
    expect(isBasicLand("Mountain")).toBe(true);
    expect(isBasicLand("snow-covered island")).toBe(true);
    expect(isBasicLand("Wastes")).toBe(true);
    expect(isBasicLand("Steam Vents")).toBe(false);
  });
});
