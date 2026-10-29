import { describe, expect, it } from "vitest";
import {
  computeDeckAnalytics,
  deckStatCards,
  statusRows,
  typeBucketFor,
  TYPE_BUCKET_PLURALS,
  TYPE_BUCKETS,
} from "@/lib/decks/analytics";
import { effectiveEntryFields } from "@/lib/decks/effective-entry";
import type { DeckCardEntry } from "@/types/deck";

function makeEntry(overrides: Partial<DeckCardEntry> = {}): DeckCardEntry {
  return {
    id: "e",
    deck_id: "d",
    board: "main",
    quantity: 1,
    position: 0,
    card_id: null,
    scryfall_id: "sf",
    name: "Test Card",
    set_code: null,
    collector_number: null,
    type_line: "Creature — Human",
    mana_cost: "{1}{R}",
    mana_value: 2,
    color_identity: ["R"],
    rarity: null,
    image_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("typeBucketFor", () => {
  it("buckets standard type lines", () => {
    expect(typeBucketFor("Creature — Human Wizard")).toBe("Creature");
    expect(typeBucketFor("Instant")).toBe("Instant");
    expect(typeBucketFor("Legendary Planeswalker — Jace")).toBe("Planeswalker");
    expect(typeBucketFor("Basic Land — Mountain")).toBe("Land");
    // REGRESSION: artifact / enchantment lands are lands — they were bucketed
    // as Artifact/Enchantment, entering the mana curve and leaving the land
    // count. (Creature still wins: see "creature wins over …" below.)
    expect(typeBucketFor("Artifact Land")).toBe("Land");
    expect(typeBucketFor("Enchantment Land — Urza's Saga")).toBe("Land");
    expect(typeBucketFor("Artifact Creature — Golem")).toBe("Creature");
    expect(typeBucketFor(null)).toBe("Other");
  });

  it("creature wins over artifact/enchantment/land, matching deck sites", () => {
    expect(typeBucketFor("Artifact Creature — Golem")).toBe("Creature");
    expect(typeBucketFor("Enchantment Creature — God")).toBe("Creature");
    expect(typeBucketFor("Land Creature — Forest Dryad")).toBe("Creature");
  });

  it("uses only the front face of a split type line", () => {
    expect(typeBucketFor("Creature — Human // Land")).toBe("Creature");
  });

  it("each bucket's group heading is its real plural (never “Sorcerys”)", () => {
    expect(TYPE_BUCKET_PLURALS.Sorcery).toBe("Sorceries");
    expect(TYPE_BUCKET_PLURALS.Battle).toBe("Battles");
    expect(TYPE_BUCKET_PLURALS.Other).toBe("Other");
    expect(Object.keys(TYPE_BUCKET_PLURALS).sort()).toEqual([...TYPE_BUCKETS].sort());
  });
});

// The entry's mana value now comes from effectiveEntryFields (TODO DK2.7;
// its own tests: effective-entry.test.ts). The pip rules hold through it.
describe("an entry's mana value (effectiveEntryFields)", () => {
  const mv = (entry: DeckCardEntry, card?: unknown) => effectiveEntryFields(entry, card as never).manaValue;

  it("prefers the denormalized Scryfall value", () => {
    expect(mv(makeEntry({ mana_value: 3.5 }))).toBe(3.5);
  });

  it("falls back to parsing the entry's mana cost", () => {
    expect(mv(makeEntry({ mana_value: null, mana_cost: "{2}{U}{U}" }))).toBe(4);
  });

  it("falls back to the linked custom card's cost, else null", () => {
    const bare = makeEntry({ mana_value: null, mana_cost: null });
    expect(mv(bare, { cost: "{3}{G}" })).toBe(4);
    expect(mv(bare, null)).toBeNull();
  });

  it("counts hybrid, Phyrexian and snow pips as print does (audit L1: they counted 0)", () => {
    const bare = makeEntry({ mana_value: null, mana_cost: null, scryfall_id: null, card_id: "c" });
    expect(mv(bare, { cost: "{W/U}{W/U}" })).toBe(2);
    expect(mv(bare, { cost: "{2/W}" })).toBe(2);
    expect(mv(bare, { cost: "{1}{W/P}{G/U/P}" })).toBe(3);
    expect(mv(bare, { cost: "{S}{S}" })).toBe(2);
    expect(mv(bare, { cost: "{X}{R}" })).toBe(1);
  });
});

describe("computeDeckAnalytics", () => {
  it("weights everything by quantity and excludes the maybeboard", () => {
    const analytics = computeDeckAnalytics([
      { entry: makeEntry({ quantity: 4, card_id: "c1" }) },
      { entry: makeEntry({ quantity: 2, board: "side" }) },
      { entry: makeEntry({ quantity: 10, board: "maybe" }) },
    ]);
    expect(analytics.total).toBe(6);
    // A linked card this test can't read (none passed) over a printing:
    // edited; the bare printing: imported. The maybeboard counts nowhere.
    expect(analytics.byStatus).toEqual({ imported: 2, edited: 4, remix: 0, original: 0, not_found: 0 });
    expect(analytics.byBoard.maybe).toBe(10);
    // The types count the main deck and the commander only: the sideboard's
    // two are on their board and in the total, never in a type (owner
    // 2026-10-29).
    expect(analytics.byType.Creature).toBe(4);
    expect(analytics.byBoard.side).toBe(2);
  });

  it("counts the curve, the average, the types and the lands over the main deck and the commander", () => {
    const analytics = computeDeckAnalytics([
      { entry: makeEntry({ quantity: 1, board: "commander", mana_value: 5 }) },
      { entry: makeEntry({ quantity: 3, mana_value: 1 }) },
      { entry: makeEntry({ quantity: 4, board: "side", mana_value: 2 }) },
      { entry: makeEntry({ quantity: 2, board: "side", type_line: "Basic Land — Island", mana_value: 0, mana_cost: null }) },
      { entry: makeEntry({ quantity: 1, board: "companion", mana_value: 3 }) },
      { entry: makeEntry({ quantity: 5, type_line: "Basic Land — Forest", mana_value: 0, mana_cost: null }) },
    ]);
    expect(analytics.curve).toEqual([0, 3, 0, 0, 0, 1, 0, 0]);
    expect(analytics.averageManaValue).toBeCloseTo((3 + 5) / 4, 10);
    expect(analytics.byType.Creature).toBe(4);
    expect(analytics.byType.Land).toBe(5);
    expect(analytics.lands).toBe(5);
    expect(deckStatCards(analytics)).toBe(9);
    // Still on their boards and in the total.
    expect(analytics.total).toBe(16);
    expect(analytics.byBoard).toMatchObject({ side: 6, companion: 1 });
  });

  it("builds the curve with a 7+ bucket and keeps lands out", () => {
    const analytics = computeDeckAnalytics([
      { entry: makeEntry({ quantity: 3, mana_value: 1 }) },
      { entry: makeEntry({ quantity: 1, mana_value: 9 }) },
      {
        entry: makeEntry({
          quantity: 20,
          type_line: "Basic Land — Mountain",
          mana_value: 0,
          mana_cost: null,
        }),
      },
    ]);
    expect(analytics.curve[1]).toBe(3);
    expect(analytics.curve[7]).toBe(1);
    expect(analytics.curve[0]).toBe(0); // lands excluded
    expect(analytics.lands).toBe(20);
    expect(analytics.averageManaValue).toBe(3);
  });

  it("counts colorless and multicolor pips", () => {
    const analytics = computeDeckAnalytics([
      { entry: makeEntry({ color_identity: [] }) },
      { entry: makeEntry({ color_identity: ["W", "U"], quantity: 2 }) },
    ]);
    expect(analytics.byColor.C).toBe(1);
    expect(analytics.byColor.W).toBe(2);
    expect(analytics.byColor.U).toBe(2);
    // A real two-colour card is also a gold card.
    expect(analytics.multicolor).toBe(2);
  });

  it("derives colors and mana value from the linked custom card when the entry has none", () => {
    const analytics = computeDeckAnalytics([
      {
        entry: makeEntry({
          color_identity: [],
          mana_value: null,
          mana_cost: null,
          type_line: null,
          scryfall_id: null,
          card_id: "c1",
        }),
        card: {
          cost: "{1}{G}",
          color_identity: ["green"],
          supertype: null,
          card_type: "creature",
        } as never,
      },
    ]);
    expect(analytics.byColor.G).toBe(1);
    expect(analytics.curve[2]).toBe(1);
  });

  it("a custom card saved as multicolor without its colours is gold, never colorless (audit L2)", () => {
    const custom = makeEntry({
      color_identity: [],
      mana_value: null,
      mana_cost: null,
      type_line: null,
      scryfall_id: null,
      card_id: "c1",
      quantity: 2,
    });
    const analytics = computeDeckAnalytics([
      {
        entry: custom,
        card: { cost: "{W/B}{R/G}", color_identity: ["multicolor"], supertype: null, card_type: "creature" } as never,
      },
      // Named colours beside "multicolor" count as those colours.
      {
        entry: { ...custom, id: "e2", quantity: 1 },
        card: { cost: "{U}{R}", color_identity: ["blue", "red", "multicolor"], supertype: null, card_type: "creature" } as never,
      },
      // A colorless custom card is still colorless.
      {
        entry: { ...custom, id: "e3", quantity: 1 },
        card: { cost: "{3}", color_identity: ["colorless"], supertype: null, card_type: "artifact" } as never,
      },
    ]);
    // The two unnamed gold cards, plus the blue-red card.
    expect(analytics.multicolor).toBe(3);
    expect(analytics.byColor.C).toBe(1);
    expect(analytics.byColor.U).toBe(1);
    expect(analytics.byColor.R).toBe(1);
    // Two hybrids are mana value 2 (slot 2, beside the {U}{R} card).
    expect(analytics.curve[2]).toBe(3);
    expect(analytics.curve[3]).toBe(1);
  });
});

describe("an entry's type line (effectiveEntryFields)", () => {
  it("an unchanged printing keeps the denormalized Scryfall type line", () => {
    expect(effectiveEntryFields({ ...makeEntry({ type_line: "Instant" }) }, null).typeLine).toBe("Instant");
  });

  it("a card with no printing is its own type line, built as it prints", () => {
    expect(
      effectiveEntryFields(makeEntry({ type_line: null, scryfall_id: null, card_id: "c" }), {
        supertype: "Legendary",
        card_type: "creature",
      } as never).typeLine,
    ).toBe("Legendary Creature");
    expect(effectiveEntryFields(makeEntry({ type_line: null, scryfall_id: null }), null).typeLine).toBeNull();
  });

  it("keeps the list grouping consistent with the analytics buckets", () => {
    // Custom-only entry: no type_line, creature card → Creature, not Other.
    expect(
      typeBucketFor(
        effectiveEntryFields(makeEntry({ type_line: null, scryfall_id: null, card_id: "c" }), {
          supertype: null,
          card_type: "creature",
        } as never).typeLine,
      ),
    ).toBe("Creature");
  });
});

describe("statusRows", () => {
  const counts = (byStatus: Partial<Record<string, number>>) =>
    statusRows({ byStatus: { imported: 0, edited: 0, remix: 0, original: 0, not_found: 0, ...byStatus } as never });

  it("lists the four kinds of card in order, a zero included", () => {
    expect(counts({ imported: 59, edited: 22, original: 16 })).toEqual([
      { status: "imported", count: 59 },
      { status: "edited", count: 22 },
      { status: "remix", count: 0 },
      { status: "original", count: 16 },
    ]);
  });

  it("adds Not found only when the deck has one", () => {
    expect(counts({ not_found: 2 }).at(-1)).toEqual({ status: "not_found", count: 2 });
  });
});
