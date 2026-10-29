import { describe, expect, it } from "vitest";
import { firstCardBoard, isLegendaryCreature, isPlaneswalker, leadsDeck } from "@/lib/decks/first-card";
import { formatHasCommander, validateDeck } from "@/lib/decks/format-rules";
import { DECK_FORMAT_VALUES, type DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// "Build a deck around this card" (TODO DK8.3): the card that leads a deck
// played with a commander zone starts there — Commander: a legendary
// creature; Brawl / Standard Brawl: a legendary creature or a planeswalker;
// Oathbreaker: a planeswalker (a legendary creature is no Oathbreaker).
// Every other card, and every format without a commander zone, starts on
// the main board. Held for EVERY format in DECK_FORMAT_VALUES, and to
// validateDeck's reading of the commander zone.
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

describe("isPlaneswalker — its card type, or the word beside another type", () => {
  it.each([
    [card("planeswalker", "Legendary"), true],
    // A planeswalker its maker left "Legendary" off is a planeswalker still.
    [card("planeswalker", null), true],
    // The importer keeps a creature (or a land) as the card type and the
    // Planeswalker word in supertype (CARD_TYPE_PRECEDENCE).
    [card("creature", "Legendary Planeswalker"), true],
    [card("land", "planeswalker"), true],
    [card("creature", "Legendary"), false],
    [card("sorcery", "Legendary"), false],
    [card("token", "Planeswalker"), false],
    [card("emblem", null), false],
    [card(null, null), false],
  ])("%j → %s", (facts, expected) => {
    expect(isPlaneswalker(facts)).toBe(expected);
  });
});

const LEGEND = card("creature", "Legendary");
const ARTIFACT_LEGEND = card("artifact", "Legendary Creature");
const WALKER = card("planeswalker", "Legendary");
const WALKER_WORD = card("creature", "Legendary Planeswalker");
const PLAIN_CREATURE = card("creature", null);
const LEGENDARY_SORCERY = card("sorcery", "Legendary");
const LEGEND_TOKEN = card("token", "Legendary Creature");
const EMBLEM = card("emblem", null);

/** Which of the cards above lead each format from its commander zone. */
const LEADS: Record<DeckFormat, ReadonlyArray<ReturnType<typeof card>>> = {
  commander: [LEGEND, ARTIFACT_LEGEND, WALKER_WORD],
  brawl: [LEGEND, ARTIFACT_LEGEND, WALKER, WALKER_WORD],
  standard_brawl: [LEGEND, ARTIFACT_LEGEND, WALKER, WALKER_WORD],
  oathbreaker: [WALKER, WALKER_WORD],
  standard: [],
  pioneer: [],
  modern: [],
  legacy: [],
  vintage: [],
  pauper: [],
  limited: [],
  casual: [],
};

const EVERY_CARD = {
  "a legendary creature": LEGEND,
  "a Legendary Artifact Creature": ARTIFACT_LEGEND,
  "a planeswalker": WALKER,
  "a Legendary Planeswalker Creature": WALKER_WORD,
  "a non-legendary creature": PLAIN_CREATURE,
  "a legendary sorcery": LEGENDARY_SORCERY,
  "a legendary creature token": LEGEND_TOKEN,
  "an emblem": EMBLEM,
};

describe("firstCardBoard — every format", () => {
  it("names every format", () => {
    expect(Object.keys(LEADS).sort()).toEqual([...DECK_FORMAT_VALUES].sort());
  });

  describe.each([...DECK_FORMAT_VALUES])("%s", (format) => {
    it.each(Object.entries(EVERY_CARD))("%s", (_, facts) => {
      const expected = LEADS[format].includes(facts) ? "commander" : "main";
      expect(firstCardBoard(format, facts)).toBe(expected);
      expect(leadsDeck(format, facts)).toBe(expected === "commander");
    });
  });

  it("only a format with a commander zone ever puts a card there", () => {
    for (const format of DECK_FORMAT_VALUES) {
      if (formatHasCommander(format)) continue;
      for (const facts of Object.values(EVERY_CARD)) expect(firstCardBoard(format, facts), format).toBe("main");
    }
  });

  it("Oathbreaker: the planeswalker leads, never a legendary creature", () => {
    expect(firstCardBoard("oathbreaker", WALKER)).toBe("commander");
    expect(firstCardBoard("oathbreaker", LEGEND)).toBe("main");
  });

  it("Commander: a planeswalker is no commander (only one whose text says so, which no field models)", () => {
    expect(firstCardBoard("commander", WALKER)).toBe("main");
  });
});

describe("validateDeck agrees: a leader in the commander zone is no commander warning", () => {
  it.each(["commander", "brawl", "standard_brawl", "oathbreaker"] as const)("%s", (format) => {
    const leader = LEADS[format][0];
    const board = firstCardBoard(format, leader);
    expect(board).toBe("commander");
    const codes = validateDeck(format, [{ name: "Leader", board, quantity: 1 }]).map((w) => w.code);
    expect(codes).not.toContain("commander_count");
    // The same card on the main board would leave the zone empty.
    const onMain = validateDeck(format, [{ name: "Leader", board: "main", quantity: 1 }]).map((w) => w.code);
    expect(onMain).toContain("commander_count");
  });
});
