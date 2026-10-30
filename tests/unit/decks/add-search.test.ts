import { describe, expect, it } from "vitest";
import {
  addTargetEntry,
  cardElsewhere,
  cardNameKey,
  inDeckCountForCard,
  inDeckCountForName,
  inDeckLabel,
  normalizeAddQuery,
  rankRealCards,
  scryfallPictureAt,
  typedFoldPattern,
} from "@/lib/decks/add-search";
import type { DeckBoard } from "@/types/deck";

// ---------------------------------------------------------------------------
// The add box as data (TODO DK5.2, lib/decks/add-search.ts) — the box and
// the server's add share ONE answer for "in deck ×N" and for the row an add
// lands on (one copy more, never a second line for the same card).
// ---------------------------------------------------------------------------

let n = 0;
const entry = (over: Partial<{ board: DeckBoard; quantity: number; name: string; card_id: string | null; scryfall_id: string | null }> = {}) => {
  n += 1;
  return { id: `e${n}`, board: "main" as DeckBoard, quantity: 1, name: `Card ${n}`, card_id: null, scryfall_id: null, ...over };
};

describe("in deck ×N", () => {
  const entries = [
    entry({ name: "Sol Ring", scryfall_id: "sf-a", quantity: 1 }),
    entry({ name: "Sol Ring", scryfall_id: "sf-b", card_id: "c-sun", quantity: 2, board: "side" }),
    entry({ name: "Sol Ring", scryfall_id: "sf-a", quantity: 3, board: "maybe" }),
    entry({ name: "Ember Wyrm", card_id: "c-1", quantity: 2 }),
    entry({ name: "Delver of Secrets // Insectile Aberration", scryfall_id: "sf-d" }),
  ];

  it("a real card by its name — any printing, your version of it too — the maybeboard named apart", () => {
    expect(inDeckCountForName(entries, "Sol Ring")).toEqual({ deck: 3, maybe: 3 });
    expect(inDeckLabel(inDeckCountForName(entries, "sol ring"))).toBe("In deck ×3");
    expect(inDeckCountForName(entries, "Delver of Secrets")).toEqual({ deck: 1, maybe: 0 });
    expect(inDeckLabel(inDeckCountForName(entries, "Llanowar Elves"))).toBeNull();
  });

  it("a PipGlyph card by its id", () => {
    expect(inDeckLabel(inDeckCountForCard(entries, "C-1"))).toBe("In deck ×2");
    expect(inDeckLabel({ deck: 0, maybe: 1 })).toBe("In the maybeboard ×1");
  });

  it("names compare as typed and printed alike", () => {
    expect(cardNameKey("Urza’s Saga")).toBe(cardNameKey("urza's saga"));
  });
});

describe("where an add lands", () => {
  it("a PipGlyph card already on the board: one more on its entry; on another board: where it is", () => {
    const own = entry({ card_id: "c-1", board: "side" });
    const entries = [own];
    expect(addTargetEntry(entries, { kind: "card", cardId: "c-1", title: "Ember" }, "side")).toBe(own);
    expect(addTargetEntry(entries, { kind: "card", cardId: "c-1", title: "Ember" }, "main")).toBeNull();
    expect(cardElsewhere(entries, "c-1", "main")).toBe(own);
    expect(cardElsewhere(entries, "c-1", "side")).toBeNull();
  });

  it("a real card: its printing's entry, else the same name's real-card entry on the board — never a second line", () => {
    const printing = entry({ name: "Sol Ring", scryfall_id: "sf-a" });
    const yours = entry({ name: "Sol Ring", scryfall_id: "sf-b", card_id: "c-sun" });
    const placeholder = entry({ name: "Sol Ring" });
    const side = entry({ name: "Sol Ring", scryfall_id: "sf-c", board: "side" });
    const entries = [yours, printing, placeholder, side];
    expect(addTargetEntry(entries, { kind: "printing", scryfallId: "sf-b", name: "Sol Ring" }, "main")).toBe(yours);
    // Two rows of the printing (a Move never merges): the real card's own
    // row before your version of it.
    const plainOfB = entry({ name: "Sol Ring", scryfall_id: "sf-b" });
    expect(addTargetEntry([yours, plainOfB], { kind: "printing", scryfallId: "sf-b", name: "Sol Ring" }, "main")).toBe(plainOfB);
    // Another printing of it: the real card's own line before your version.
    expect(addTargetEntry(entries, { kind: "printing", scryfallId: "sf-z", name: "Sol Ring" }, "main")).toBe(printing);
    expect(addTargetEntry([yours, placeholder], { kind: "printing", scryfallId: "sf-z", name: "Sol Ring" }, "main")).toBe(yours);
    // A name-only placeholder is not a real card: a new line.
    expect(addTargetEntry([placeholder], { kind: "printing", scryfallId: "sf-z", name: "Sol Ring" }, "main")).toBeNull();
    expect(addTargetEntry(entries, { kind: "printing", scryfallId: "sf-z", name: "Sol Ring" }, "maybe")).toBeNull();
  });
});

describe("the owner's card search, read as typed", () => {
  it("folds a quote, an apostrophe and a dash to every form a title may store", () => {
    expect(typedFoldPattern("Urza's")).toBe("Urza['‘’]s");
    expect(typedFoldPattern("Urza’s")).toBe("Urza['‘’]s");
    expect(typedFoldPattern('"Last" Stand')).toBe('["“”]Last["“”] Stand');
    expect(typedFoldPattern("wait-what")).toBe("wait[-–—]what");
  });

  it("escapes every other pattern character — a search is never a pattern", () => {
    const pattern = typedFoldPattern("a.b*c+(d)[e]^$|?{f}\\");
    expect(new RegExp(pattern).test("a.b*c+(d)[e]^$|?{f}\\")).toBe(true);
    expect(new RegExp(pattern).test("axbbbc")).toBe(false);
    // No `_`-style wildcard: "n't" never matches "Constrictor".
    expect(new RegExp(typedFoldPattern("n't"), "i").test("Constrictor")).toBe(false);
  });

  it("the query is trimmed, its spaces one, at most 100 characters", () => {
    expect(normalizeAddQuery("  sol    ring \n")).toBe("sol ring");
    expect(normalizeAddQuery("x".repeat(300))).toHaveLength(100);
  });
});

describe("real cards, in the order a typeahead offers them", () => {
  it("the name typed whole, then whole words (at the start, then anywhere), then names and words that start with it — each in Scryfall's (most played) order", () => {
    const answer = ["Solemn Simulacrum", "Sol Ring", "Arcane Signet", "Sol Talisman", "Soldevi Adnate", "Swords of Sol"].map((name) => ({ name }));
    expect(rankRealCards(answer, "sol ring").map((card) => card.name)).toEqual([
      "Sol Ring",
      "Solemn Simulacrum",
      "Arcane Signet",
      "Sol Talisman",
      "Soldevi Adnate",
      "Swords of Sol",
    ]);
    expect(rankRealCards(answer, "sol", 4).map((card) => card.name)).toEqual(["Sol Ring", "Sol Talisman", "Swords of Sol", "Solemn Simulacrum"]);
    expect(rankRealCards([{ name: "Boltwing" }, { name: "Lightning Bolt" }, { name: "Bolt" }], "bolt").map((card) => card.name)).toEqual([
      "Bolt",
      "Lightning Bolt",
      "Boltwing",
    ]);
  });

  it("Scryfall's real answer for \"bolt\" (order=edhrec): Lightning Bolt first, not fifth", () => {
    const answer = ["Boltwing Marauder", "Bolt Bend", "Boltbender", "Thunderbolt", "Lightning Bolt", "Chain Lightning", "Fireblast"].map(
      (name) => ({ name }),
    );
    expect(rankRealCards(answer, "bolt", 3).map((card) => card.name)).toEqual(["Bolt Bend", "Lightning Bolt", "Boltwing Marauder"]);
  });
});

describe("a result's picture", () => {
  it("Scryfall's PNG at the JPEG size a surface draws", () => {
    const png = "https://cards.scryfall.io/png/front/a/b/abc.png?1700000000";
    expect(scryfallPictureAt(png, "small")).toBe("https://cards.scryfall.io/small/front/a/b/abc.jpg?1700000000");
    expect(scryfallPictureAt(png, "normal")).toBe("https://cards.scryfall.io/normal/front/a/b/abc.jpg?1700000000");
    expect(scryfallPictureAt("https://cards.scryfall.io/art_crop/front/a/b/abc.jpg", "small")).toBe(
      "https://cards.scryfall.io/art_crop/front/a/b/abc.jpg",
    );
    expect(scryfallPictureAt(null, "small")).toBeNull();
  });
});
