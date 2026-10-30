import { describe, expect, it } from "vitest";
import {
  deckStatusCountsOf,
  DECK_GROUPS,
  DECK_SORTS,
  DECK_VIEWS,
  DEFAULT_DECK_VIEW_PREFS,
  deckRowLabel,
  deckRowOf,
  deckRowsOf,
  defaultDeckViewPrefs,
  filterDeckRows,
  groupDeckRows,
  nextUnchangedImport,
  parseDeckViewPrefs,
  serializeDeckViewPrefs,
  sortDeckRows,
  stackColumnsOf,
  statusCountRows,
  statusFilterOptions,
  type DeckRow,
  type ViewItem,
} from "@/lib/decks/deck-view";
import { PRIVATE_CARD_NAME, publicDeckItems } from "@/lib/decks/private-card-name";

// ---------------------------------------------------------------------------
// The deck page's card area as data (TODO DK5.3 / DK5.6 / DK5.9): the
// cookie's prefs, each entry's row (status, badge, EFFECTIVE fields, a
// visitor's "Private card"), the status filter and its chips, every sort
// and every grouping, the Stacks piles and "Edit next".
// ---------------------------------------------------------------------------

let seq = 0;
function entry(over: Partial<ViewItem["entry"]> = {}): ViewItem["entry"] {
  seq += 1;
  return {
    id: `e-${String(seq).padStart(3, "0")}`,
    board: "main",
    quantity: 1,
    name: `Card ${seq}`,
    position: seq,
    created_at: "2026-10-01T00:00:00Z",
    card_id: null,
    scryfall_id: `sf-${seq}`,
    source: "import",
    type_line: "Creature — Elf",
    mana_cost: "{G}",
    mana_value: 1,
    color_identity: ["G"],
    rarity: "common",
    ...over,
  };
}

function card(over: Record<string, unknown> = {}): NonNullable<ViewItem["card"]> {
  return {
    title: "A Card",
    card_type: "creature",
    supertype: null,
    subtypes: [],
    cost: "{1}{R}",
    color_identity: ["red"],
    rarity: "rare",
    parent_card_id: null,
    frame_style: { template: "m15" },
    ...over,
  } as NonNullable<ViewItem["card"]>;
}

const item = (e: Partial<ViewItem["entry"]> = {}, c: NonNullable<ViewItem["card"]> | null = null): ViewItem => ({
  entry: entry(e),
  card: c,
});

const rowsOf = (items: ViewItem[], owner = true) => deckRowsOf(items, owner);
const names = (rows: readonly Pick<DeckRow, "name">[]) => rows.map((row) => row.name);

describe("the view prefs (the cookie)", () => {
  it("round-trips every view, grouping and sort", () => {
    for (const view of DECK_VIEWS) {
      for (const group of DECK_GROUPS) {
        for (const sort of DECK_SORTS) {
          const prefs = { view, group, sort };
          expect(parseDeckViewPrefs(serializeDeckViewPrefs(prefs))).toEqual(prefs);
        }
      }
    }
  });

  it("falls back part by part on anything it doesn't know (the cookie is user-editable)", () => {
    expect(parseDeckViewPrefs(undefined)).toEqual(DEFAULT_DECK_VIEW_PREFS);
    expect(parseDeckViewPrefs("")).toEqual(DEFAULT_DECK_VIEW_PREFS);
    expect(parseDeckViewPrefs(42)).toEqual(DEFAULT_DECK_VIEW_PREFS);
    expect(parseDeckViewPrefs("table.bogus.name")).toEqual({ view: "table", group: "type", sort: "name" });
    expect(parseDeckViewPrefs("<script>.rarity.added.extra")).toEqual({ view: "stacks", group: "rarity", sort: "added" });
    expect(parseDeckViewPrefs("grid", defaultDeckViewPrefs(true))).toEqual({ view: "grid", group: "type", sort: "mana" });
  });

  it("defaults to Stacks, and to the List on a phone", () => {
    expect(defaultDeckViewPrefs(false)).toEqual({ view: "stacks", group: "type", sort: "mana" });
    expect(defaultDeckViewPrefs(true)).toEqual({ view: "list", group: "type", sort: "mana" });
    expect(parseDeckViewPrefs(undefined, defaultDeckViewPrefs(true)).view).toBe("list");
  });
});

describe("a row", () => {
  it("reads the entry's status and its EFFECTIVE fields: an edited import groups as the card it now is", () => {
    const edited = deckRowOf(
      item(
        { name: "Solemn Simulacrum", type_line: "Artifact Creature — Golem", mana_cost: "{4}", mana_value: 4, color_identity: [], card_id: "c-1", rarity: "rare" },
        card({ title: "Solemn Sentinel", card_type: "instant", cost: "{U}", color_identity: ["blue"], rarity: "mythic", import_scryfall_id: "sf-x", import_fingerprint: `v1:${"0".repeat(64)}` }),
      ),
      true,
    );
    expect(edited.status).toBe("edited");
    expect(edited.name).toBe("Solemn Sentinel");
    expect(edited.bucket).toBe("Instant");
    expect(edited.fields.manaValue).toBe(1);
    expect(edited.fields.colors).toEqual(["U"]);
    expect(edited.rarity).toBe("mythic");
  });

  it("an unchanged import keeps its printing's values (and rarity)", () => {
    const row = deckRowOf(item({ name: "Llanowar Elves", rarity: "common" }), true);
    expect(row.status).toBe("imported");
    expect(row.bucket).toBe("Creature");
    expect(row.rarity).toBe("common");
  });

  it("a visitor's card they can't read is a Private card: the REAL card's name beside it, never the card's title", () => {
    const withPrinting = deckRowOf(item({ name: "Sol Ring", card_id: "c-private" }), false);
    expect(withPrinting.isPrivate).toBe(true);
    expect(withPrinting.name).toBe(PRIVATE_CARD_NAME);
    expect(withPrinting.privateName).toBe("Sol Ring");
    expect(withPrinting.status).toBe("edited");
    const noPrinting = deckRowOf(item({ name: "My Secret Dragon", card_id: "c-private", scryfall_id: null, source: "creator" }), false);
    expect(noPrinting.name).toBe(PRIVATE_CARD_NAME);
    expect(noPrinting.privateName).toBeNull();
    // The owner reads their own card (RLS hands it back) — never private to them.
    expect(deckRowOf(item({ name: "My Secret Dragon", card_id: "c-private", scryfall_id: null }), true).isPrivate).toBe(false);
  });

  it("a visitor's row from 0152's MASKED entry is the row the page drew from the stored one, less the card's cost and values", () => {
    // What the table held (and the API handed out before 0152)…
    const stored = item({
      name: "Vael, Gloomforge Tinker",
      type_line: "Legendary Creature — Dwarf Artificer",
      mana_cost: "{2}{R}",
      mana_value: 3,
      color_identity: ["R"],
      rarity: "rare",
      card_id: "c-private",
      scryfall_id: null,
      source: "creator",
    });
    // …and what deck_entries_for_viewer hands a visitor now.
    const masked: ViewItem = {
      card: null,
      entry: { ...stored.entry, name: PRIVATE_CARD_NAME, type_line: null, mana_cost: null, mana_value: null, color_identity: [], rarity: null },
    };
    const [before, after] = [deckRowOf(publicDeckItems([stored], false)[0]!, false), deckRowOf(publicDeckItems([masked], false)[0]!, false)];
    for (const key of ["id", "name", "privateName", "isPrivate", "status", "badge", "quantity", "board", "bucket", "position"] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect(after.name).toBe(PRIVATE_CARD_NAME);
    expect(after.status).toBe("original");
    expect(deckRowLabel(after)).toBe(`${PRIVATE_CARD_NAME}, 1 copy, Original`);
    // The card's cost and values no longer reach the visitor's row.
    expect(after.fields).toEqual({ typeLine: null, cost: null, manaValue: null, colors: [], multicolorOnly: false });
    expect(after.rarity).toBeNull();
    expect(before.fields.cost).toBe("{2}{R}");
  });

  it("badges a gone card No longer available — for the owner only when it was linked", () => {
    const linkedGone = item({ card_id: "c-gone", scryfall_id: null, source: "link" });
    expect(deckRowOf(linkedGone, true).badge).toBe("unavailable");
    expect(deckRowOf(linkedGone, false).badge).toBe("original");
    const deleted = item({ card_id: null, scryfall_id: null, source: "creator" });
    expect(deckRowOf(deleted, false).badge).toBe("unavailable");
    expect(deckRowOf(item({ scryfall_id: null }), false).badge).toBe("not_found");
  });

  it("names itself with its quantity and status (and another creator's credit)", () => {
    const row = deckRowOf(item({ name: "Sol Ring", quantity: 1 }), true);
    expect(deckRowLabel(row)).toBe("Sol Ring, 1 copy, Imported");
    expect(deckRowLabel(deckRowOf(item({ name: "Forest", quantity: 36 }), true))).toBe("Forest, 36 copies, Imported");
    expect(deckRowLabel(deckRowOf(item({ card_id: "c" }, card({ title: "Ember Imp" })), true), "dev_artist")).toBe(
      "Ember Imp by @dev_artist, 1 copy, Edited",
    );
    expect(deckRowLabel(deckRowOf(item({ name: "Sol Ring", card_id: "c" }), false))).toBe("Private card (Sol Ring), 1 copy, Edited");
    expect(deckRowLabel(deckRowOf(item({ card_id: "c", scryfall_id: null, source: "link" }), true))).toMatch(/, No longer available$/);
  });
});

describe("the status filter and its chips", () => {
  const items = [
    item({ quantity: 4 }),
    item({ card_id: "c-1" }, card({ import_scryfall_id: "sf-x", import_fingerprint: `v1:${"0".repeat(64)}` })),
    item({ card_id: "c-2", scryfall_id: null }, card({ parent_card_id: "p" })),
    item({ card_id: "c-3", scryfall_id: null }, card()),
    item({ scryfall_id: null, quantity: 2 }),
    item({ card_id: "c-4", scryfall_id: null, source: "link" }),
  ];
  const rows = rowsOf(items);

  it("counts the deck's CARDS per badge (quantities summed); the maybeboard never counts", () => {
    expect(deckStatusCountsOf(rows)).toEqual({ all: 10, imported: 4, edited: 1, remix: 1, original: 1, not_found: 2, unavailable: 1 });
    const withMaybe = rowsOf([...items, item({ board: "maybe", quantity: 3 }), item({ board: "side", quantity: 2 })]);
    expect(deckStatusCountsOf(withMaybe)).toEqual({ all: 12, imported: 6, edited: 1, remix: 1, original: 1, not_found: 2, unavailable: 1 });
  });

  it("lists the counts as the breakdown and the bar do: the four kinds always, Not found and No longer available when there", () => {
    expect(statusCountRows(deckStatusCountsOf(rows))).toEqual([
      { badge: "imported", count: 4 },
      { badge: "edited", count: 1 },
      { badge: "remix", count: 1 },
      { badge: "original", count: 1 },
      { badge: "not_found", count: 2 },
      { badge: "unavailable", count: 1 },
    ]);
    expect(statusCountRows(deckStatusCountsOf(rowsOf([item()]))).map((row) => row.badge)).toEqual([
      "imported",
      "edited",
      "remix",
      "original",
    ]);
  });

  it("filters to exactly the rows wearing a badge", () => {
    for (const badge of ["imported", "edited", "remix", "original", "not_found", "unavailable"] as const) {
      const kept = filterDeckRows(rows, badge);
      expect(kept.every((row) => row.badge === badge)).toBe(true);
      expect(kept).toHaveLength(rows.filter((row) => row.badge === badge).length);
    }
    expect(filterDeckRows(rows, "all")).toEqual(rows);
  });

  it("offers All, Imported and Edited always, the rest only where the deck has them — or where picked", () => {
    const onlyImports = deckStatusCountsOf(rowsOf([item(), item()]));
    expect(statusFilterOptions(onlyImports, "all").map((o) => o.value)).toEqual(["all", "imported", "edited"]);
    expect(statusFilterOptions(onlyImports, "remix").map((o) => o.value)).toEqual(["all", "imported", "edited", "remix"]);
    expect(statusFilterOptions(deckStatusCountsOf(rows), "all")).toEqual([
      { value: "all", label: "All", count: 10 },
      { value: "imported", label: "Imported", count: 4 },
      { value: "edited", label: "Edited", count: 1 },
      { value: "remix", label: "Remix", count: 1 },
      { value: "original", label: "Original", count: 1 },
      { value: "not_found", label: "Not found", count: 2 },
      { value: "unavailable", label: "No longer available", count: 1 },
    ]);
  });
});

describe("sorting", () => {
  const rows = rowsOf([
    item({ name: "Zebra", mana_value: 2, color_identity: ["W"], quantity: 1, created_at: "2026-10-03T00:00:00Z" }),
    item({ name: "apple", mana_value: 5, color_identity: ["U", "R"], quantity: 3, created_at: "2026-10-01T00:00:00Z" }),
    item({ name: "Mountain", type_line: "Basic Land — Mountain", mana_value: 0, color_identity: ["R"], quantity: 20, created_at: "2026-10-02T00:00:00Z" }),
    item({ name: "Card 10", mana_value: null, mana_cost: null, color_identity: [], quantity: 1, created_at: "2026-10-02T00:00:00Z" }),
    item({ name: "Card 9", mana_value: 2, color_identity: ["G"], quantity: 3, created_at: "2026-10-02T00:00:00Z" }),
  ]);

  it("mana value: spells by value (none last), lands after spells, then by name", () => {
    expect(names(sortDeckRows(rows, "mana"))).toEqual(["Card 9", "Zebra", "apple", "Card 10", "Mountain"]);
  });

  it("name: case-blind, numbers in number order", () => {
    expect(names(sortDeckRows(rows, "name"))).toEqual(["apple", "Card 9", "Card 10", "Mountain", "Zebra"]);
  });

  it("color: W U B R G, then gold, then colorless — then mana value", () => {
    expect(names(sortDeckRows(rows, "color"))).toEqual(["Zebra", "Mountain", "Card 9", "apple", "Card 10"]);
  });

  it("quantity: most first, then by name", () => {
    expect(names(sortDeckRows(rows, "quantity"))).toEqual(["Mountain", "apple", "Card 9", "Card 10", "Zebra"]);
  });

  it("recently added: newest first; one import's rows (one timestamp) by their place, later first", () => {
    expect(names(sortDeckRows(rows, "added"))).toEqual(["Zebra", "Card 9", "Card 10", "Mountain", "apple"]);
  });

  it("a private card sorts by the real card's name", () => {
    const mixed = rowsOf([item({ name: "Sol Ring", card_id: "c" }), item({ name: "Arcane Signet" }), item({ name: "Talisman" })], false);
    expect(sortDeckRows(mixed, "name").map((row) => row.privateName ?? row.name)).toEqual(["Arcane Signet", "Sol Ring", "Talisman"]);
  });

  it("never sorts in place", () => {
    const before = names(rows);
    sortDeckRows(rows, "quantity");
    expect(names(rows)).toEqual(before);
  });
});

describe("grouping", () => {
  const deck = rowsOf([
    item({ name: "Zoey", board: "commander", type_line: "Legendary Creature — Human" }),
    item({ name: "Lurrus", board: "companion", type_line: "Legendary Creature — Cat", mana_value: 3 }),
    item({ name: "Elf", type_line: "Creature — Elf", mana_value: 1, color_identity: ["G"], rarity: "common" }),
    item({ name: "Bolt", type_line: "Instant", mana_value: 1, color_identity: ["R"], rarity: "uncommon", quantity: 4 }),
    item({ name: "Wrath", type_line: "Sorcery", mana_value: 4, color_identity: ["W"], rarity: "rare" }),
    item({ name: "Forest", type_line: "Basic Land — Forest", mana_value: 0, color_identity: ["G"], rarity: "common", quantity: 30 }),
    item({ name: "Charm", type_line: "Instant", mana_value: 3, color_identity: ["R", "G"], rarity: "mythic" }),
    item({ name: "Big Thing", type_line: "Creature — Eldrazi", mana_value: 10, color_identity: [], rarity: "special" }),
    item({ name: "Mystery", type_line: null, mana_value: null, mana_cost: null, color_identity: [], rarity: null, scryfall_id: null }),
    item({ name: "Side Card", board: "side", type_line: "Instant" }),
    item({ name: "Maybe Card", board: "maybe", type_line: "Instant" }),
  ]);
  const shape = (group: Parameters<typeof groupDeckRows>[1]) =>
    groupDeckRows(deck, group, "mana").map((g) => `${g.label}·${g.count}:${names(g.rows).join(",")}`);

  it("type: the zones pinned first, the mainboard by type, the side and maybe boards whole", () => {
    expect(shape("type")).toEqual([
      "Commander·1:Zoey",
      "Companion·1:Lurrus",
      "Creatures·2:Elf,Big Thing",
      "Instants·5:Bolt,Charm",
      "Sorceries·1:Wrath",
      "Lands·30:Forest",
      "Other·1:Mystery",
      "Sideboard·1:Side Card",
      "Maybeboard·1:Maybe Card",
    ]);
  });

  it("mana value: 0–6, 7+, lands apart, no value last", () => {
    expect(shape("mana").slice(2, -2)).toEqual([
      "Mana value 1·5:Bolt,Elf",
      "Mana value 3·1:Charm",
      "Mana value 4·1:Wrath",
      "Mana value 7+·1:Big Thing",
      "Lands·30:Forest",
      "No mana value·1:Mystery",
    ]);
  });

  it("color: by the effective letters — one colour each, gold, colorless", () => {
    expect(shape("color").slice(2, -2)).toEqual([
      "White·1:Wrath",
      "Red·4:Bolt",
      "Green·31:Elf,Forest",
      "Multicolor·1:Charm",
      "Colorless·2:Big Thing,Mystery",
    ]);
  });

  it("status: by badge, in the badges' order", () => {
    const mixed = rowsOf([
      item({ name: "Real" }),
      item({ name: "Mine", card_id: "c", scryfall_id: null }, card({ title: "Mine" })),
      item({ name: "Lost", scryfall_id: null }),
    ]);
    expect(groupDeckRows(mixed, "status", "name").map((g) => g.label)).toEqual(["Imported", "Original", "Not found"]);
  });

  it("rarity: mythic down to common, special (bonus too), none", () => {
    expect(shape("rarity").slice(2, -2)).toEqual([
      "Mythic·1:Charm",
      "Rare·1:Wrath",
      "Uncommon·4:Bolt",
      "Common·31:Elf,Forest",
      "Special·1:Big Thing",
      "No rarity·1:Mystery",
    ]);
    expect(groupDeckRows(rowsOf([item({ rarity: "bonus" })]), "rarity", "mana").map((g) => g.label)).toEqual(["Special"]);
  });

  it("board only: one group a board, in the deck's order", () => {
    expect(groupDeckRows(deck, "board", "mana").map((g) => `${g.label}·${g.count}`)).toEqual([
      "Commander·1",
      "Companion·1",
      "Mainboard·39",
      "Sideboard·1",
      "Maybeboard·1",
    ]);
  });

  it("none: the deck as one group (its zones' cards first, the rest sorted) — the sideboard and maybeboard never mixed in", () => {
    expect(shape("none")).toEqual([
      "Deck·41:Zoey,Lurrus,Bolt,Elf,Charm,Wrath,Big Thing,Mystery,Forest",
      "Sideboard·1:Side Card",
      "Maybeboard·1:Maybe Card",
    ]);
    const byName = groupDeckRows(deck, "none", "name");
    expect(names(byName[0]!.rows).slice(0, 3)).toEqual(["Zoey", "Lurrus", "Big Thing"]);
    expect(byName.map((g) => g.label)).toEqual(["Deck", "Sideboard", "Maybeboard"]);
    // A deck with no sideboard or maybeboard: the one group.
    expect(groupDeckRows(rowsOf([item({ name: "Solo" })]), "none", "mana").map((g) => g.label)).toEqual(["Deck"]);
  });

  it("keys are unique on the page, and empty groups never appear", () => {
    for (const group of DECK_GROUPS) {
      const groups = groupDeckRows(deck, group, "mana");
      expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
      expect(groups.every((g) => g.rows.length > 0)).toBe(true);
    }
    expect(groupDeckRows([], "type", "mana")).toEqual([]);
    expect(groupDeckRows([], "none", "mana")).toEqual([]);
  });
});

describe("the Stacks piles", () => {
  it("holds at most 12 a pile, the piles as even as they can be", () => {
    const sizes = (n: number) => stackColumnsOf(Array.from({ length: n }, (_, i) => i)).map((pile) => pile.length);
    expect(sizes(0)).toEqual([]);
    expect(sizes(1)).toEqual([1]);
    expect(sizes(12)).toEqual([12]);
    expect(sizes(13)).toEqual([7, 6]);
    expect(sizes(36)).toEqual([12, 12, 12]);
    expect(sizes(37)).toEqual([10, 10, 10, 7]);
    expect(stackColumnsOf([1, 2, 3, 4, 5], 2).flat()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("Edit next", () => {
  it("is the first unchanged printing in the order the groups read — never the maybeboard, never a card already made", () => {
    const deck = rowsOf([
      item({ name: "Maybe", board: "maybe", type_line: "Artifact" }),
      item({ name: "Linked", card_id: "c-1", type_line: "Artifact" }, card({ title: "Linked", card_type: "artifact", import_scryfall_id: null })),
      item({ name: "Ring", type_line: "Artifact", mana_value: 1 }),
      item({ name: "Elf", type_line: "Creature — Elf", mana_value: 1 }),
    ]);
    expect(nextUnchangedImport(groupDeckRows(deck, "type", "mana"))?.name).toBe("Elf");
    expect(nextUnchangedImport(groupDeckRows(deck, "none", "name"))?.name).toBe("Elf");
    expect(nextUnchangedImport(groupDeckRows(rowsOf([item({ board: "maybe" })]), "type", "mana"))).toBeNull();
  });
});
