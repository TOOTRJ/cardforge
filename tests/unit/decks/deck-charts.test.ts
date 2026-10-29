import { describe, expect, it } from "vitest";
import { computeDeckAnalytics, curveSlotLabel, manaValueSlot } from "@/lib/decks/analytics";
import {
  cardTexts,
  computeDeckCharts,
  costColorSymbols,
  deckLibraryOf,
  defaultDrawPick,
  drawPickOptions,
  manaProduced,
  viewerDeckBreakdown,
  weightedMedian,
} from "@/lib/decks/deck-charts";
import { deckRowsOf, groupDeckRows } from "@/lib/decks/deck-view";
import type { DeckCardEntry } from "@/types/deck";

// ---------------------------------------------------------------------------
// The breakdown's charts (TODO DK7.1): the curve's columns (one bucket with
// the list's "Group by mana value"), split creatures / other spells, the
// average and median without lands, colour symbols against sources, types
// and rarity — the maybeboard never counts, and the curve, the averages,
// the types and the lands count the main deck and the commander alone
// (owner 2026-10-29).
// ---------------------------------------------------------------------------

let n = 0;
function entry(over: Partial<DeckCardEntry> = {}): DeckCardEntry {
  n += 1;
  return {
    id: `e${n}`,
    deck_id: "d",
    board: "main",
    quantity: 1,
    position: n,
    card_id: null,
    scryfall_id: `sf${n}`,
    name: `Card ${n}`,
    set_code: null,
    collector_number: null,
    type_line: "Creature — Elf",
    mana_cost: "{G}",
    mana_value: 1,
    color_identity: ["G"],
    rarity: "common",
    image_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const item = (over: Partial<DeckCardEntry> = {}, card: Record<string, unknown> | null = null) => ({
  entry: entry(over),
  card: card as never,
});

describe("the curve's one bucket", () => {
  it("0–6 exact, 7 and up together, a half mana rounded down", () => {
    expect([0, 1, 6, 7, 12].map(manaValueSlot)).toEqual([0, 1, 6, 7, 7]);
    expect(manaValueSlot(2.5)).toBe(2);
    expect(manaValueSlot(-1)).toBe(0);
    expect([0, 6, 7].map(curveSlotLabel)).toEqual(["0", "6", "7+"]);
  });
});

describe("computeDeckCharts", () => {
  const items = [
    item({ name: "Llanowar Elves", quantity: 4 }),
    item({ name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}", mana_value: 1, color_identity: ["R"], quantity: 4, rarity: "uncommon" }),
    item({ name: "Big Dragon", type_line: "Creature — Dragon", mana_cost: "{6}{R}{R}", mana_value: 8, color_identity: ["R"], quantity: 2, rarity: "mythic" }),
    item({ name: "Fire // Ice", type_line: "Instant // Instant", mana_cost: "{1}{R} // {1}{U}", mana_value: 4, color_identity: ["R", "U"], rarity: "uncommon" }),
    item({ name: "Forest", type_line: "Basic Land — Forest", mana_cost: null, mana_value: 0, color_identity: ["G"], quantity: 10 }),
    item({ name: "Rootbound Crag", type_line: "Land", mana_cost: null, mana_value: 0, color_identity: ["R", "G"], quantity: 2, rarity: "rare" }),
    item({ name: "Commander", board: "commander", type_line: "Legendary Creature — Elf", mana_cost: "{2}{G}", mana_value: 3, rarity: "mythic" }),
    item({ name: "Side Bolt", board: "side", type_line: "Instant", mana_cost: "{R}", mana_value: 1, color_identity: ["R"], quantity: 2 }),
    // The maybeboard is a scratchpad: never counted.
    item({ name: "Maybe", board: "maybe", type_line: "Sorcery", mana_cost: "{U}", mana_value: 1, color_identity: ["U"], quantity: 9 }),
  ];
  const charts = computeDeckCharts(items);

  it("the curve: creatures and other spells per column, lands, the sideboard and the maybeboard out", () => {
    const column = (slot: number) => {
      const c = charts.curve[slot];
      return [c.creatures, c.other, c.total];
    };
    expect(charts.curve).toHaveLength(8);
    expect(column(1)).toEqual([4, 4, 8]); // elves; bolts (the side bolts are out)
    expect(column(3)).toEqual([1, 0, 1]); // the commander
    expect(column(4)).toEqual([0, 1, 1]); // Fire // Ice: both halves (CR 709.4)
    expect(column(7)).toEqual([2, 0, 2]); // the dragons, 7+
    expect(charts.curve[7].label).toBe("7+");
    expect(charts.curveCards).toBe(12);
    expect(charts.lands).toBe(12);
    // Every board but the maybeboard (the colours, rarity, keywords); the
    // main deck and the commander (the curve, the averages, the types).
    expect(charts.total).toBe(26);
    expect(charts.deckCards).toBe(24);
  });

  it("adds up to the breakdown's curve, card for card", () => {
    expect(charts.curve.map((c) => c.total)).toEqual(computeDeckAnalytics(items).curve);
  });

  it("each column names the entries the list shows for it (Group by mana value)", () => {
    const rows = deckRowsOf(items, true);
    const groups = groupDeckRows(rows, "mana", "mana");
    const idsOf = (key: string) => groups.find((group) => group.key === key)?.rows.map((row) => row.id) ?? [];
    expect(charts.curve[1].entryIds).toEqual(expect.arrayContaining(idsOf("main-1")));
    // Every id a column holds is in the list's mana-value group of that
    // value or the Commander group — never the sideboard's or the
    // maybeboard's.
    for (const column of charts.curve) {
      const shown = new Set([...idsOf(`main-${column.slot}`), ...idsOf("commander")]);
      for (const id of column.entryIds) expect(shown.has(id)).toBe(true);
    }
    const commander = items.find((i) => i.entry.name === "Commander")!.entry.id;
    expect(charts.curve[3].entryIds).toContain(commander);
    const all = charts.curve.flatMap((c) => c.entryIds);
    for (const name of ["Side Bolt", "Maybe"]) expect(all).not.toContain(items.find((i) => i.entry.name === name)!.entry.id);
  });

  it("average and median without lands (or the sideboard)", () => {
    // 4×1 + 4×1 + 2×8 + 1×4 + 1×3 = 31 over 12 cards.
    expect(charts.averageManaValue).toBeCloseTo(31 / 12, 10);
    expect(charts.averageManaValue).toBeCloseTo(computeDeckAnalytics(items).averageManaValue!, 10);
    expect(charts.medianManaValue).toBe(1);
  });

  it("colour symbols in costs against mana sources", () => {
    const row = (color: string) => charts.colors.find((c) => c.color === color);
    // Red: 4 bolts + 2×2 dragon pips + Fire's {R} + 2 side bolts = 11.
    expect(row("R")?.symbols).toBe(11);
    // Green: 4 elves + the commander's {G} = 5. Blue: Ice's {U} = 1 (the maybeboard's 9 are out).
    expect(row("G")?.symbols).toBe(5);
    expect(row("U")?.symbols).toBe(1);
    // Sources: 10 Forests + 2 Crags are green; the Crags red.
    expect(row("G")?.sources).toBe(12);
    expect(row("R")?.sources).toBe(2);
    expect(row("U")?.sources).toBe(0);
    // Wheel order; only colours the deck asks for.
    expect(charts.colors.map((c) => c.color)).toEqual(["U", "R", "G"]);
    expect(charts.colors.reduce((sum, c) => sum + c.symbolShare, 0)).toBeCloseTo(1, 10);
  });

  it("types and rarity", () => {
    expect(charts.types.map((t) => [t.label, t.count])).toEqual([
      ["Creatures", 7],
      ["Instants", 5], // the side bolts are out
      ["Lands", 12],
    ]);
    expect(charts.rarity.map((r) => [r.label, r.count])).toEqual([
      ["Mythic", 3],
      ["Rare", 2],
      ["Uncommon", 5],
      ["Common", 16],
    ]);
  });

  it("keywords from the text a PipGlyph card carries — a printing has none", () => {
    const withText = computeDeckCharts([
      item({ card_id: "c1", quantity: 3 }, { id: "c1", title: "Sky Elf", card_type: "creature", cost: "{G}", rules_text: "Flying", color_identity: ["green"] }),
      item({ quantity: 4 }),
    ]);
    expect(withText.keywords.cardsRead).toBe(3);
    expect(withText.keywords.evergreen).toEqual([expect.objectContaining({ name: "Flying", cards: 3 })]);
  });

  it("a card's mana ability makes it a source; a split card counts as its summed mana value", () => {
    const elves = computeDeckCharts([
      item({ card_id: "c2" }, { id: "c2", title: "Elf", card_type: "creature", cost: "{G}", rules_text: "{T}: Add {G}.", color_identity: ["green"] }),
    ]);
    expect(elves.colors).toEqual([expect.objectContaining({ color: "G", symbols: 1, sources: 1 })]);
  });
});

describe("a deck with a sideboard: its stats are the main deck and the commander (owner 2026-10-29)", () => {
  const items = [
    item({ name: "Commander", board: "commander", type_line: "Legendary Creature — Elf", mana_cost: "{2}{G}", mana_value: 3 }),
    item({ name: "Llanowar Elves", quantity: 4 }),
    item({ name: "Growth Spiral", type_line: "Instant", mana_cost: "{G}{U}", mana_value: 2, color_identity: ["G", "U"], quantity: 2 }),
    item({ name: "Forest", type_line: "Basic Land — Forest", mana_cost: null, mana_value: 0, quantity: 6 }),
    // The sideboard and a companion: no type, no land, no column.
    item({ name: "Naturalize", board: "side", type_line: "Instant", mana_cost: "{1}{G}", mana_value: 2, quantity: 3 }),
    item({ name: "Side Island", board: "side", type_line: "Basic Land — Island", mana_cost: null, mana_value: 0, color_identity: ["U"], quantity: 2 }),
    item({ name: "Big Side Wurm", board: "side", type_line: "Creature — Wurm", mana_cost: "{5}{G}{G}", mana_value: 7, quantity: 1 }),
    item({ name: "Companion", board: "companion", type_line: "Legendary Creature — Cat", mana_cost: "{4}{G}", mana_value: 5 }),
  ];
  const analytics = computeDeckAnalytics(items);
  const charts = computeDeckCharts(items);

  it("the curve counts the commander and the main deck, no sideboard card or companion", () => {
    expect(charts.curve.map((c) => c.total)).toEqual([0, 4, 2, 1, 0, 0, 0, 0]);
    expect(analytics.curve).toEqual([0, 4, 2, 1, 0, 0, 0, 0]);
    expect(charts.curveCards).toBe(7);
    const ids = new Set(charts.curve.flatMap((c) => c.entryIds));
    const idOf = (name: string) => items.find((i) => i.entry.name === name)!.entry.id;
    expect(ids.has(idOf("Commander"))).toBe(true);
    for (const name of ["Naturalize", "Big Side Wurm", "Companion"]) expect(ids.has(idOf(name))).toBe(false);
  });

  it("the average and the median: 4×1 + 2×2 + 1×3 = 11 over 7", () => {
    expect(charts.averageManaValue).toBeCloseTo(11 / 7, 10);
    expect(analytics.averageManaValue).toBeCloseTo(11 / 7, 10);
    expect(charts.medianManaValue).toBe(1);
  });

  it("Card types and the lands: the commander in, the sideboard's instants, wurm and island out", () => {
    expect(charts.types.map((t) => [t.label, t.count])).toEqual([
      ["Creatures", 5],
      ["Instants", 2],
      ["Lands", 6],
    ]);
    expect(analytics.byType).toMatchObject({ Creature: 5, Instant: 2, Land: 6 });
    expect(charts.lands).toBe(6);
    expect(analytics.lands).toBe(6);
    expect(charts.deckCards).toBe(13);
  });

  it("the sideboard is still on its board, in the colours and in the total", () => {
    expect(analytics.byBoard).toMatchObject({ main: 12, commander: 1, side: 6, companion: 1 });
    expect(analytics.total).toBe(20);
    expect(charts.total).toBe(20);
    // Naturalize's three {G} and the wurm's two count as symbols.
    expect(charts.colors.find((c) => c.color === "G")?.symbols).toBe(1 + 4 + 2 + 3 + 2 + 1);
  });
});

describe("viewerDeckBreakdown: a visitor's counts are their list's", () => {
  // The owner's private planeswalker, added from the creator: no printing, so
  // its entry's name and type line are the card's own. RLS hands a visitor
  // its card as null.
  const privateWalker = { name: "Jace, Hidden Mind", card_id: "c-private", scryfall_id: null, source: "creator", type_line: "Legendary Planeswalker — Jace", mana_cost: "{2}{U}{U}", mana_value: 4, color_identity: ["U"], rarity: "mythic" } as const;
  const items = [
    item({ name: "Llanowar Elves", quantity: 4 }),
    item({ name: "Wind Drake", type_line: "Creature — Drake", mana_cost: "{2}{U}{U}", mana_value: 4, color_identity: ["U"] }),
    item({ ...privateWalker, color_identity: [...privateWalker.color_identity] }),
    item({ name: "Island", type_line: "Basic Land — Island", mana_cost: null, mana_value: 0, color_identity: ["U"], quantity: 8 }),
  ];

  it("a private card with no printing shows no type in a visitor's charts — it is Other, as its tile is", () => {
    const visitor = viewerDeckBreakdown(items, false);
    expect(visitor.charts.types.map((t) => t.label)).not.toContain("Planeswalkers");
    expect(visitor.charts.types.map((t) => [t.label, t.count])).toEqual([
      ["Creatures", 5],
      ["Lands", 8],
      ["Other", 1],
    ]);
    // The 4 column: the drake a creature, the private card "other" — never a second creature.
    expect(visitor.charts.curve[4]).toMatchObject({ creatures: 1, other: 1, total: 2 });
    expect(visitor.analytics.byType.Planeswalker).toBe(0);
    expect(visitor.analytics.byType.Other).toBe(1);
    // The list's rows are the same rows: its tile says "Private card", no type line.
    const shown = visitor.shownItems.find((i) => i.entry.card_id === "c-private")!;
    expect(shown.entry).toMatchObject({ name: "Private card", type_line: null });
    expect(deckRowsOf(visitor.shownItems, false).find((row) => row.item === shown)?.bucket).toBe("Other");
    // Nothing else moves: the same cards, the same curve total.
    expect(visitor.charts.total).toBe(14);
    expect(visitor.analytics.total).toBe(14);
  });

  it("the owner reads their own rows", () => {
    const owner = viewerDeckBreakdown(items, true);
    expect(owner.shownItems).toEqual(items);
    expect(owner.charts.types.map((t) => [t.label, t.count])).toEqual([
      ["Planeswalkers", 1],
      ["Creatures", 5],
      ["Lands", 8],
    ]);
    expect(owner.analytics.byType.Planeswalker).toBe(1);
  });
});

describe("costColorSymbols", () => {
  it("hybrid for each colour, Phyrexian and two-generic for theirs, {C} by name", () => {
    expect(costColorSymbols("{2}{W}{W}")).toMatchObject({ W: 2 });
    expect(costColorSymbols("{R/G}{R/G}")).toMatchObject({ R: 2, G: 2 });
    expect(costColorSymbols("{G/P}{2/W}")).toMatchObject({ G: 1, W: 1 });
    expect(costColorSymbols("{C}{X}{S}")).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 1 });
    expect(costColorSymbols("{1}{R} // {1}{U}")).toMatchObject({ R: 1, U: 1 });
    expect(costColorSymbols(null)).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
  });
});

describe("manaProduced", () => {
  const produced = (typeLine: string | null, colors: string[], texts: string[] = []) => [...manaProduced({ typeLine, colors, texts })].sort();

  it("reads the text's Add — symbols, any colour, colourless", () => {
    expect(produced("Creature — Elf Druid", ["G"], ["{T}: Add {G}."])).toEqual(["G"]);
    expect(produced("Artifact", [], ["{T}: Add one mana of any color."])).toEqual(["B", "G", "R", "U", "W"]);
    expect(produced("Artifact", [], ["{T}: Add {C}{C}."])).toEqual(["C"]);
    expect(produced("Land", ["R", "G"], ["{T}: Add {R} or {G}."])).toEqual(["G", "R"]);
  });

  it("a land's basic types, then its identity when its text says nothing", () => {
    expect(produced("Basic Land — Forest", ["G"])).toEqual(["G"]);
    expect(produced("Land — Mountain Forest", [])).toEqual(["G", "R"]);
    expect(produced("Land", ["W", "U"])).toEqual(["U", "W"]);
    expect(produced("Basic Snow Land — Island", [], ["({T}: Add {U}.)"])).toEqual(["U"]);
  });

  it("a nonland card with no text, or a sentence that adds no mana, is no source", () => {
    expect(produced("Creature — Elf", ["G"])).toEqual([]);
    expect(produced("Instant", ["R"], ["Lightning Bolt deals 3 damage to any target."])).toEqual([]);
  });
});

describe("helpers", () => {
  it("weightedMedian", () => {
    expect(weightedMedian([])).toBeNull();
    expect(weightedMedian([{ value: 2, quantity: 3 }])).toBe(2);
    expect(weightedMedian([{ value: 1, quantity: 1 }, { value: 4, quantity: 1 }])).toBe(2.5);
    expect(weightedMedian([{ value: 5, quantity: 1 }, { value: 1, quantity: 3 }])).toBe(1);
  });

  it("cardTexts: the card's rules and its second face's", () => {
    expect(cardTexts({ rules_text: "Flying", back_face: { rules_text: "Haste" } })).toEqual(["Flying", "Haste"]);
    expect(cardTexts({ rules_text: " ", back_face: null })).toEqual([]);
    expect(cardTexts(null)).toEqual([]);
  });

  it("the library is the mainboard; the picker merges a name's copies", () => {
    const rows = deckRowsOf(
      [
        item({ name: "Lightning Bolt", quantity: 3 }),
        item({ name: "Lightning Bolt", quantity: 1, card_id: "c9", scryfall_id: null }),
        item({ name: "Commander", board: "commander" }),
        item({ name: "Side", board: "side" }),
        item({ name: "Forest", type_line: "Basic Land — Forest", quantity: 5 }),
      ],
      true,
    );
    const library = deckLibraryOf(rows);
    expect(library.map((card) => [card.name, card.quantity, card.isLand])).toEqual([
      ["Lightning Bolt", 3, false],
      ["Lightning Bolt", 1, false],
      ["Forest", 5, true],
    ]);
    const options = drawPickOptions(library, "Private card");
    expect(options).toEqual([
      { key: "forest", name: "Forest", copies: 5, isLand: true },
      { key: "lightning bolt", name: "Lightning Bolt", copies: 4, isLand: false },
    ]);
    // The first choice is a spell — the lands have their own table.
    expect(defaultDrawPick(options)?.name).toBe("Lightning Bolt");
    expect(defaultDrawPick(options.filter((o) => o.isLand))?.name).toBe("Forest");
    expect(defaultDrawPick([])).toBeNull();
    expect(drawPickOptions([{ id: "p", quantity: 1, name: "Private card", isLand: false }], "Private card")).toEqual([]);
  });
});
