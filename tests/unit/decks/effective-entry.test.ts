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

  it("an edited card's colourless or gold FRAME never hides the real letters the entry knows", () => {
    const card = tracked({ ...SOLEMN, title: "Renamed" });
    expect(effectiveEntryFields(entry({ color_identity: ["U"] }), card as never).colors).toEqual(["U"]);
    const gold = tracked({ ...SOLEMN, title: "Renamed", color_identity: ["multicolor", "red", "green"] });
    expect(effectiveEntryFields(entry({ color_identity: ["R", "G"] }), gold as never).colors).toEqual(["R", "G"]);
  });

  it("an edited card whose frame names a colour is that colour", () => {
    const card = tracked({ ...SOLEMN, title: "Solemn Ember", color_identity: ["red"] });
    expect(effectiveEntryFields(entry({ color_identity: ["U"] }), card as never).colors).toEqual(["R"]);
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

// ---------------------------------------------------------------------------
// The independent check's cards (M1): a card's color_identity is its FRAME's
// — an import stores Kessig Wolf Run colourless, Rootbound Crag gold, and
// Fire // Ice gold with its front half's cost only — so the deck must not
// read the game's colours or a split card's mana value off it.
// ---------------------------------------------------------------------------

const KESSIG = { id: "4a8447fe-7368-470a-911a-1083ec6cc831", type: "Land", letters: ["G", "R"] };
const CRAG = { id: "c7d8a3e4-1111-4c1d-9c9e-6a4d9b0b2c11", type: "Land", letters: ["R", "G"] };
const FIRE_ICE = { id: "18303862-4726-4136-814f-157aa7006579", type: "Instant // Instant", cost: "{1}{R} // {1}{U}", mv: 4, letters: ["R", "U"] };
const COMMIT = { id: "c1a6e2a4-2222-4d55-9e0e-7f1f2b3c4d5e", type: "Instant // Sorcery", cost: "{3}{U} // {4}{U}{U}", mv: 10, letters: ["U"] };

/** The deck entry the import wrote for a printing. */
function printingEntry(p: { id: string; type: string; cost?: string; mv?: number; letters: string[] }) {
  return entry({
    scryfall_id: p.id,
    type_line: p.type,
    mana_cost: p.cost ?? null,
    mana_value: p.mv ?? 0,
    color_identity: p.letters,
  });
}

/** The PipGlyph card an import of it saves (its frame colour, its front cost). */
const KESSIG_CARD = { title: "Kessig Wolf Run", cost: null, supertype: null, card_type: "land", subtypes: [], printed_types: null, rules_text: "{T}: Add {C}.", color_identity: ["colorless"], art_url: "a", frame_style: { template: "m15land" } };
const CRAG_CARD = { ...KESSIG_CARD, title: "Rootbound Crag", rules_text: "{T}: Add {R} or {G}.", color_identity: ["multicolor"] };
const FIRE_ICE_CARD = {
  title: "Fire",
  cost: "{1}{R}",
  supertype: null,
  card_type: "instant",
  subtypes: [],
  printed_types: null,
  rules_text: "Fire deals 2 damage divided as you choose among one or two targets.",
  color_identity: ["multicolor"],
  art_url: "a",
  frame_style: { template: "split" },
  back_face: { title: "Ice", cost: "{1}{U}", card_type: "instant", rules_text: "Tap target permanent. Draw a card." },
};
const COMMIT_CARD = {
  ...FIRE_ICE_CARD,
  title: "Commit",
  cost: "{3}{U}",
  color_identity: ["blue"],
  frame_style: { template: "aftermath" },
  back_face: { title: "Memory", cost: "{4}{U}{U}", card_type: "sorcery", rules_text: "Aftermath" },
};

/** The same card, edited since its import of `printing` (tracked, 0144). */
const editedFrom = (card: Record<string, unknown>, printing: string) => ({
  ...card,
  rules_text: `${String(card.rules_text)} (edited)`,
  import_scryfall_id: printing,
  import_fingerprint: importFingerprintOf(card),
});

describe("the frame colour and split halves (M1)", () => {
  it("a LEGACY link (no provenance) onto a printing counts as the printing, as before 0144", () => {
    for (const [p, card] of [
      [KESSIG, KESSIG_CARD],
      [CRAG, CRAG_CARD],
      [FIRE_ICE, FIRE_ICE_CARD],
      [COMMIT, COMMIT_CARD],
    ] as const) {
      const fields = effectiveEntryFields(printingEntry(p), card as never);
      expect(fields.colors).toEqual(p.letters);
      expect(fields.typeLine).toBe(p.type);
    }
    expect(effectiveEntryFields(printingEntry(FIRE_ICE), FIRE_ICE_CARD as never).manaValue).toBe(4);
    expect(effectiveEntryFields(printingEntry(COMMIT), COMMIT_CARD as never).manaValue).toBe(10);
  });

  it("an EDITED Fire // Ice: both halves' mana value and cost, and R/U — not 2 and gold", () => {
    const fields = effectiveEntryFields(printingEntry(FIRE_ICE), editedFrom(FIRE_ICE_CARD, FIRE_ICE.id) as never);
    expect(fields).toEqual({ typeLine: "Instant", cost: "{1}{R} // {1}{U}", manaValue: 4, colors: ["R", "U"], multicolorOnly: false });
  });

  it("an EDITED Commit // Memory (aftermath): 10, not 4", () => {
    const fields = effectiveEntryFields(printingEntry(COMMIT), editedFrom(COMMIT_CARD, COMMIT.id) as never);
    expect(fields).toMatchObject({ cost: "{3}{U} // {4}{U}{U}", manaValue: 10, colors: ["U"] });
  });

  it("EDITED dual lands keep their real letters (a land's frame is its mana's, or grey)", () => {
    expect(effectiveEntryFields(printingEntry(KESSIG), editedFrom(KESSIG_CARD, KESSIG.id) as never).colors).toEqual(["G", "R"]);
    expect(effectiveEntryFields(printingEntry(CRAG), editedFrom(CRAG_CARD, CRAG.id) as never)).toMatchObject({
      colors: ["R", "G"],
      multicolorOnly: false,
    });
  });

  it("the breakdown: a deck of the four, legacy and edited alike, counts real colours and mana values", () => {
    const items = [
      { entry: printingEntry(FIRE_ICE), card: FIRE_ICE_CARD },
      { entry: printingEntry(COMMIT), card: editedFrom(COMMIT_CARD, COMMIT.id) },
      { entry: printingEntry(KESSIG), card: editedFrom(KESSIG_CARD, KESSIG.id) },
      { entry: printingEntry(CRAG), card: CRAG_CARD },
    ];
    const analytics = computeDeckAnalytics(items as never);
    expect(analytics.byColor).toMatchObject({ R: 3, U: 2, G: 2, C: 0 });
    expect(analytics.multicolor).toBe(3); // Fire // Ice and both lands
    expect(analytics.lands).toBe(2);
    expect(analytics.curve[4]).toBe(1);
    expect(analytics.curve[7]).toBe(1); // Commit // Memory is 10
  });

  it("a split card of one's own (no printing) still sums its halves; its gold frame stays gold", () => {
    const own = effectiveEntryFields(entry({ scryfall_id: null, type_line: null, mana_cost: null, mana_value: null, color_identity: [] }), FIRE_ICE_CARD as never);
    expect(own).toMatchObject({ manaValue: 4, cost: "{1}{R} // {1}{U}", colors: [], multicolorOnly: true });
  });

  it("an EDITED Fire // Ice that landed on m15 with a second face (the split frame unverified) is still 4", () => {
    const onM15 = { ...FIRE_ICE_CARD, frame_style: { template: "m15" } };
    expect(effectiveEntryFields(printingEntry(FIRE_ICE), editedFrom(onM15, FIRE_ICE.id) as never)).toMatchObject({
      manaValue: 4,
      cost: "{1}{R} // {1}{U}",
      colors: ["R", "U"],
    });
    // …but only for a card imported from THAT printing: an Elves-like card of
    // another printing linked there sums nothing.
    expect(effectiveEntryFields(printingEntry(FIRE_ICE), editedFrom(onM15, "another-printing") as never).manaValue).toBe(2);
  });

  it("an EDITED adventure (Bonecrusher Giant: Scryfall's mana value is the creature's) never sums its page", () => {
    const BONECRUSHER = { id: "09fd2d9c-1793-4beb-a3fb-7a869f660cd4", type: "Creature — Giant // Instant — Adventure", cost: "{2}{R} // {1}{R}", mv: 3, letters: ["R"] };
    const card = {
      ...FIRE_ICE_CARD,
      title: "Bonecrusher Giant",
      cost: "{2}{R}",
      card_type: "creature",
      color_identity: ["red"],
      frame_style: { template: "m15" },
      back_face: { title: "Stomp", cost: "{1}{R}", card_type: "instant" },
    };
    expect(effectiveEntryFields(printingEntry(BONECRUSHER), editedFrom(card, BONECRUSHER.id) as never)).toMatchObject({
      manaValue: 3,
      cost: "{2}{R}",
    });
  });

  it("an adventure / flip card's second part never adds to its mana value", () => {
    const adventure = { ...FIRE_ICE_CARD, frame_style: { template: "adventure" } };
    expect(effectiveEntryFields(entry({ scryfall_id: null, mana_value: null, mana_cost: null }), adventure as never).manaValue).toBe(2);
  });
});

describe("an import of ANOTHER printing (L1)", () => {
  it("a Llanowar Elves card on a Lightning Bolt entry counts as the Elves, not as Instant {R}", () => {
    const ELVES = { title: "Llanowar Elves", cost: "{G}", supertype: null, card_type: "creature", subtypes: ["Elf", "Druid"], printed_types: null, rules_text: "{T}: Add {G}.", color_identity: ["green"], art_url: "a" };
    const unchangedElves = { ...ELVES, import_scryfall_id: "581b7327-3215-4a4f-b4ae-d9d4002ba882", import_fingerprint: importFingerprintOf(ELVES) };
    const boltEntry = entry({ scryfall_id: "e3285e6b-3e79-4d7c-bf96-d920f973b122", type_line: "Instant", mana_cost: "{R}", mana_value: 1, color_identity: ["R"] });
    expect(effectiveEntryFields(boltEntry, unchangedElves as never)).toEqual({
      typeLine: "Creature — Elf Druid",
      cost: "{G}",
      manaValue: 1,
      colors: ["G"],
      multicolorOnly: false,
    });
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
