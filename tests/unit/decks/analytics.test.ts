import { describe, expect, it } from "vitest";
import {
  computeDeckAnalytics,
  entryManaValue,
  entryTypeLine,
  typeBucketFor,
} from "@/lib/decks/analytics";
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
});

describe("entryManaValue", () => {
  it("prefers the denormalized Scryfall value", () => {
    expect(entryManaValue(makeEntry({ mana_value: 3.5 }))).toBe(3.5);
  });

  it("falls back to parsing the entry's mana cost", () => {
    expect(
      entryManaValue(makeEntry({ mana_value: null, mana_cost: "{2}{U}{U}" })),
    ).toBe(4);
  });

  it("falls back to the linked custom card's cost, else null", () => {
    const bare = makeEntry({ mana_value: null, mana_cost: null });
    expect(entryManaValue(bare, { cost: "{3}{G}" })).toBe(4);
    expect(entryManaValue(bare, null)).toBeNull();
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
    expect(analytics.remixed).toBe(4);
    expect(analytics.byBoard.maybe).toBe(10);
    expect(analytics.byType.Creature).toBe(6);
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
});

describe("entryTypeLine", () => {
  it("prefers the denormalized Scryfall type line", () => {
    expect(
      entryTypeLine({ type_line: "Instant" }, {
        supertype: "Legendary",
        card_type: "creature",
      } as never),
    ).toBe("Instant");
  });

  it("derives from the linked custom card when the entry has none", () => {
    expect(
      entryTypeLine({ type_line: null }, {
        supertype: "Legendary",
        card_type: "creature",
      } as never),
    ).toBe("Legendary creature");
    expect(entryTypeLine({ type_line: null }, null)).toBeNull();
  });

  it("keeps the list grouping consistent with the analytics buckets", () => {
    // Custom-only entry: no type_line, creature card → Creature, not Other.
    expect(
      typeBucketFor(
        entryTypeLine({ type_line: null }, {
          supertype: null,
          card_type: "creature",
        } as never),
      ),
    ).toBe("Creature");
  });
});
