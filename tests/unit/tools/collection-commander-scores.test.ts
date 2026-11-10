import { describe, expect, it } from "vitest";
import {
  DEPTH_FULL,
  FIT_FULL,
  describeSupport,
  identityMask,
  prepareScoringCards,
  rankCommanders,
  scoreCommander,
  scoringPlan,
  tribeKey,
  type ScoringCard,
} from "@/lib/tools/collection/commander-scores";

// ---------------------------------------------------------------------------
// The free commander scores (lib/tools/collection/commander-scores.ts): how
// well a user's OWN cards support each commander they own — the build view's
// "Best supported" sort and the build bar's numbers. Read the way the
// drafter reads a card: one per name, legal in Commander, basics left out,
// inside the commander's colour identity.
// ---------------------------------------------------------------------------

function card(name: string, typeLine: string, oracleText: string, colorIdentity: string[], commanderLegal = true): ScoringCard {
  return { name, typeLine, oracleText, colorIdentity, commanderLegal };
}

const KRENKO = { id: "k", name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", oracleText: "{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.", colorIdentity: ["R"] };
const MEREN = { id: "m", name: "Meren of Clan Nel Toth", typeLine: "Legendary Creature — Human Shaman", oracleText: "Whenever another creature you control dies, you get an experience counter. At the beginning of your end step, choose target creature card in your graveyard.", colorIdentity: ["B", "G"] };

describe("identityMask", () => {
  it("is five bits, colourless 0, unknown letters ignored", () => {
    expect(identityMask([])).toBe(0);
    expect(identityMask(["W"])).toBe(1);
    expect(identityMask(["W", "U", "B", "R", "G"])).toBe(31);
    expect(identityMask(["R", "X"])).toBe(identityMask(["R"]));
  });
});

describe("prepareScoringCards", () => {
  it("keeps one card per name and leaves out basics and cards not legal in Commander", () => {
    const groups = prepareScoringCards([
      card("Goblin Matron", "Creature — Goblin", "When this creature enters, you may search your library for a Goblin card.", ["R"]),
      card("Goblin Matron", "Creature — Goblin", "When this creature enters, you may search your library for a Goblin card.", ["R"]),
      card("Mountain", "Basic Land — Mountain", "", []),
      card("Lutri, the Spellchaser", "Legendary Creature — Elemental Otter", "Flash", ["U", "R"], false),
    ]);
    const all = groups.flat();
    expect(all.map((c) => c.key)).toEqual(["goblin matron"]);
    expect(groups[identityMask(["R"])]).toHaveLength(1);
  });
});

describe("scoreCommander", () => {
  const cards = [
    card("Goblin Matron", "Creature — Goblin", "When this creature enters, search your library for a Goblin card.", ["R"]),
    card("Goblin Chieftain", "Creature — Goblin", "Other Goblins you control get +1/+1 and have haste.", ["R"]),
    card("Mirror Entity", "Creature — Shapeshifter", "Changeling", ["W"]), // off colour for Krenko
    card("Taurean Mauler", "Creature — Shapeshifter", "Changeling (This card is every creature type.)", []),
    card("Arcane Signet", "Artifact", "{T}: Add one mana of any color in your commander's color identity.", []),
    card("Lightning Bolt", "Instant", "Lightning Bolt deals 3 damage to any target.", ["R"]),
    card("Blasphemous Act", "Sorcery", "Blasphemous Act deals 13 damage to each creature.", ["R"]),
    card("Phyrexian Arena", "Enchantment", "At the beginning of your upkeep, you draw a card and you lose 1 life.", ["B"]),
    card("Smoldering Marsh", "Land — Swamp Mountain", "({T}: Add {B} or {R}.)", ["B", "R"]),
    card("Rogue's Passage", "Land", "{T}: Add {C}.", []),
    card("Krenko, Mob Boss", "Legendary Creature — Goblin Warrior", KRENKO.oracleText, ["R"]),
  ];
  const prepared = prepareScoringCards(cards);

  it("counts only cards inside its colours, never itself", () => {
    const s = scoreCommander(KRENKO, prepared);
    // Matron, Chieftain, Mauler, Signet, Bolt, Act — not Mirror Entity (W),
    // not Phyrexian Arena (B), not Krenko himself.
    expect(s.inColours).toBe(6);
    // Rogue's Passage only: Smoldering Marsh is B/R.
    expect(s.lands).toBe(1);
  });

  it("a card fits the plan by a theme its text rewards, a shared creature type, or changeling", () => {
    const s = scoreCommander(KRENKO, prepared);
    // Goblins (type) ×2 + the changeling; Krenko's tokens theme matches none
    // of the others' text.
    expect(s.fit).toBe(3);
  });

  it("counts roles the way the drafter reads them", () => {
    const s = scoreCommander(KRENKO, prepared);
    expect(s.roles).toEqual({ ramp: 1, draw: 0, removal: 1, wipe: 1 });
  });

  it("scores 0–100 and rises with plan support, role coverage and depth", () => {
    const thin = scoreCommander(KRENKO, prepareScoringCards([]));
    expect(thin.score).toBe(0);
    const full = scoreCommander(
      KRENKO,
      prepareScoringCards([
        ...Array.from({ length: FIT_FULL }, (_, i) => card(`Goblin ${i}`, "Creature — Goblin", "", ["R"])),
        ...Array.from({ length: 10 }, (_, i) => card(`Rock ${i}`, "Artifact", "{T}: Add {C}{C}.", [])),
        ...Array.from({ length: 10 }, (_, i) => card(`Draw ${i}`, "Sorcery", "Draw two cards.", ["R"])),
        ...Array.from({ length: 8 }, (_, i) => card(`Bolt ${i}`, "Instant", "This spell deals 3 damage to any target.", ["R"])),
        ...Array.from({ length: 3 }, (_, i) => card(`Wipe ${i}`, "Sorcery", "Destroy all creatures.", ["R"])),
        ...Array.from({ length: DEPTH_FULL }, (_, i) => card(`Filler ${i}`, "Artifact", "", [])),
      ]),
    );
    expect(full.score).toBe(100);
    const middling = scoreCommander(KRENKO, prepared);
    expect(middling.score).toBeGreaterThan(0);
    expect(middling.score).toBeLessThan(100);
  });

  it("a two-colour commander reads both colours and colourless", () => {
    const s = scoreCommander(MEREN, prepared);
    // Phyrexian Arena (B), Signet, Mauler (colourless). Not the red cards.
    expect(s.inColours).toBe(3);
    expect(s.lands).toBe(1);
  });
});

describe("rankCommanders / describeSupport", () => {
  it("answers every commander by its row id", () => {
    const out = rankCommanders([KRENKO, MEREN], [card("Goblin Matron", "Creature — Goblin", "", ["R"])]);
    expect(Object.keys(out).sort()).toEqual(["k", "m"]);
    expect(out.k.fit).toBe(1);
    expect(out.m.inColours).toBe(0);
  });

  it("says the numbers in words", () => {
    expect(
      describeSupport({ inColours: 142, fit: 31, roles: { ramp: 9, draw: 12, removal: 6, wipe: 2 }, lands: 20, score: 70, deckTypes: {}, tribes: [] }),
    ).toBe("142 of your cards are in its colours · 31 fit its plan · ramp 9/10 · card draw 12/10 · removal 6/8 · sweepers 2/3");
    expect(describeSupport({ inColours: 1, fit: 0, roles: { ramp: 0, draw: 0, removal: 0, wipe: 0 }, lands: 0, score: 0, deckTypes: {}, tribes: [] })).toMatch(
      /^1 of your cards is in its colours/,
    );
  });
});

describe("the plan the scores count (stricter than the drafter's weighting)", () => {
  it("reads creature-type words to their singular", () => {
    expect(tribeKey("Goblins")).toBe("goblin");
    expect(tribeKey("Allies")).toBe("ally");
    expect(tribeKey("Foxes")).toBe("fox");
    expect(tribeKey("Sphinxes")).toBe("sphinx");
    expect(tribeKey("Elves")).toBe("elf");
    expect(tribeKey("Octopus")).toBe("octopus");
    expect(tribeKey("Wizard")).toBe("wizard");
  });

  it("a type only on the type line is no plan — the text must name it", () => {
    const teysa = {
      typeLine: "Legendary Creature — Human Advisor",
      oracleText: "If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.",
    };
    expect(scoringPlan(teysa).tribes).toEqual([]);
    expect(scoringPlan({ typeLine: "Legendary Creature — Goblin Warrior", oracleText: KRENKO.oracleText }).tribes).toEqual(["goblin"]);
    expect(
      scoringPlan({ typeLine: "Legendary Creature — Kor Ally", oracleText: "Whenever another Ally you control enters, draw a card. Allies you control get +1/+1." }).tribes,
    ).toEqual(["ally"]);
  });

  it("a theme only in its own keyword line is no plan", () => {
    const atraxa = {
      typeLine: "Legendary Creature — Phyrexian Angel Horror",
      oracleText: "Flying, vigilance, deathtouch, lifelink\nAt the beginning of your end step, proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)",
    };
    const plan = scoringPlan(atraxa);
    expect([...plan.themes]).toEqual(["counters"]);
    // So a pile of flyers and lifelinkers doesn't "fit" Atraxa.
    const s = scoreCommander(
      { name: "Atraxa", colorIdentity: ["W", "U", "B", "G"], ...atraxa },
      prepareScoringCards([
        card("Serra Angel", "Creature — Angel", "Flying, vigilance", ["W"]),
        card("Vampire Nighthawk", "Creature — Vampire Shaman", "Flying, deathtouch, lifelink", ["B"]),
        card("Hardened Scales", "Enchantment", "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.", ["G"]),
      ]),
    );
    expect(s.fit).toBe(1);
  });
});

describe("deck types and creature types per commander", () => {
  it("counts each deck type's cards in its colours and lists creature types from 10 up", () => {
    const goblins = Array.from({ length: 11 }, (_, i) => card(`Goblin ${i}`, "Creature — Goblin", "", ["R"]));
    const makers = Array.from({ length: 4 }, (_, i) => card(`Maker ${i}`, "Sorcery", "Create two 1/1 red Goblin creature tokens.", ["R"]));
    const elves = Array.from({ length: 12 }, (_, i) => card(`Elf ${i}`, "Creature — Elf", "", ["G"]));
    const mauler = card("Taurean Mauler", "Creature — Shapeshifter", "Changeling", []);
    const s = scoreCommander(KRENKO, prepareScoringCards([...goblins, ...makers, ...elves, mauler]));
    expect(s.deckTypes.tokens).toBe(4);
    expect(s.deckTypes.enchantress).toBeUndefined();
    // Goblins 11 + the changeling; elves are off colour; shapeshifter < 10.
    expect(s.tribes).toEqual([{ tribe: "goblin", count: 12 }]);
  });
});

