import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  fallbackIdentifier,
  finishFor,
  firstPassIdentifier,
  indexCards,
  matchLine,
  uniqueIdentifiers,
} from "@/lib/tools/collection/resolve";
import { canLeadCommanderDeck, collectionRowFor, collectionRowKey } from "@/lib/tools/collection/card-row";

// ---------------------------------------------------------------------------
// Matching import lines to Scryfall's printings (lib/tools/collection/
// resolve.ts) and the row a printing becomes (card-row.ts). Scryfall drops
// misses from a /cards/collection answer, so a match is by content — and a
// printing hit only counts when its NAME agrees with the line.
// ---------------------------------------------------------------------------

function printing(over: Partial<ScryfallCard> & { name: string }): ScryfallCard {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    set: "dom",
    collector_number: "168",
    lang: "en",
    finishes: ["nonfoil", "foil"],
    ...over,
  } as ScryfallCard;
}

const line = (over: Partial<Parameters<typeof matchLine>[0]>) => ({
  name: "Llanowar Elves",
  setCode: null,
  collectorNumber: null,
  scryfallId: null,
  ...over,
});

describe("identifiers", () => {
  it("the best one a line carries: id, then set + number, then name + set, then name", () => {
    expect(firstPassIdentifier(line({ scryfallId: "abc" }))).toEqual({ id: "abc" });
    expect(firstPassIdentifier(line({ setCode: "dom", collectorNumber: "168" }))).toEqual({ set: "dom", collector_number: "168" });
    expect(firstPassIdentifier(line({ setCode: "dom" }))).toEqual({ name: "Llanowar Elves", set: "dom" });
    expect(firstPassIdentifier(line({}))).toEqual({ name: "Llanowar Elves" });
  });

  it("the second pass asks by name, or a split card's front face; never the same thing again", () => {
    expect(fallbackIdentifier(line({ setCode: "dar", collectorNumber: "168" }))).toEqual({ name: "Llanowar Elves" });
    expect(fallbackIdentifier(line({}))).toBeNull();
    expect(fallbackIdentifier(line({ name: "Fire/Ice" }))).toEqual({ name: "Fire" });
  });

  it("duplicates go once, compared folded", () => {
    expect(uniqueIdentifiers([{ name: "Sol Ring" }, { name: "sol  ring" }, null, { id: "A" }, { id: "a" }])).toEqual([
      { name: "Sol Ring" },
      { id: "A" },
    ]);
  });
});

describe("matching", () => {
  const elves = printing({ name: "Llanowar Elves" });

  it("by id, by printing, by name and set, by name", () => {
    const index = indexCards([elves]);
    expect(matchLine(line({ scryfallId: elves.id }), index)).toEqual({ ok: true, card: elves });
    expect(matchLine(line({ setCode: "dom", collectorNumber: "168" }), index)).toEqual({ ok: true, card: elves });
    expect(matchLine(line({ setCode: "DOM" }), index)).toEqual({ ok: true, card: elves });
    expect(matchLine(line({ name: "llanowar elves" }), index)).toEqual({ ok: true, card: elves });
  });

  it("a printing hit with ANOTHER card's name never goes in under the line's name", () => {
    const index = indexCards([printing({ name: "Shivan Dragon" })]);
    const match = matchLine(line({ setCode: "dom", collectorNumber: "168" }), index);
    expect(match).toEqual({
      ok: false,
      reason: "DOM 168 is Shivan Dragon, not Llanowar Elves, and Scryfall has no card named Llanowar Elves.",
    });
  });

  it("a double-faced card answers to its front face and its full name", () => {
    const dfc = printing({
      name: "Delver of Secrets // Insectile Aberration",
      card_faces: [{ name: "Delver of Secrets" }, { name: "Insectile Aberration" }],
    } as Partial<ScryfallCard> & { name: string });
    const index = indexCards([dfc]);
    expect(matchLine(line({ name: "Delver of Secrets" }), index).ok).toBe(true);
    expect(matchLine(line({ name: "Delver of Secrets // Insectile Aberration" }), index).ok).toBe(true);
  });

  it("curly quotes and accents fold", () => {
    const index = indexCards([printing({ name: "Séance" }), printing({ id: "2", name: "Urza’s Saga" })]);
    expect(matchLine(line({ name: "Seance" }), index).ok).toBe(true);
    expect(matchLine(line({ name: "Urza's Saga" }), index).ok).toBe(true);
  });

  it("no match says the name", () => {
    expect(matchLine(line({ name: "Not A Card" }), indexCards([]))).toEqual({
      ok: false,
      reason: "Scryfall has no card named “Not A Card”.",
    });
  });

  it("a finish the printing doesn't come in falls back to one it does", () => {
    expect(finishFor(printing({ name: "x", finishes: ["nonfoil"] }), "foil")).toBe("nonfoil");
    expect(finishFor(printing({ name: "x", finishes: ["foil"] }), "nonfoil")).toBe("foil");
    expect(finishFor(printing({ name: "x", finishes: ["nonfoil", "etched"] }), "etched")).toBe("etched");
  });
});

describe("the stored row", () => {
  it("is Scryfall's data: legality, commander, picture host, WUBRG only", () => {
    const krenko = {
      ...printing({
        name: "Krenko, Mob Boss",
        type_line: "Legendary Creature — Goblin Warrior",
        color_identity: ["R"],
        cmc: 4,
        image_uris: { normal: "https://cards.bcdn.scryfall.io/normal/front/a/b/ab.jpg?123" },
      } as Partial<ScryfallCard> & { name: string }),
      legalities: { commander: "legal" },
    } as ScryfallCard;
    const row = collectionRowFor(krenko, { finish: "foil", quantity: 3, sourceLine: "3 Krenko" });
    expect(row).toMatchObject({
      name: "Krenko, Mob Boss",
      finish: "foil",
      quantity: 3,
      lang: "en",
      color_identity: ["R"],
      mana_value: 4,
      commander_legal: true,
      can_be_commander: true,
      image_url: "https://cards.scryfall.io/normal/front/a/b/ab.jpg",
      source_line: "3 Krenko",
    });
    expect(collectionRowKey(row)).toBe(`${krenko.id}|foil|en`);
  });

  it("no legality is not legal; a walker that says so can lead", () => {
    const walker = printing({ name: "Teferi", type_line: "Legendary Planeswalker — Teferi", oracle_text: "Teferi can be your commander." });
    expect(collectionRowFor(walker, { finish: "nonfoil", quantity: 1 }).commander_legal).toBe(false);
    expect(canLeadCommanderDeck(walker)).toBe(true);
    expect(canLeadCommanderDeck(printing({ name: "Elf", type_line: "Creature — Elf" }))).toBe(false);
  });
});
