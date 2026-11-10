import { describe, expect, it } from "vitest";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import {
  COLLECTION_DECK_TYPES,
  COLLECTION_DECK_TYPE_IDS,
  TYPAL_FLOOR,
  cardFitsTribe,
  choiceError,
  collectionDeckType,
  commanderDeckTypes,
  deckTypeKeyFor,
  draftPlanFor,
  refusalFloor,
  type BracketCardLists,
} from "@/lib/tools/collection/archetypes";
import { LAND_TARGET, cardKey, draftCommanderDeck, eligiblePool, gameChangerCap } from "@/lib/tools/collection/builder";
import { DECK_TYPES } from "@/lib/decks/deck-types";

// ---------------------------------------------------------------------------
// The collection builder's deck types, creature types and bracket target
// (lib/tools/collection/archetypes.ts + the drafter's plan, owner decisions
// 2026-11-09): 17 types in 7 groups whose patterns read Oracle's current
// wording; Stax and Combo only from Bracket 3; every type saved as a deck
// type key; the bracket's lists (read from Scryfall, never written here)
// bar Game Changers in 1–2, cap them at three in 3 with the commander
// counting, bar mass land denial in 1–3 and cap extra turns.
// ---------------------------------------------------------------------------

let seq = 0;
function card(name: string, over: Partial<CollectionCard> = {}): CollectionCard {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    scryfallId: `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name,
    typeLine: "Creature — Human",
    manaCost: "{1}{R}",
    manaValue: 2,
    colorIdentity: ["R"],
    oracleText: "",
    rarity: "common",
    setCode: "tst",
    setName: "Test",
    collectorNumber: String(seq),
    imageUrl: null,
    quantity: 1,
    finish: "nonfoil",
    lang: "en",
    commanderLegal: true,
    canBeCommander: false,
    ...over,
  };
}

const type = (id: string) => collectionDeckType(id)!;

describe("the deck types", () => {
  it("are 17, in 8 groups, each saved as a deck type key the deck form knows", () => {
    expect(COLLECTION_DECK_TYPES).toHaveLength(17);
    expect(new Set(COLLECTION_DECK_TYPES.map((t) => t.group)).size).toBe(8);
    for (const id of COLLECTION_DECK_TYPE_IDS) expect(DECK_TYPES.some((t) => t.key === id)).toBe(true);
  });

  it.each([
    ["tokens", "Create two 1/1 white Soldier creature tokens.", "Creature — Human", true],
    ["tokens", "This spell deals 3 damage to any target.", "Instant", false],
    ["counters", "Put a +1/+1 counter on target creature.", "Instant", true],
    ["aristocrats", "Whenever another creature you control dies, each opponent loses 1 life.", "Creature — Vampire", true],
    ["voltron", "Equipped creature gets +2/+2.", "Artifact — Equipment", true],
    ["artifacts", "", "Artifact", true],
    ["enchantress", "", "Enchantment — Aura", true],
    ["superfriends", "", "Legendary Planeswalker — Jace", true],
    ["landfall", "Landfall — Whenever a land you control enters, create a 0/1 Plant creature token.", "Creature — Elemental", true],
    ["blink", "When this creature enters, draw a card.", "Creature — Human Wizard", true],
    ["blink", "Exile target creature you control, then return it to the battlefield under its owner's control.", "Instant", true],
    ["lifegain", "Whenever you gain life, put a +1/+1 counter on this creature.", "Creature — Cat", true],
    ["reanimator", "Return target creature card from your graveyard to the battlefield.", "Sorcery", true],
    ["spellslinger", "", "Instant", true],
    ["control", "Counter target spell.", "Instant", true],
    ["stax", "Spells your opponents cast cost {1} more to cast.", "Artifact", true],
    ["group-hug", "At the beginning of each player's upkeep, that player draws a card. Each player draws a card.", "Enchantment", true],
    ["mill", "Target player mills three cards.", "Sorcery", true],
    ["combo", "Search your library for a card, put it into your hand, then shuffle.", "Sorcery", true],
  ])("%s: %s (%s) → %s", (id, oracleText, typeLine, expected) => {
    expect(type(id).matches(card("X", { oracleText, typeLine }))).toBe(expected);
  });

  it("a legendary card names itself: Blink reads 'When Atraxa enters'", () => {
    const atraxa = card("Atraxa, Grand Unifier", {
      typeLine: "Legendary Creature — Phyrexian Angel",
      oracleText: "Flying, vigilance\nWhen Atraxa enters, reveal the top ten cards of your library.",
    });
    expect(type("blink").matches(atraxa)).toBe(true);
    expect(commanderDeckTypes(atraxa)).toContain("blink");
  });

  it.each([
    ["tokens", "Create a Treasure token.", "Artifact", false],
    ["tokens", "Create a 1/1 white Soldier creature token.", "Sorcery", true],
    ["group-hug", "Target player draws three cards.", "Sorcery", false],
    ["group-hug", "Target opponent draws a card. You gain 2 life.", "Sorcery", true],
    ["mill", "You mill four cards.", "Sorcery", false],
    ["mill", "Each opponent mills four cards.", "Sorcery", true],
    ["reanimator", "You mill four cards.", "Sorcery", true],
  ])("precision — %s: %s → %s", (id, oracleText, typeLine, expected) => {
    expect(type(id).matches(card("X", { oracleText, typeLine }))).toBe(expected);
  });

  it("reads Oracle's current self-reference, never the old 'enters the battlefield' alone", () => {
    expect(type("blink").matches(card("X", { oracleText: "When ~ enters, scry 2." }))).toBe(true);
    expect(type("blink").matches(card("X", { typeLine: "Sorcery", oracleText: "When this creature enters, draw." }))).toBe(false);
  });

  it("names the types a commander's own text plays into", () => {
    expect(commanderDeckTypes(card("Krenko", { oracleText: "{T}: Create X 1/1 red Goblin creature tokens." }))).toContain("tokens");
  });

  it("Stax and Combo only from Bracket 3", () => {
    expect(choiceError({ deckType: "stax", bracket: 2 })).toMatch(/Bracket 3 and up/);
    expect(choiceError({ deckType: "combo", bracket: 1 })).toMatch(/Bracket 3 and up/);
    expect(choiceError({ deckType: "stax", bracket: 3 })).toBeNull();
    expect(choiceError({ deckType: "stax" })).toBeNull();
    expect(choiceError({ deckType: "tokens", bracket: 1 })).toBeNull();
  });

  it("saves as the deck type, else the creature type's tribe key", () => {
    expect(deckTypeKeyFor({ deckType: "group-hug", tribe: "goblin" })).toBe("group-hug");
    expect(deckTypeKeyFor({ tribe: "goblin" })).toBe("goblins");
    expect(deckTypeKeyFor({ tribe: "elf" })).toBe("elves");
    expect(deckTypeKeyFor({ tribe: "faerie" })).toBe("faeries");
    expect(deckTypeKeyFor({ tribe: "merfolk" })).toBe("merfolk");
    expect(deckTypeKeyFor({ tribe: "octopus" })).toBeNull();
    expect(deckTypeKeyFor({})).toBeNull();
  });

  it("a creature type counts its creatures, changelings and the cards that name it", () => {
    expect(cardFitsTribe(card("A", { typeLine: "Creature — Goblin Warrior" }), "goblin")).toBe(true);
    expect(cardFitsTribe(card("B", { typeLine: "Creature — Shapeshifter", oracleText: "Changeling" }), "goblin")).toBe(true);
    expect(cardFitsTribe(card("C", { typeLine: "Sorcery", oracleText: "Goblin spells you cast cost {1} less." }), "goblin")).toBe(true);
    expect(cardFitsTribe(card("D", { typeLine: "Creature — Elf" }), "goblin")).toBe(false);
    // Plurals, and never "non-Human".
    expect(cardFitsTribe(card("E", { typeLine: "Sorcery", oracleText: "Elves you control get +1/+1." }), "elf")).toBe(true);
    expect(cardFitsTribe(card("F", { typeLine: "Sorcery", oracleText: "Allies you control gain lifelink." }), "ally")).toBe(true);
    expect(cardFitsTribe(card("G", { typeLine: "Instant", oracleText: "Destroy target non-Human creature." }), "human")).toBe(false);
  });

  it("the AI refuses below half a floor", () => {
    expect(refusalFloor(20)).toBe(10);
    expect(refusalFloor(TYPAL_FLOOR)).toBe(10);
    expect(refusalFloor(15)).toBe(8);
  });
});

describe("the drafter's plan", () => {
  const commander = card("Krenko", {
    typeLine: "Legendary Creature — Goblin Warrior",
    oracleText: "{T}: Create X 1/1 red Goblin creature tokens.",
    canBeCommander: true,
  });
  const lists = (over: Partial<Record<keyof BracketCardLists, string[]>> = {}): BracketCardLists => ({
    gameChangers: new Set((over.gameChangers ?? []).map(cardKey)),
    massLandDenial: new Set((over.massLandDenial ?? []).map(cardKey)),
    extraTurns: new Set((over.extraTurns ?? []).map(cardKey)),
  });
  const filler = (n: number) => Array.from({ length: n }, (_, i) => card(`Filler ${i}`));

  it("no choice is the plain draft", () => {
    expect(draftPlanFor({}, null)).toBeNull();
  });

  it("Brackets 1–2 bar Game Changers; 3 caps them at three, the commander counting", () => {
    const gcs = ["GC One", "GC Two", "GC Three", "GC Four"].map((name) => card(name));
    // Few enough cards that every eligible one makes the deck.
    const collection = [commander, ...gcs, ...filler(40)];
    const names = lists({ gameChangers: gcs.map((c) => c.name) });

    const core = draftCommanderDeck({ commander, collection, plan: draftPlanFor({ bracket: 2 }, names) });
    expect(core.picks.some((p) => p.name.startsWith("GC"))).toBe(false);
    expect(core.gameChangers).toBe(0);
    expect(core.bracketFloor).toBe(2);

    const upgraded = draftCommanderDeck({ commander, collection, plan: draftPlanFor({ bracket: 3 }, names) });
    expect(upgraded.picks.filter((p) => p.name.startsWith("GC"))).toHaveLength(gameChangerCap(3));
    expect(upgraded.bracketFloor).toBe(3);

    // A Game Changer commander takes one of the three.
    const gcCommander = { ...commander, name: "GC Krenko" };
    const withCommander = draftCommanderDeck({
      commander: gcCommander,
      collection: [gcCommander, ...gcs, ...filler(40)],
      plan: draftPlanFor({ bracket: 3 }, lists({ gameChangers: [...gcs.map((c) => c.name), "GC Krenko"] })),
    });
    expect(withCommander.picks.filter((p) => p.name.startsWith("GC"))).toHaveLength(2);
    expect(withCommander.gameChangers).toBe(3);
  });

  it("Brackets 1–3 bar mass land denial; extra turns are none in 1 and one in 2–3", () => {
    const collection = [commander, card("Armageddon"), card("Time Walk"), card("Time Warp"), ...filler(40)];
    const names = lists({ massLandDenial: ["Armageddon"], extraTurns: ["Time Walk", "Time Warp"] });
    const one = draftCommanderDeck({ commander, collection, plan: draftPlanFor({ bracket: 1 }, names) });
    expect(one.picks.some((p) => ["Armageddon", "Time Walk", "Time Warp"].includes(p.name))).toBe(false);
    const three = draftCommanderDeck({ commander, collection, plan: draftPlanFor({ bracket: 3 }, names) });
    expect(three.picks.some((p) => p.name === "Armageddon")).toBe(false);
    expect(three.picks.filter((p) => p.name.startsWith("Time"))).toHaveLength(1);
    const four = draftCommanderDeck({ commander, collection, plan: draftPlanFor({ bracket: 4 }, names) });
    expect(four.picks.some((p) => p.name === "Armageddon")).toBe(true);
    expect(four.bracketFloor).toBe(4);
  });

  it("the commander's own land denial and extra turns count too", () => {
    const hokori = { ...commander, name: "Hokori, Dust Drinker" };
    const mld = draftCommanderDeck({
      commander: hokori,
      collection: [hokori, ...filler(40)],
      plan: draftPlanFor({ bracket: 3 }, lists({ massLandDenial: ["Hokori, Dust Drinker"] })),
    });
    expect(mld.bracketFloor).toBe(4);
    expect(mld.warnings.join(" ")).toMatch(/denies lands to the whole table, so this deck can't be Bracket 3/);

    const medomai = { ...commander, name: "Medomai the Ageless" };
    const turns = draftCommanderDeck({
      commander: medomai,
      collection: [medomai, card("Time Warp"), ...filler(40)],
      plan: draftPlanFor({ bracket: 2 }, lists({ extraTurns: ["Medomai the Ageless", "Time Warp"] })),
    });
    // The commander takes the one extra-turn card Bracket 2 allows.
    expect(turns.picks.some((p) => p.name === "Time Warp")).toBe(false);
    const one = draftCommanderDeck({
      commander: medomai,
      collection: [medomai, ...filler(40)],
      plan: draftPlanFor({ bracket: 1 }, lists({ extraTurns: ["Medomai the Ageless"] })),
    });
    expect(one.warnings.join(" ")).toMatch(/takes extra turns, so this deck can't be Bracket 1/);
  });

  it("more than one extra turn needs Bracket 4", () => {
    const draft = draftCommanderDeck({
      commander,
      collection: [commander, card("Time Walk"), card("Time Warp"), ...filler(40)],
      plan: draftPlanFor({ bracket: 4 }, lists({ extraTurns: ["Time Walk", "Time Warp"] })),
    });
    expect(draft.bracketFloor).toBe(4);
  });

  it("a bracket whose lists couldn't be read is built, unchecked, and says so", () => {
    const draft = draftCommanderDeck({ commander, collection: [commander, ...filler(80)], plan: draftPlanFor({ bracket: 2 }, null) });
    expect(draft.bracket).toBe(2);
    expect(draft.gameChangers).toBeUndefined();
    expect(draft.warnings.join(" ")).toMatch(/couldn't be read just now/);
  });

  it("a deck type ranks its cards first, shifts the lands, and counts itself", () => {
    const makers = Array.from({ length: 12 }, (_, i) => card(`Maker ${i}`, { oracleText: "Create a 1/1 red Goblin creature token." }));
    const collection = [commander, ...filler(150), ...makers];
    const plan = draftPlanFor({ deckType: "landfall" }, null);
    const pool = eligiblePool(commander, collection, draftPlanFor({ deckType: "tokens" }, null));
    expect(pool.slice(0, 12).every((c) => c.name.startsWith("Maker"))).toBe(true);

    const tokens = draftCommanderDeck({ commander, collection, plan: draftPlanFor({ deckType: "tokens" }, null) });
    expect(tokens.focus).toEqual([{ label: "Tokens", inDeck: 12, inPool: 12, floor: 20 }]);
    expect(tokens.warnings.join(" ")).toMatch(/Only 12 of your cards in Krenko's colours are Tokens cards/);
    expect(plan?.lands).toBe(38);
    expect(LAND_TARGET).toBe(36);
  });

  it("a creature type ranks its creatures and changelings first", () => {
    const goblins = Array.from({ length: 6 }, (_, i) => card(`Goblin ${i}`, { typeLine: "Creature — Goblin" }));
    const changeling = card("Mirror", { typeLine: "Creature — Shapeshifter", oracleText: "Changeling" });
    const pool = eligiblePool(commander, [commander, ...filler(50), ...goblins, changeling], draftPlanFor({ tribe: "goblin" }, null));
    const top = pool.slice(0, 7).map((c) => c.name);
    expect(top).toContain("Mirror");
    expect(top.filter((n) => n.startsWith("Goblin"))).toHaveLength(6);
  });
});
