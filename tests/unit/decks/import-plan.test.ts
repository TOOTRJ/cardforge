import { describe, expect, it } from "vitest";
import {
  deckEntryLimitMessage,
  importMergeKey,
  isDeckNotOwnedError,
  MAX_DECK_ENTRIES,
  planImportEntries,
  scryfallImageOnly,
  type ImportCommitLine,
  type ImportResolvedCard,
} from "@/lib/decks/import-plan";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";

// The app half of the decklist commit: the list's own duplicates merged and
// each entry's fields built. Merging into the rows the deck ALREADY holds is
// the database's (migration 0143, import_deck_entries — one transaction under
// a per-deck lock); tests/unit/db/deck-counts-migration.test.ts holds that
// side to the same merge key.

const BOLT = "00000000-0000-4000-8000-000000000001";

function resolved(overrides: Partial<ImportResolvedCard> = {}): ImportResolvedCard {
  return {
    scryfall_id: BOLT,
    name: "Lightning Bolt",
    set_code: "m10",
    collector_number: "146",
    type_line: "Instant",
    mana_cost: "{R}",
    mana_value: 1,
    color_identity: ["R"],
    rarity: "common",
    image_url: "https://cards.scryfall.io/normal/bolt.jpg",
    ...overrides,
  };
}

function line(overrides: Partial<ImportCommitLine> = {}): ImportCommitLine {
  return { board: "main", quantity: 1, name: "Lightning Bolt", resolved: resolved(), ...overrides };
}

describe("planImportEntries", () => {
  it("builds one entry per line with the resolved card's fields, and counts placeholders", () => {
    const plan = planImportEntries([
      line({ resolved: resolved({ scryfall_id: BOLT.replace("1", "2"), name: "Shock" }), name: "Shock" }),
      line({ resolved: null, name: "Mystery Card", quantity: 3 }),
    ]);
    expect(plan.entries).toEqual([
      {
        board: "main",
        quantity: 1,
        name: "Shock",
        scryfall_id: BOLT.replace("1", "2"),
        set_code: "m10",
        collector_number: "146",
        type_line: "Instant",
        mana_cost: "{R}",
        mana_value: 1,
        color_identity: ["R"],
        rarity: "common",
        image_url: "https://cards.scryfall.io/normal/bolt.jpg",
      },
      {
        board: "main",
        quantity: 3,
        name: "Mystery Card",
        scryfall_id: null,
        set_code: null,
        collector_number: null,
        type_line: null,
        mana_cost: null,
        mana_value: null,
        color_identity: [],
        rarity: null,
        image_url: null,
      },
    ]);
    expect(plan.placeholders).toBe(1);
  });

  it("REGRESSION: an exact line and a fuzzy-rescued typo of it become ONE entry with both quantities", () => {
    // Two entries with one key would be refused by import_deck_entries; two
    // updates of one row from the same base used to drop one line's copies.
    const plan = planImportEntries([line({ quantity: 2 }), line({ quantity: 1, name: "Lightning Blot" })]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.quantity).toBe(3);
    expect(plan.entries[0]?.name).toBe("Lightning Bolt");
  });

  it("keeps boards apart and clamps quantities to the entry maximum", () => {
    const plan = planImportEntries([
      line({ quantity: 5 }),
      line({ board: "side", quantity: MAX_ENTRY_QUANTITY }),
      line({ board: "side", quantity: 10 }),
    ]);
    expect(plan.entries.map((e) => [e.board, e.quantity])).toEqual([
      ["main", 5],
      ["side", MAX_ENTRY_QUANTITY],
    ]);
  });

  it("merges placeholders by case-insensitive name and resolved cards by Scryfall id", () => {
    expect(importMergeKey({ board: "main", scryfall_id: null, name: "  Mystery CARD " })).toBe(
      "main|name:mystery card",
    );
    expect(importMergeKey({ board: "main", scryfall_id: BOLT, name: "whatever" })).toBe(`main|${BOLT}`);
    const plan = planImportEntries([
      line({ resolved: null, name: "Mystery Card", quantity: 1 }),
      line({ resolved: null, name: "mystery card ", quantity: 2 }),
    ]);
    expect(plan.entries.map((e) => [e.name, e.quantity])).toEqual([["Mystery Card", 3]]);
    expect(plan.placeholders).toBe(2);
  });

  it("only keeps Scryfall-hosted images", () => {
    expect(scryfallImageOnly("https://cards.scryfall.io/normal/x.jpg")).toBe(
      "https://cards.scryfall.io/normal/x.jpg",
    );
    expect(scryfallImageOnly("https://evil.example/x.jpg")).toBeNull();
    expect(scryfallImageOnly(null)).toBeNull();
    const plan = planImportEntries([line({ resolved: resolved({ image_url: "https://evil.example/x.jpg" }) })]);
    expect(plan.entries[0]?.image_url).toBeNull();
  });

  it("drops a Scryfall URL migration 0127 would refuse — one odd image, not the whole import", () => {
    // Every entry goes in with ONE insert, and 0127's deck-card-image rule
    // is strict (digits-only query, no `%`, `~` or `..`): a prefix-only
    // check let such a URL through and the database failed the import.
    const good = "https://cards.scryfall.io/large/front/6/d/6da045f8.jpg?1562404626";
    const odd = [
      "https://cards.scryfall.io/large/front/6/d/6da045f8.jpg?v=abc",
      "https://cards.scryfall.io/large/front/6/d/6da0%2045f8.jpg",
      "https://cards.scryfall.io/large/front/6/d/~6da045f8.jpg",
      "https://cards.scryfall.io/large/../x.jpg",
    ];
    expect(scryfallImageOnly(good)).toBe(good);
    for (const url of odd) expect(scryfallImageOnly(url), url).toBeNull();
    const plan = planImportEntries([
      line({ name: "Keeps", resolved: resolved({ scryfall_id: "s-1", image_url: good }) }),
      line({ name: "Drops", resolved: resolved({ scryfall_id: "s-2", image_url: odd[0] }) }),
    ]);
    expect(plan.entries.map((e) => e.image_url)).toEqual([good, null]);
  });

  it("clamps an absurd mana value to what numeric(6,2) holds", () => {
    const plan = planImportEntries([line({ resolved: resolved({ mana_value: 1_000_000 }) })]);
    expect(plan.entries[0]?.mana_value).toBe(9999.99);
  });
});

describe("the database's entry errors, in words", () => {
  it("reads the 500-row cap with the numbers the database sends", () => {
    expect(MAX_DECK_ENTRIES).toBe(500);
    const msg = deckEntryLimitMessage({
      message: "deck_entry_limit: a deck holds at most 500 entries",
      details: "existing=480,adding=40",
    });
    expect(msg).toContain("500");
    expect(msg).toContain("520");
  });

  it("says a full deck is full, and that merges still go in", () => {
    const msg = deckEntryLimitMessage({
      message: "deck_entry_limit: a deck holds at most 500 entries",
      details: "existing=500,adding=1",
    });
    expect(msg).toMatch(/already holds 500/);
    expect(msg).toMatch(/still merge/);
  });

  it("falls back to the cap alone without numbers, and ignores every other error", () => {
    expect(deckEntryLimitMessage({ message: "deck_entry_limit: …", details: null })).toMatch(/at most 500/);
    expect(deckEntryLimitMessage({ message: "permission denied for table deck_cards" })).toBeNull();
    expect(deckEntryLimitMessage(null)).toBeNull();
    expect(isDeckNotOwnedError({ message: "deck_not_owned: deck not found or not yours" })).toBe(true);
    expect(isDeckNotOwnedError({ message: "deck_entry_limit" })).toBe(false);
  });
});
