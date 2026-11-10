import { describe, expect, it } from "vitest";
import type { CollectionCard } from "@/lib/tools/collection/card-row";
import {
  commanderReason,
  commanderTribes,
  draftCommanderDeck,
  eligiblePool,
  ineligibleReason,
  LAND_TARGET,
  MAX_EXTRA_BASICS,
  roleOf,
  splitBasics,
  uniqueByCard,
} from "@/lib/tools/collection/builder";
import {
  AI_MAX_SPELLS,
  AI_ROLE_QUOTAS,
  aiCandidateLines,
  aiCandidates,
  picksFromIds,
} from "@/lib/tools/collection/ai-candidates";
import { COMMANDER_DECK_SIZE } from "@/lib/tools/collection/limits";

// ---------------------------------------------------------------------------
// The Commander builder's choices (lib/tools/collection/builder.ts), card for
// card: what may go in (legal, inside the commander's colours, one of each,
// never the commander), the shape (36 lands, the role quotas, the plan
// first), the basics split by pips, a thin collection left SHORT rather than
// padded, and the AI's picks held to the same rules.
// ---------------------------------------------------------------------------

let seq = 0;
function card(over: Partial<CollectionCard> & { name: string }): CollectionCard {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    scryfallId: `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    typeLine: "Creature — Human",
    manaCost: "{2}{R}",
    manaValue: 3,
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

const krenko = card({
  name: "Krenko, Mob Boss",
  typeLine: "Legendary Creature — Goblin Warrior",
  manaCost: "{2}{R}{R}",
  manaValue: 4,
  oracleText: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.",
  canBeCommander: true,
});

function filler(count: number, over: Partial<CollectionCard> = {}): CollectionCard[] {
  return Array.from({ length: count }, (_, i) => card({ name: `Filler ${seq}-${i}`, ...over }));
}

describe("what may go in", () => {
  it("legal, inside the colours, never the commander", () => {
    expect(ineligibleReason(card({ name: "Banned", commanderLegal: false }), krenko)).toBe("isn't legal in Commander");
    expect(ineligibleReason(card({ name: "Blue", colorIdentity: ["U"] }), krenko)).toBe("is outside the commander's colours");
    expect(ineligibleReason(card({ name: "Colourless", colorIdentity: [] }), krenko)).toBeNull();
    expect(ineligibleReason(card({ name: "Krenko, Mob Boss" }), krenko)).toBe("is the commander");
  });

  it("a commander is a card that can lead and is legal", () => {
    expect(commanderReason(krenko)).toBeNull();
    expect(commanderReason(card({ name: "Grunt" }))).toBe("can't be a commander");
    expect(commanderReason(card({ name: "Banned One", canBeCommander: true, commanderLegal: false }))).toBe("isn't legal as a commander");
  });

  it("one of each card: two printings are one card (the most copies kept)", () => {
    const a = card({ name: "Goblin Guide", quantity: 1 });
    const b = card({ name: "Goblin Guide", quantity: 3 });
    expect(uniqueByCard([a, b])).toEqual([b]);
  });

  it("basics never enter the pool (they are added by count)", () => {
    const pool = eligiblePool(krenko, [card({ name: "Mountain", typeLine: "Basic Land — Mountain", colorIdentity: [] })]);
    expect(pool).toEqual([]);
  });

  it("the commander's tribe ranks first", () => {
    const goblin = card({ name: "Goblin Chieftain", typeLine: "Creature — Goblin" });
    const human = card({ name: "Plain Human" });
    expect(commanderTribes(krenko)).toContain("Goblin");
    expect(eligiblePool(krenko, [human, goblin])[0].name).toBe("Goblin Chieftain");
  });
});

describe("roles", () => {
  it("reads ramp, draw, removal and wipes from the text", () => {
    expect(roleOf(card({ name: "Sol Ring", typeLine: "Artifact", oracleText: "{T}: Add {C}{C}." }))).toBe("ramp");
    expect(roleOf(card({ name: "Divination", typeLine: "Sorcery", oracleText: "Draw two cards." }))).toBe("draw");
    expect(roleOf(card({ name: "Lightning Bolt", typeLine: "Instant", oracleText: "Lightning Bolt deals 3 damage to any target." }))).toBe("removal");
    expect(roleOf(card({ name: "Blasphemous Act", typeLine: "Sorcery", oracleText: "Blasphemous Act deals 13 damage to each creature." }))).toBe("wipe");
    expect(roleOf(card({ name: "Mountain Pass", typeLine: "Land" }))).toBe("land");
    expect(roleOf(card({ name: "Goblin", oracleText: "Haste" }))).toBe("core");
  });

  it("reminder text is read as nothing", () => {
    expect(roleOf(card({ name: "X", oracleText: "Flash (You may cast this spell any time. Draw two cards.)" }))).toBe("core");
  });
});

describe("the draft", () => {
  it("a full collection makes exactly 100: the commander, 63 spells, 36 lands", () => {
    const collection = [
      krenko,
      ...filler(70),
      ...filler(10, { name: "", typeLine: "Land", oracleText: "{T}: Add {R}.", manaValue: 0, manaCost: null, colorIdentity: [] }).map((c, i) => ({ ...c, name: `Red Land ${i}` })),
    ];
    const draft = draftCommanderDeck({ commander: krenko, collection });
    expect(draft.total).toBe(COMMANDER_DECK_SIZE);
    expect(draft.short).toBe(0);
    expect(draft.picks.filter((p) => p.role !== "land")).toHaveLength(COMMANDER_DECK_SIZE - 1 - LAND_TARGET);
    expect(draft.counts.land).toBe(LAND_TARGET);
    expect(draft.basics).toEqual([expect.objectContaining({ name: "Mountain", count: LAND_TARGET - 10 })]);
    expect(draft.picks.some((p) => p.name === krenko.name)).toBe(false);
    expect(new Set(draft.picks.map((p) => p.name.toLowerCase())).size).toBe(draft.picks.length);
    expect(draft.warnings.some((w) => w.includes("short"))).toBe(false);
  });

  it("the role quotas are filled before the rest", () => {
    const ramp = filler(12, { typeLine: "Artifact", oracleText: "{T}: Add {R}." });
    const draft = draftCommanderDeck({ commander: krenko, collection: [krenko, ...filler(80), ...ramp] });
    expect(draft.counts.ramp).toBe(10);
  });

  it("a thin collection is SHORT, never padded with dozens of basics", () => {
    const draft = draftCommanderDeck({ commander: krenko, collection: [krenko, ...filler(20)] });
    expect(draft.picks).toHaveLength(20);
    const basics = draft.basics.reduce((sum, b) => sum + b.count, 0);
    expect(basics).toBe(LAND_TARGET + MAX_EXTRA_BASICS);
    expect(draft.total).toBe(1 + 20 + basics);
    expect(draft.short).toBe(COMMANDER_DECK_SIZE - draft.total);
    expect(draft.warnings[0]).toMatch(/short of 100/);
  });

  it("off-colour, banned and second copies are left out", () => {
    const draft = draftCommanderDeck({
      commander: krenko,
      collection: [
        krenko,
        card({ name: "Island Thing", colorIdentity: ["U"] }),
        card({ name: "Banned Thing", commanderLegal: false }),
        card({ name: "Twice" }),
        card({ name: "Twice" }),
      ],
    });
    expect(draft.picks.map((p) => p.name)).toEqual(["Twice"]);
  });

  it("basics split by the spells' pips, at least one of each colour", () => {
    const commander = card({ name: "Two Colour", typeLine: "Legendary Creature — Elf", colorIdentity: ["G", "R"], canBeCommander: true });
    const picks = [
      { cardId: "a", scryfallId: "a", name: "a", role: "core" as const, manaValue: 3, typeLine: null, manaCost: "{G}{G}{G}", imageUrl: null },
    ];
    const basics = splitBasics(10, commander.colorIdentity, picks);
    expect(basics.reduce((s, b) => s + b.count, 0)).toBe(10);
    const forest = basics.find((b) => b.name === "Forest")!.count;
    const mountain = basics.find((b) => b.name === "Mountain")!.count;
    expect(forest).toBeGreaterThan(mountain);
    expect(mountain).toBeGreaterThanOrEqual(1);
  });

  it("a colourless deck plays Wastes", () => {
    expect(splitBasics(5, [], [])).toEqual([expect.objectContaining({ name: "Wastes", count: 5 })]);
  });
});

describe("the AI's picks", () => {
  it("go in first, and are held to the same rules", () => {
    const blue = card({ name: "Blue Card", colorIdentity: ["U"] });
    const pick = card({ name: "AI Favourite", manaValue: 7 });
    const collection = [krenko, ...filler(80), pick, blue];
    const draft = draftCommanderDeck({
      commander: krenko,
      collection,
      preferred: [blue.id, pick.id, "not-a-row", krenko.id],
      strategy: "  Go wide with goblins.  ",
    });
    expect(draft.picks[0]).toMatchObject({ name: "AI Favourite", fromAi: true });
    expect(draft.picks.some((p) => p.name === "Blue Card" || p.name === krenko.name)).toBe(false);
    expect(draft.picks.filter((p) => p.fromAi)).toHaveLength(1);
    expect(draft.strategy).toBe("Go wide with goblins.");
    expect(draft.total).toBeLessThanOrEqual(COMMANDER_DECK_SIZE);
  });

  it("never more than 99 however many it names", () => {
    const collection = [krenko, ...filler(200)];
    const draft = draftCommanderDeck({ commander: krenko, collection, preferred: collection.map((c) => c.id) });
    expect(draft.total).toBeLessThanOrEqual(COMMANDER_DECK_SIZE);
  });

  it("the candidates carry lettered ids; ids off the list are dropped and counted, twice is once", () => {
    const collection = [krenko, ...filler(5)];
    const candidates = aiCandidates(krenko, collection);
    expect(candidates).toHaveLength(5);
    const first = aiCandidateLines(candidates).split("\n")[0];
    // A lettered id and a labelled mana value: a bare "1" can't be read as either.
    expect(first).toMatch(/^c0 \| Filler [\d-]+ \| mv3 \| Creature — Human \| role: — \| themes: — \|/);
    expect(picksFromIds(["c1", "c1", "c99", "x", "C0", " c2 "], candidates)).toEqual({
      rowIds: [candidates[1].id, candidates[0].id, candidates[2].id],
      unknown: 2,
    });
  });

  it("keeps room for each role the deck needs, however many creatures rank above them", () => {
    const creatures = filler(AI_MAX_SPELLS + 100).map((c) => ({ ...c, oracleText: "Other Goblins you control get +1/+1.", typeLine: "Creature — Goblin" }));
    const ramp = Array.from({ length: 40 }, (_, i) => card({ name: `Rock ${i}`, typeLine: "Artifact", oracleText: "{T}: Add {C}.", colorIdentity: [] }));
    const bolts = Array.from({ length: 5 }, (_, i) => card({ name: `Bolt ${i}`, typeLine: "Instant", oracleText: "This spell deals 3 damage to any target." }));
    const candidates = aiCandidates(krenko, [krenko, ...creatures, ...ramp, ...bolts]);
    expect(candidates).toHaveLength(AI_MAX_SPELLS);
    expect(candidates.filter((c) => c.name.startsWith("Rock"))).toHaveLength(AI_ROLE_QUOTAS.ramp);
    expect(candidates.filter((c) => c.name.startsWith("Bolt"))).toHaveLength(5);
  });

  it("a build's shuffle keeps the same cards, reordered only within ranking tiers", () => {
    const collection = [krenko, ...filler(120)];
    const plain = aiCandidates(krenko, collection);
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const shuffled = aiCandidates(krenko, collection, random);
    expect(new Set(shuffled.map((c) => c.id))).toEqual(new Set(plain.map((c) => c.id)));
    expect(shuffled.map((c) => c.id)).not.toEqual(plain.map((c) => c.id));
    // The first 40 stay the first 40.
    expect(new Set(shuffled.slice(0, 40).map((c) => c.id))).toEqual(new Set(plain.slice(0, 40).map((c) => c.id)));
  });

  it("the AI's reasons ride on its picks, and its shortfalls join the warnings", () => {
    const collection = [krenko, ...filler(40)];
    const preferred = [collection[1].id, collection[2].id];
    const draft = draftCommanderDeck({
      commander: krenko,
      collection,
      preferred,
      reasons: new Map([[collection[1].id, "Makes a Goblin every turn."]]),
      shortfalls: ["only 2 removal spells in red", "  ", "only 2 removal spells in red"],
    });
    expect(draft.picks.find((p) => p.cardId === collection[1].id)?.aiWhy).toBe("Makes a Goblin every turn.");
    expect(draft.picks.find((p) => p.cardId === collection[2].id)?.aiWhy).toBeUndefined();
    expect(draft.warnings[0]).toBe("The AI: only 2 removal spells in red");
    expect(draft.warnings.filter((w) => w.startsWith("The AI:"))).toHaveLength(1);
  });

  it("a huge collection shows the model the best spells and still its lands", () => {
    const collection = [krenko, ...filler(AI_MAX_SPELLS + 50), card({ name: "A Land", typeLine: "Land", colorIdentity: [] })];
    const candidates = aiCandidates(krenko, collection);
    expect(candidates.filter((c) => c.typeLine !== "Land")).toHaveLength(AI_MAX_SPELLS);
    expect(candidates.some((c) => c.name === "A Land")).toBe(true);
  });
});
