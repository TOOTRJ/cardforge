import { describe, expect, it } from "vitest";
import {
  importMergeKey,
  planImportWrites,
  scryfallImageOnly,
  type ExistingDeckRow,
  type ImportCommitLine,
  type ImportResolvedCard,
} from "@/lib/decks/import-plan";
import { MAX_ENTRY_QUANTITY } from "@/lib/decks/parse-decklist";

const DECK = "11111111-1111-4111-8111-111111111111";
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

function existing(overrides: Partial<ExistingDeckRow> = {}): ExistingDeckRow {
  return {
    id: "row-1",
    board: "main",
    quantity: 2,
    position: 4,
    scryfall_id: BOLT,
    name: "Lightning Bolt",
    ...overrides,
  };
}

describe("planImportWrites", () => {
  it("inserts fresh rows after the deck's last position and counts placeholders", () => {
    const plan = planImportWrites(DECK, [existing({ position: 7 })], [
      line({ resolved: resolved({ scryfall_id: BOLT.replace("1", "2"), name: "Shock" }), name: "Shock" }),
      line({ resolved: null, name: "Mystery Card", quantity: 3 }),
    ]);
    expect(plan.inserts.map((r) => [r.name, r.position, r.quantity])).toEqual([
      ["Shock", 8, 1],
      ["Mystery Card", 9, 3],
    ]);
    expect(plan.placeholders).toBe(1);
    expect(plan.quantityUpdates).toEqual([]);
  });

  it("REGRESSION: two lines that land on the same existing row add up into ONE update", () => {
    // An exact line and a fuzzy-rescued typo of it both resolve to the same
    // Bolt row; the old code pushed two updates from the same base and the
    // second silently overwrote the first.
    const plan = planImportWrites(DECK, [existing({ quantity: 2 })], [
      line({ quantity: 2 }),
      line({ quantity: 1, name: "Lightning Blot" }),
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.quantityUpdates).toEqual([{ id: "row-1", quantity: 5 }]);
  });

  it("merges duplicate lines inside the payload into one insert", () => {
    const plan = planImportWrites(DECK, [], [line({ quantity: 2 }), line({ quantity: 2 })]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]?.quantity).toBe(4);
  });

  it("keeps boards apart and clamps quantities to the entry maximum", () => {
    const plan = planImportWrites(DECK, [existing({ quantity: MAX_ENTRY_QUANTITY - 1 })], [
      line({ quantity: 5 }),
      line({ board: "side", quantity: MAX_ENTRY_QUANTITY }),
      line({ board: "side", quantity: 10 }),
    ]);
    expect(plan.quantityUpdates).toEqual([{ id: "row-1", quantity: MAX_ENTRY_QUANTITY }]);
    expect(plan.inserts.map((r) => [r.board, r.quantity])).toEqual([["side", MAX_ENTRY_QUANTITY]]);
  });

  it("matches placeholders by case-insensitive name and resolved cards by Scryfall id", () => {
    expect(importMergeKey({ board: "main", scryfall_id: null, name: "  Mystery CARD " })).toBe(
      "main|name:mystery card",
    );
    expect(importMergeKey({ board: "main", scryfall_id: BOLT, name: "whatever" })).toBe(
      `main|${BOLT}`,
    );
    const plan = planImportWrites(
      DECK,
      [existing({ id: "ph", scryfall_id: null, name: "Mystery Card", quantity: 1 })],
      [line({ resolved: null, name: "mystery card", quantity: 2 })],
    );
    expect(plan.quantityUpdates).toEqual([{ id: "ph", quantity: 3 }]);
  });

  it("only keeps Scryfall-hosted images", () => {
    expect(scryfallImageOnly("https://cards.scryfall.io/normal/x.jpg")).toBe(
      "https://cards.scryfall.io/normal/x.jpg",
    );
    expect(scryfallImageOnly("https://evil.example/x.jpg")).toBeNull();
    expect(scryfallImageOnly(null)).toBeNull();
    const plan = planImportWrites(DECK, [], [
      line({ resolved: resolved({ image_url: "https://evil.example/x.jpg" }) }),
    ]);
    expect(plan.inserts[0]?.image_url).toBeNull();
  });
});
