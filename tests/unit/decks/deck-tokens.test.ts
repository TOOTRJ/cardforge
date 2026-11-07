import { describe, expect, it } from "vitest";
import {
  cardTokenTexts,
  collectDeckTokens,
  realTokenSourceIds,
  scryfallImageForId,
  tokenPartsOf,
  tokenSpecsFromRulesText,
  tokensFromRulesText,
  type TokenPart,
  type TokenSourceItem,
} from "@/lib/decks/deck-tokens";

// ---------------------------------------------------------------------------
// The deck page's "Tokens & emblems" (TODO DK5.16): display only. Real cards
// through Scryfall's all_parts (tokens and emblems, never the card itself or
// a meld / combo piece); PipGlyph cards through the STANDARD templates of
// their own words; nothing a viewer can't read (a "Private card" row has no
// card and no printing) and nothing on the maybeboard.
// ---------------------------------------------------------------------------

const GOLDSPAN = "11111111-1111-4111-8111-111111111111";
const TREASURE = "22222222-2222-4222-8222-222222222222";
const TREASURE_2 = "33333333-3333-4333-8333-333333333333";
const EMBLEM = "44444444-4444-4444-8444-444444444444";

describe("tokenPartsOf — Scryfall's related objects", () => {
  it("keeps tokens, emblems and helper cards, never the card or a meld piece", () => {
    const parts = tokenPartsOf({
      id: GOLDSPAN,
      all_parts: [
        { id: GOLDSPAN, component: "combo_piece", name: "Goldspan Dragon", type_line: "Creature — Dragon" },
        { id: TREASURE, component: "token", name: "Treasure", type_line: "Token Artifact — Treasure" },
        { id: EMBLEM, component: "combo_piece", name: "Chandra Emblem", type_line: "Emblem — Chandra" },
        { id: "55555555-5555-4555-8555-555555555555", component: "meld_result", name: "Brisela", type_line: "Legendary Creature" },
        { id: "66666666-6666-4666-8666-666666666666", component: "combo_piece", name: "Tomb of Annihilation", type_line: "Dungeon" },
        { id: TREASURE, component: "token", name: "Treasure", type_line: "Token Artifact — Treasure" },
      ],
    });
    expect(parts).toEqual([
      { id: TREASURE, name: "Treasure", typeLine: "Token Artifact — Treasure", kind: "token" },
      { id: EMBLEM, name: "Chandra Emblem", typeLine: "Emblem — Chandra", kind: "emblem" },
      { id: "66666666-6666-4666-8666-666666666666", name: "Tomb of Annihilation", typeLine: "Dungeon", kind: "helper" },
    ]);
  });

  it("keeps the helper cards Scryfall files as combo pieces (Monarch, Initiative, Day // Night)", () => {
    const parts = tokenPartsOf({
      id: GOLDSPAN,
      all_parts: [
        { id: "a1111111-1111-4111-8111-111111111111", component: "combo_piece", name: "The Monarch", type_line: "Card" },
        {
          id: "a2222222-2222-4222-8222-222222222222",
          component: "combo_piece",
          name: "Undercity // The Initiative",
          type_line: "Dungeon — Undercity // Card",
        },
        { id: "a3333333-3333-4333-8333-333333333333", component: "combo_piece", name: "Day // Night", type_line: "Card // Card" },
        { id: "a4444444-4444-4444-8444-444444444444", component: "combo_piece", name: "Energy Reserve", type_line: "Card" },
        { id: "a5555555-5555-4555-8555-555555555555", component: "combo_piece", name: "The Ring // The Ring Tempts You", type_line: "Emblem // Card" },
      ],
    });
    expect(parts.map((p) => [p.name, p.kind])).toEqual([
      ["The Monarch", "helper"],
      ["Undercity // The Initiative", "helper"],
      ["Day // Night", "helper"],
      ["Energy Reserve", "helper"],
      ["The Ring // The Ring Tempts You", "emblem"],
    ]);
  });

  it("a combo piece that is a real card is never a helper", () => {
    const parts = tokenPartsOf({
      id: GOLDSPAN,
      all_parts: [
        { id: "b1111111-1111-4111-8111-111111111111", component: "combo_piece", name: "Thassa's Oracle", type_line: "Creature — Merfolk Wizard" },
        { id: "b2222222-2222-4222-8222-222222222222", component: "combo_piece", name: "Delver", type_line: "Creature — Human // Creature — Insect" },
        { id: "b3333333-3333-4333-8333-333333333333", component: "combo_piece", name: "No type", type_line: null },
        { id: "b4444444-4444-4444-8444-444444444444", component: "combo_piece", name: "Half", type_line: "Card // Creature — Insect" },
      ],
    });
    expect(parts).toEqual([]);
  });

  it("a card with no all_parts makes nothing", () => {
    expect(tokenPartsOf({ id: GOLDSPAN })).toEqual([]);
    expect(tokenPartsOf({ id: GOLDSPAN, all_parts: null })).toEqual([]);
  });
});

describe("tokensFromRulesText — the standard templates only", () => {
  it("a creature token: P/T, colours, types, abilities", () => {
    expect(tokensFromRulesText("When Rotbloom Pact dies, create two 1/1 green Saproling creature tokens.", "Rotbloom Pact")).toEqual([
      { kind: "token", name: "Saproling", typeLine: "Token Creature — Saproling", details: "1/1 green" },
    ]);
    expect(tokensFromRulesText("Create a 1/1 white Spirit creature token with flying.", "X")).toEqual([
      { kind: "token", name: "Spirit", typeLine: "Token Creature — Spirit", details: "1/1 white · flying" },
    ]);
    expect(tokensFromRulesText("Create a 2/2 red and white Soldier Warrior creature token with vigilance and haste.", "X")[0]).toEqual({
      kind: "token",
      name: "Soldier Warrior",
      typeLine: "Token Creature — Soldier Warrior",
      details: "2/2 red and white · vigilance and haste",
    });
  });

  it("the card types of an artifact / enchantment creature token", () => {
    expect(
      tokensFromRulesText("{2}{R}, {T}, Sacrifice a land: Create a 3/3 colorless Golem enchantment artifact creature token.", "Forge")[0],
    ).toEqual({ kind: "token", name: "Golem", typeLine: "Token Enchantment Artifact Creature — Golem", details: "3/3 colorless" });
  });

  it("the predefined artifact tokens", () => {
    expect(tokensFromRulesText("Whenever this attacks, create a Treasure token.\nCreate two Food tokens.", "X").map((t) => t.name)).toEqual([
      "Treasure",
      "Food",
    ]);
    expect(tokensFromRulesText("Create a tapped Clue token.", "X")[0].typeLine).toBe("Token Artifact — Clue");
  });

  it("a walker's emblem, named for its card, its ability the details", () => {
    expect(
      tokensFromRulesText('−7: You get an emblem with "Instant and sorcery spells you cast cost {2} less."', "Veyra, Stormbound"),
    ).toEqual([
      {
        kind: "emblem",
        name: "Veyra, Stormbound Emblem",
        typeLine: "Emblem",
        details: "Instant and sorcery spells you cast cost {2} less",
      },
    ]);
  });

  it("leaves out copies, reminder text, tokens named outside a create, and quoted abilities", () => {
    expect(tokensFromRulesText("Create a token that's a copy of target creature you control.", "X")).toEqual([]);
    expect(tokensFromRulesText("Investigate. (Create a Clue token. It's an artifact with …)", "X")).toEqual([]);
    expect(tokensFromRulesText("Sacrifice a Treasure token: Draw a card.", "X")).toEqual([]);
    expect(tokensFromRulesText("Creatures you control have \"{T}: Create a Food token.\"", "X")).toEqual([]);
    expect(tokensFromRulesText("", "X")).toEqual([]);
    expect(tokensFromRulesText(null, "X")).toEqual([]);
  });

  it("reads what comes after the verb, never the trigger before it", () => {
    expect(tokensFromRulesText("Whenever a 1/1 green Elf creature you control dies, create a Treasure token.", "X").map((t) => t.name)).toEqual([
      "Treasure",
    ]);
  });
});

describe("cardTokenTexts — every text of a card", () => {
  it("rules text, walker rows, saga chapters and a second face", () => {
    expect(
      cardTokenTexts({
        rules_text: "Flying",
        face_content: {
          loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }] },
          saga: { intro: "Intro", chapters: [{ numerals: [3], text: "Create a 4/4 green Beast creature token." }] },
        },
        back_face: { rules_text: "Create a Treasure token." },
      }),
    ).toEqual(["Flying", "Draw a card.", "Intro", "Create a 4/4 green Beast creature token.", "Create a Treasure token."]);
    expect(cardTokenTexts({ rules_text: null, face_content: "junk", back_face: 7 })).toEqual([]);
  });
});

function printing(name: string, scryfallId: string | null, board = "main"): TokenSourceItem {
  return { entry: { board, name, scryfall_id: scryfallId, quantity: 1 }, card: null };
}

describe("the deck's list", () => {
  const parts: Record<string, TokenPart[]> = {
    [GOLDSPAN]: [{ id: TREASURE, name: "Treasure", typeLine: "Token Artifact — Treasure", kind: "token" }],
    [TREASURE_2]: [{ id: TREASURE_2, name: "Treasure", typeLine: "Token Artifact — Treasure", kind: "token" }],
  };

  it("asks Scryfall only for played printings with no PipGlyph card, once each, sorted", () => {
    expect(
      realTokenSourceIds([
        printing("Goldspan Dragon", GOLDSPAN),
        printing("Goldspan Dragon", GOLDSPAN, "sideboard"),
        printing("Maybe", TREASURE_2, "maybe"),
        printing("Plain line", null),
        { entry: { board: "main", name: "Proxy", scryfall_id: EMBLEM, quantity: 1 }, card: { title: "My Dragon", rules_text: "Flying" } },
      ]),
    ).toEqual([GOLDSPAN]);
  });

  it("one token from two cards (and two printings of it) is listed once with both makers; tokens before emblems", () => {
    const items: TokenSourceItem[] = [
      printing("Goldspan Dragon", GOLDSPAN),
      printing("Smothering Tithe", TREASURE_2),
      { entry: { board: "main", name: "Veyra", scryfall_id: null, quantity: 1 }, card: { title: "Veyra", rules_text: 'You get an emblem with "Flying."' } },
      { entry: { board: "commander", name: "Pirate", scryfall_id: null, quantity: 1 }, card: { title: "Pirate", rules_text: "Create a Treasure token." } },
    ];
    const tokens = collectDeckTokens(items, parts);
    expect(tokens.map((t) => [t.kind, t.name, t.makers])).toEqual([
      ["token", "Treasure", ["Goldspan Dragon", "Pirate", "Smothering Tithe"]],
      ["emblem", "Veyra Emblem", ["Veyra"]],
    ]);
    // The real token's picture, from its id.
    expect(tokens[0].imageUrl).toBe(scryfallImageForId(TREASURE));
  });

  it("a PipGlyph card makes what ITS words say, even on a printing", () => {
    const tokens = collectDeckTokens(
      [{ entry: { board: "main", name: "Goldspan Dragon", scryfall_id: GOLDSPAN, quantity: 1 }, card: { title: "Gilded Wyrm", rules_text: "Create a Food token." } }],
      parts,
    );
    expect(tokens.map((t) => t.name)).toEqual(["Food"]);
  });

  it("a row the viewer can't read (\"Private card\": no card, no printing) and the maybeboard make nothing", () => {
    expect(
      collectDeckTokens(
        [
          { entry: { board: "main", name: "Private card", scryfall_id: null, quantity: 1 }, card: null },
          printing("Goldspan Dragon", GOLDSPAN, "maybe"),
          { entry: { board: "maybe", name: "Maybe", scryfall_id: null, quantity: 1 }, card: { title: "Maybe", rules_text: "Create a Clue token." } },
        ],
        parts,
      ),
    ).toEqual([]);
  });
});

describe("scryfallImageForId", () => {
  it("builds the CDN's path from an id, nothing from anything else", () => {
    expect(scryfallImageForId(TREASURE)).toBe(`https://cards.scryfall.io/small/front/2/2/${TREASURE}.jpg`);
    expect(scryfallImageForId("../../etc", "normal")).toBeNull();
  });
});

describe("tokenSpecsFromRulesText — the token kit's structured read", () => {
  it("reads the count, the colours, the stats and whether it repeats", () => {
    const [spirit] = tokenSpecsFromRulesText("Whenever you cast a spell, create two 1/1 white Spirit creature tokens with flying.", "X");
    expect(spirit).toMatchObject({
      kind: "token",
      name: "Spirit",
      typeWords: "Creature",
      subtypes: ["Spirit"],
      colors: ["white"],
      power: "1",
      toughness: "1",
      abilities: "flying",
      count: 2,
      repeats: true,
    });
    const [once] = tokenSpecsFromRulesText("When this creature enters, create a 3/3 green Beast creature token.", "X");
    expect(once).toMatchObject({ count: 1, repeats: false, colors: ["green"] });
  });

  it("an activated ability repeats; X and 'that many' are a variable count", () => {
    const [treasure] = tokenSpecsFromRulesText("{2}, {T}: Create a tapped Treasure token.", "X");
    expect(treasure).toMatchObject({ name: "Treasure", typeWords: "Artifact", colors: ["colorless"], count: 1, repeats: true });
    const [x] = tokenSpecsFromRulesText("Create X 2/2 black Zombie creature tokens.", "X");
    expect(x.count).toBeNull();
    const [many] = tokenSpecsFromRulesText("Create that many Food tokens.", "X");
    expect(many.count).toBeNull();
  });

  it("three colours keep their phrase on the deck page", () => {
    expect(tokensFromRulesText("Create a 4/4 white, blue and black Angel creature token.", "X")[0].details).toBe("4/4 white, blue and black");
  });

  it("an emblem keeps its ability", () => {
    expect(tokenSpecsFromRulesText('-6: You get an emblem with "Creatures you control get +1/+1."', "Veyra")).toEqual([
      {
        kind: "emblem",
        name: "Veyra Emblem",
        typeWords: null,
        subtypes: [],
        colors: [],
        power: null,
        toughness: null,
        abilities: "Creatures you control get +1/+1",
        count: 1,
        repeats: false,
      },
    ]);
  });
});
