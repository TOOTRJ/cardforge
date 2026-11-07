import { describe, expect, it } from "vitest";
import { buildKitItems, kitFaceFromSpec, kitFaceKey, kitFacesFromPrinting, suggestedCopies, type KitMaker } from "@/lib/tools/token-kit/collect";
import { tokenSpecsFromRulesText } from "@/lib/decks/deck-tokens";
import type { ScryfallCard } from "@/lib/scryfall/client";

const TREASURE_ID = "22222222-2222-4222-8222-222222222222";
const DAYNIGHT_ID = "33333333-3333-4333-8333-333333333333";

const treasurePrinting = {
  id: TREASURE_ID,
  name: "Treasure",
  layout: "token",
  type_line: "Token Artifact — Treasure",
  oracle_text: "{T}, Sacrifice this artifact: Add one mana of any color.",
  colors: [],
} as unknown as ScryfallCard;

describe("kitFacesFromPrinting", () => {
  it("a token printing's words, colours and stats", () => {
    const [spirit] = kitFacesFromPrinting({
      id: "x",
      name: "Spirit",
      type_line: "Token Creature — Spirit",
      oracle_text: "Flying",
      power: "1",
      toughness: "1",
      colors: ["W"],
    } as unknown as ScryfallCard);
    expect(spirit).toEqual({
      kind: "token",
      title: "Spirit",
      typeWords: "Creature",
      subtypes: ["Spirit"],
      colors: ["white"],
      rulesText: "Flying",
      flavorText: null,
      power: "1",
      toughness: "1",
    });
    expect(kitFacesFromPrinting(treasurePrinting)[0]).toMatchObject({ typeWords: "Artifact", colors: [] });
  });

  it("each face of a double-faced helper is its own item; an emblem drops ' Emblem'", () => {
    const faces = kitFacesFromPrinting({
      id: DAYNIGHT_ID,
      name: "Day // Night",
      type_line: "Card // Card",
      card_faces: [
        { name: "Day", type_line: "Card", oracle_text: "If it's night, and a player casts two or more spells during a turn, it becomes night next turn." },
        { name: "Night", type_line: "Card", oracle_text: "If it's day, and a player casts no spells during their own turn, it becomes day next turn." },
      ],
    } as unknown as ScryfallCard);
    expect(faces.map((f) => [f.kind, f.title])).toEqual([
      ["helper", "Day"],
      ["helper", "Night"],
    ]);
    const [emblem] = kitFacesFromPrinting({
      id: "e",
      name: "Chandra, Torch of Defiance Emblem",
      type_line: "Emblem — Chandra",
      oracle_text: "Whenever you cast a spell, this emblem deals 5 damage to any target.",
    } as unknown as ScryfallCard);
    expect(emblem).toMatchObject({ kind: "emblem", title: "Chandra, Torch of Defiance", subtypes: [] });
    const [, initiative] = kitFacesFromPrinting({
      id: "i",
      name: "Undercity // The Initiative",
      type_line: "Dungeon — Undercity // Card",
      card_faces: [
        { name: "Undercity", type_line: "Dungeon — Undercity", oracle_text: "…" },
        { name: "The Initiative", type_line: "Card", oracle_text: "Whenever one or more creatures a player controls deal combat damage to you, that player takes the initiative." },
      ],
    } as unknown as ScryfallCard);
    expect(initiative).toMatchObject({ kind: "helper", title: "The Initiative" });
  });
});

describe("kitFaceFromSpec — a PipGlyph card's own words", () => {
  it("a creature token's keyword line; a predefined token's printed rules", () => {
    const [soldiers] = tokenSpecsFromRulesText("Create two 2/2 red and white Soldier Warrior creature tokens with vigilance and haste.", "X");
    expect(kitFaceFromSpec(soldiers)).toEqual({
      kind: "token",
      title: "Soldier Warrior",
      typeWords: "Creature",
      subtypes: ["Soldier", "Warrior"],
      colors: ["white", "red"],
      rulesText: "Vigilance, haste",
      flavorText: null,
      power: "2",
      toughness: "2",
    });
    const [treasure] = tokenSpecsFromRulesText("Create a Treasure token.", "X");
    expect(kitFaceFromSpec(treasure).rulesText).toBe("{T}, Sacrifice this artifact: Add one mana of any color.");
  });

  it("the words' Treasure and Scryfall's Treasure are the same item", () => {
    const [spec] = tokenSpecsFromRulesText("Create a Treasure token.", "X");
    const fromWords = kitFaceFromSpec(spec);
    const fromScryfall = kitFacesFromPrinting(treasurePrinting)[0];
    // Scryfall names no colour for a colourless token; the words say
    // colourless — the key folds both to the same token only when they agree.
    expect(kitFaceKey({ ...fromWords, colors: [] })).toBe(kitFaceKey(fromScryfall));
  });

  it("a key stays short (a saved kit's item key) and still tells tokens apart", () => {
    const fromScryfall = kitFacesFromPrinting(treasurePrinting)[0];
    const dungeon = { ...fromScryfall, kind: "helper" as const, title: "Undercity", typeWords: "Dungeon", rulesText: "Secret Entrance — Search your library. ".repeat(40) };
    const key = kitFaceKey(dungeon);
    expect(key.length).toBeLessThan(80);
    expect(key).toMatch(/^helper:undercity:[0-9a-f]{16}$/);
    expect(kitFaceKey({ ...dungeon, rulesText: `${dungeon.rulesText} Then shuffle.` })).not.toBe(key);
    expect(kitFaceKey({ ...fromScryfall, power: "1", toughness: "1" })).not.toBe(kitFaceKey(fromScryfall));
  });
});

describe("suggestedCopies", () => {
  it("one-shot, repeating, multiples, variable counts, doublers, the cap", () => {
    const one = { maker: "A", count: 1, repeats: false, quantity: 1, commander: false };
    expect(suggestedCopies("token", [one], []).copies).toBe(1);
    expect(suggestedCopies("token", [{ ...one, count: 2, repeats: true }], []).copies).toBe(4);
    expect(suggestedCopies("token", [{ ...one, repeats: true }], []).copies).toBe(3);
    expect(suggestedCopies("token", [{ ...one, quantity: 4 }], []).copies).toBe(2);
    expect(suggestedCopies("token", [{ ...one, count: null }], []).copies).toBe(3);
    const doubled = suggestedCopies("token", [{ ...one, count: 2 }], ["Parallel Lives"]);
    expect(doubled).toEqual({ copies: 4, why: ["doubled by Parallel Lives"] });
    expect(suggestedCopies("token", [{ ...one, count: 10, repeats: true }], []).copies).toBe(12);
    expect(suggestedCopies("emblem", [one], ["Parallel Lives"]).copies).toBe(1);
  });
});

describe("buildKitItems", () => {
  it("one item per token with every maker, the count read from the maker's words", () => {
    const makers: KitMaker[] = [
      {
        name: "Goldspan Dragon",
        quantity: 1,
        commander: false,
        texts: ["Flying, haste\nWhenever Goldspan Dragon attacks or becomes the target of a spell, create a Treasure token."],
        parts: [{ id: TREASURE_ID, name: "Treasure", typeLine: "Token Artifact — Treasure", kind: "token" }],
      },
      {
        name: "Smothering Tithe",
        quantity: 1,
        commander: false,
        texts: ["Whenever an opponent draws a card, that player may pay {2}. If the player doesn't, you create a Treasure token."],
        parts: [{ id: TREASURE_ID, name: "Treasure", typeLine: "Token Artifact — Treasure", kind: "token" }],
      },
      {
        name: "Homebrew Beastcaller",
        quantity: 1,
        commander: false,
        texts: ["When this creature enters, create a 3/3 green Beast creature token."],
        parts: null,
      },
      { name: "Vanilla", quantity: 1, commander: false, texts: [], parts: [{ id: "gone", name: "Gone", typeLine: "Token", kind: "token" }] },
    ];
    const { items, missing } = buildKitItems(makers, { [TREASURE_ID]: kitFacesFromPrinting(treasurePrinting) });
    expect(missing).toBe(1);
    expect(items.map((i) => [i.face.title, i.makers, i.suggested])).toEqual([
      ["Beast", ["Homebrew Beastcaller"], 1],
      ["Treasure", ["Goldspan Dragon", "Smothering Tithe"], 6],
    ]);
    expect(items[1].scryfallId).toBe(TREASURE_ID);
    expect(items[1].why).toContain("made again and again");
  });
});
