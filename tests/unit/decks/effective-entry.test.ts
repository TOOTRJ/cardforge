import { describe, expect, it } from "vitest";
import { importFingerprintOf } from "@/lib/cards/import-fingerprint";
import { computeDeckAnalytics } from "@/lib/decks/analytics";
import { effectiveEntryFields } from "@/lib/decks/effective-entry";
import type { DeckCardEntry } from "@/types/deck";

// ---------------------------------------------------------------------------
// effectiveEntryFields (TODO DK2.7): the type line, cost, colours and mana
// value a deck counts an entry by. The card's own values win for an edited
// import (and a remix / an original); an unchanged import counts as its
// printing; each side falls back to the other when it has nothing.
// ---------------------------------------------------------------------------

const PRINTING = "7bbd2cab-538e-4932-a828-150e3e9d52ad";

function entry(over: Partial<DeckCardEntry> = {}): DeckCardEntry {
  return {
    id: "e",
    deck_id: "d",
    board: "main",
    quantity: 1,
    position: 0,
    card_id: "c",
    scryfall_id: PRINTING,
    source: "import",
    name: "Solemn Simulacrum",
    set_code: "m21",
    collector_number: "239",
    type_line: "Artifact Creature — Golem",
    mana_cost: "{4}",
    mana_value: 4,
    color_identity: [],
    rarity: "rare",
    image_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const SOLEMN: {
  title: string;
  cost: string;
  supertype: string | null;
  card_type: string;
  subtypes: string[];
  printed_types: string | null;
  rules_text: string;
  color_identity: string[];
  art_url: string;
} = {
  title: "Solemn Simulacrum",
  cost: "{4}",
  supertype: "Artifact",
  card_type: "creature",
  subtypes: ["Golem"],
  printed_types: null,
  rules_text: "When it enters, search for a basic land.",
  color_identity: ["colorless"],
  art_url: "https://x/solemn.png",
};

const tracked = (card: typeof SOLEMN & Record<string, unknown>, importedAs: typeof SOLEMN = SOLEMN) => ({
  ...card,
  import_scryfall_id: PRINTING,
  import_fingerprint: importFingerprintOf(importedAs),
});

describe("effectiveEntryFields", () => {
  it("an EDITED import counts as what its card now is", () => {
    // The creature turned into a green instant for {1}{G}.
    const card = tracked({ ...SOLEMN, title: "Solemn Burst", cost: "{1}{G}", supertype: null, card_type: "instant", subtypes: [], color_identity: ["green"] });
    expect(effectiveEntryFields(entry(), card as never)).toEqual({
      typeLine: "Instant",
      cost: "{1}{G}",
      manaValue: 2,
      colors: ["G"],
      multicolorOnly: false,
    });
  });

  it("an UNCHANGED import counts as its printing (Scryfall's colour identity, its mana value)", () => {
    const card = tracked(SOLEMN);
    expect(effectiveEntryFields(entry({ color_identity: ["U"] }), card as never)).toEqual({
      typeLine: "Artifact Creature — Golem",
      cost: "{4}",
      manaValue: 4,
      colors: ["U"],
      multicolorOnly: false,
    });
  });

  it("a printing with no card is the printing", () => {
    expect(effectiveEntryFields(entry({ card_id: null }), null)).toMatchObject({ typeLine: "Artifact Creature — Golem", manaValue: 4 });
  });

  it("a remix / an original with no printing is its card, its type line built as it prints", () => {
    const bare = entry({ scryfall_id: null, type_line: null, mana_cost: null, mana_value: null, color_identity: [] });
    const remix = { ...SOLEMN, parent_card_id: "p", supertype: "Legendary", card_type: "creature", subtypes: ["Golem", "Sage"], cost: "{2}{U}{R}", color_identity: ["blue", "red"] };
    expect(effectiveEntryFields(bare, remix as never)).toEqual({
      typeLine: "Legendary Creature — Golem Sage",
      cost: "{2}{U}{R}",
      manaValue: 4,
      colors: ["U", "R"],
      multicolorOnly: false,
    });
  });

  it("the card's printed Types line wins over its built one (TODO 3b.16)", () => {
    const card = tracked({ ...SOLEMN, printed_types: "Artifact Golem Thing" } as never);
    expect(effectiveEntryFields(entry(), card as never).typeLine).toBe("Artifact Golem Thing — Golem");
  });

  it("a card's colours are its whole answer when it wins — colourless included", () => {
    const card = tracked({ ...SOLEMN, title: "Renamed" });
    expect(effectiveEntryFields(entry({ color_identity: ["U"] }), card as never).colors).toEqual([]);
  });

  it("a card saved as only 'multicolor' is gold", () => {
    const card = { ...SOLEMN, color_identity: ["multicolor"] };
    expect(effectiveEntryFields(entry({ scryfall_id: null, color_identity: [] }), card as never).multicolorOnly).toBe(true);
  });

  it("a card with no cost has none (a land) — the printing's is not borrowed once the card has a type", () => {
    const land = tracked({ ...SOLEMN, title: "Edited Land", cost: "", supertype: null, card_type: "land", subtypes: [] } as never);
    expect(effectiveEntryFields(entry(), land as never)).toMatchObject({ typeLine: "Land", cost: null, manaValue: null });
  });

  it("an empty card falls back to the entry", () => {
    const empty = { title: "x", parent_card_id: "p" };
    expect(effectiveEntryFields(entry(), empty as never)).toMatchObject({ typeLine: "Artifact Creature — Golem", cost: "{4}", manaValue: 4 });
  });

  it("an unreadable linked card: the entry's own values", () => {
    expect(effectiveEntryFields(entry(), null)).toMatchObject({ typeLine: "Artifact Creature — Golem", manaValue: 4 });
  });
});

describe("the deck's breakdown uses them (computeDeckAnalytics)", () => {
  it("an edited creature that became an instant counts as an instant, in its new colour and curve slot", () => {
    const card = tracked({ ...SOLEMN, title: "Solemn Burst", cost: "{1}{G}", supertype: null, card_type: "instant", subtypes: [], color_identity: ["green"] });
    const analytics = computeDeckAnalytics([{ entry: entry({ quantity: 2 }), card: card as never }]);
    expect(analytics.byType.Instant).toBe(2);
    expect(analytics.byType.Creature).toBe(0);
    expect(analytics.byColor.G).toBe(2);
    expect(analytics.curve[2]).toBe(2);
    expect(analytics.byStatus.edited).toBe(2);
  });
});
