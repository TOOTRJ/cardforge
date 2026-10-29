import { describe, expect, it } from "vitest";
import { CR_KEYWORD_ABILITY_NAMES, CR_KEYWORD_ACTION_NAMES, CR_KEYWORD_NAMES } from "@/lib/cards/keyword-reminders";
import { EVERGREEN_KEYWORDS, keywordFrequency, keywordsInRulesText } from "@/lib/decks/keyword-frequency";

// ---------------------------------------------------------------------------
// Keyword frequency (TODO DK7.3): keyword abilities on keyword lines only,
// mechanic keyword actions anywhere, ability words and a custom card's own
// keywords — counted in cards, quantity-weighted.
// ---------------------------------------------------------------------------

const names = (text: string) => keywordsInRulesText(text).map((keyword) => `${keyword.kind}:${keyword.name}`);

describe("the keyword data", () => {
  it("the abilities and actions are CR_KEYWORD_NAMES, in its order", () => {
    expect(CR_KEYWORD_NAMES).toEqual([...CR_KEYWORD_ABILITY_NAMES, ...CR_KEYWORD_ACTION_NAMES]);
    expect(CR_KEYWORD_ABILITY_NAMES).toContain("Flying");
    expect(CR_KEYWORD_ACTION_NAMES).toContain("Scry");
    expect(CR_KEYWORD_ABILITY_NAMES).not.toContain("Scry");
  });

  it("every evergreen keyword is a CR keyword ability", () => {
    const abilities = new Set(CR_KEYWORD_ABILITY_NAMES.map((name) => name.toLowerCase()));
    for (const name of EVERGREEN_KEYWORDS) expect(abilities.has(name.toLowerCase())).toBe(true);
  });
});

describe("keywordsInRulesText", () => {
  it("reads a keyword line, items and parameters included", () => {
    expect(names("Flying, first strike, lifelink")).toEqual(["evergreen:Flying", "evergreen:First strike", "evergreen:Lifelink"]);
    expect(names("Ward {2}\nEquip {1}")).toEqual(["evergreen:Ward", "evergreen:Equip"]);
    expect(names("Ward—Pay 3 life.")).toEqual(["evergreen:Ward"]);
    expect(names("Protection from red and from white")).toEqual(["evergreen:Protection"]);
    expect(names("Enchant creature\nEnchanted creature gets +2/+2.")).toEqual(["evergreen:Enchant"]);
    expect(names("Kicker {1}{R} (You may pay an additional {1}{R} as you cast this spell.)")).toEqual(["keyword:Kicker"]);
    expect(names("Flashback {2}{R}")).toEqual(["keyword:Flashback"]);
    expect(names("Double strike")).toEqual(["evergreen:Double strike"]);
    expect(names("Split second")).toEqual(["keyword:Split second"]);
  });

  it("never reads a keyword out of a sentence", () => {
    expect(names("Destroy target creature with flying.")).toEqual([]);
    expect(names("Flying creatures you control get +1/+1.")).toEqual([]);
    expect(names("Equipped creature gets +2/+0.")).toEqual([]);
    expect(names("Enchanted land has “{T}: Add {G}{G}.”")).toEqual([]);
  });

  it("the landwalk and typecycling families count as their keyword", () => {
    expect(names("Swampwalk")).toEqual(["keyword:Landwalk"]);
    expect(names("Islandwalk")).toEqual(["keyword:Landwalk"]);
    expect(names("Plainscycling {2}")).toEqual(["keyword:Cycling"]);
    expect(names("Cycling {2} ({2}, Discard this card: Draw a card.)")).toEqual(["keyword:Cycling"]);
  });

  it("mechanic keyword actions anywhere, any inflection; everyday rules English never", () => {
    expect(names("When this creature enters, scry 2.")).toEqual(["action:Scry"]);
    expect(names("Target player mills three cards.")).toEqual(["action:Mill"]);
    expect(names("Whenever this creature attacks, investigate.")).toEqual(["action:Investigate"]);
    expect(names("Destroy target artifact. Exile it. Sacrifice a creature.")).toEqual([]);
    expect(names("Draw a card, then you may discard a card.")).toEqual([]);
  });

  it("ability words, a custom card's own included — never a chapter or a choice", () => {
    expect(names("Landfall — Whenever a land you control enters, you gain 1 life.")).toEqual(["ability-word:Landfall"]);
    expect(names("Ember Tide — At the beginning of your upkeep, scry 1.")).toEqual(["ability-word:Ember tide", "action:Scry"]);
    expect(names("I — Create a 1/1 white Soldier creature token.\nII, III — Draw a card.")).toEqual([]);
    expect(names("Choose one —\n• Destroy target creature.\n• Draw a card.")).toEqual([]);
  });

  it("a new keyword a custom card defines with its reminder", () => {
    expect(names("Glimmer 2 (When this creature dies, return it with two +1/+1 counters.)")).toEqual(["new:Glimmer"]);
    expect(names("Sacrifice it (This is a reminder.)")).toEqual([]);
  });

  it("reminder text is never read as rules", () => {
    expect(names("Create a Treasure token. (It’s an artifact with “{T}, Sacrifice this artifact: Add one mana of any color.”)")).toEqual(
      [],
    );
    expect(names("({T}: Add {G}.)")).toEqual([]);
    expect(names("")).toEqual([]);
    expect(names(null as never)).toEqual([]);
  });
});

describe("keywordFrequency", () => {
  it("counts CARDS, quantity-weighted, each keyword once a card; most first", () => {
    const frequency = keywordFrequency([
      { texts: ["Flying\nWhenever this creature attacks, scry 1. Then scry 1 again."], quantity: 4 },
      { texts: ["Flying, vigilance", "Back face: Flying"], quantity: 2 },
      { texts: ["Landfall — Scry 2."], quantity: 1 },
      { texts: [null, "  "], quantity: 3 },
    ]);
    expect(frequency.cardsRead).toBe(7);
    expect(frequency.evergreen.map(({ name, cards }) => [name, cards])).toEqual([
      ["Flying", 6],
      ["Vigilance", 2],
    ]);
    expect(frequency.mechanics.map(({ name, cards }) => [name, cards])).toEqual([
      ["Scry", 5],
      ["Landfall", 1],
    ]);
  });
});
