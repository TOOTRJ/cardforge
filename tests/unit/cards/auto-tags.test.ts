import { describe, expect, it } from "vitest";
import {
  AUTO_TAG_LIMIT,
  AUTO_TAG_VOCABULARY,
  KEYWORD_ABILITY_TAGS,
  KEYWORD_ACTION_TAGS,
  autoTagsFor,
} from "@/lib/cards/auto-tags";
import { CR_KEYWORD_ABILITY_NAMES, CR_KEYWORD_ACTION_NAMES } from "@/lib/cards/keyword-reminders";
import { containsProfanity } from "@/lib/moderation/profanity";
import { cardTagsSchema } from "@/lib/validation/card";

// A new card's suggested tags (lib/cards/auto-tags.ts) over rules text as
// print writes it — Oracle wording, curly apostrophes, reminder text in
// brackets — and over the shapes a maker types.

describe("the vocabulary", () => {
  it("is in the tags schema's shape: the schema leaves every tag as it is", () => {
    expect(cardTagsSchema.parse([...AUTO_TAG_VOCABULARY].slice(0, 12))).toEqual([...AUTO_TAG_VOCABULARY].slice(0, 12));
    for (const tag of AUTO_TAG_VOCABULARY) {
      expect(tag, tag).toMatch(/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/);
      expect(tag.length, tag).toBeLessThanOrEqual(30);
      expect(containsProfanity(tag), tag).toBe(false);
    }
  });

  it("names only Comprehensive Rules keywords as keywords", () => {
    const abilities = new Set(CR_KEYWORD_ABILITY_NAMES.map((name) => name.toLowerCase()));
    const actions = new Set(CR_KEYWORD_ACTION_NAMES.map((name) => name.toLowerCase()));
    for (const tag of KEYWORD_ABILITY_TAGS) expect(abilities.has(tag), tag).toBe(true);
    for (const tag of KEYWORD_ACTION_TAGS) expect(actions.has(tag), tag).toBe(true);
  });
});

describe("real cards", () => {
  const cases: readonly (readonly [name: string, input: Parameters<typeof autoTagsFor>[0], expected: string[]])[] = [
    ["Lightning Bolt", { title: "Lightning Bolt", rules_text: "Lightning Bolt deals 3 damage to any target.", card_type: "instant" }, ["removal", "burn"]],
    ["Serra Angel", { title: "Serra Angel", rules_text: "Flying, vigilance", subtypes: ["Angel"], card_type: "creature" }, ["angels", "flying", "vigilance"]],
    [
      "Shivan Dragon",
      { title: "Shivan Dragon", rules_text: "Flying\n{R}: Shivan Dragon gets +1/+0 until end of turn.", subtypes: "Dragon", card_type: "creature" },
      ["dragons", "flying"],
    ],
    ["Counterspell", { title: "Counterspell", rules_text: "Counter target spell.", card_type: "instant" }, ["counterspell"]],
    ["Divination", { title: "Divination", rules_text: "Draw two cards.", card_type: "sorcery" }, ["card draw"]],
    ["Wrath of God", { title: "Wrath of God", rules_text: "Destroy all creatures. They can’t be regenerated.", card_type: "sorcery" }, ["board wipe", "gods"]],
    ["Swords to Plowshares", { title: "Swords to Plowshares", rules_text: "Exile target creature. Its controller gains life equal to its power.", card_type: "instant" }, ["removal"]],
    [
      "Llanowar Elves",
      { title: "Llanowar Elves", rules_text: "{T}: Add {G}.", subtypes: ["Elf", "Druid"], card_type: "creature" },
      ["elves", "druids"],
    ],
    [
      "Rampant Growth",
      { title: "Rampant Growth", rules_text: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.", card_type: "sorcery" },
      ["ramp"],
    ],
    [
      "Evolving Wilds (a land's fetch is not ramp)",
      { title: "Evolving Wilds", rules_text: "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.", card_type: "land" },
      [],
    ],
    ["Demonic Tutor", { title: "Demonic Tutor", rules_text: "Search your library for a card, put that card into your hand, then shuffle.", card_type: "sorcery" }, ["tutor"]],
    [
      "Raise Dead vs Reanimate",
      { title: "Reanimate", rules_text: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.", card_type: "sorcery" },
      ["reanimator"],
    ],
    [
      "Raise the Alarm",
      { title: "Raise the Alarm", rules_text: "Create two 1/1 white Soldier creature tokens.", card_type: "instant" },
      ["tokens", "soldiers"],
    ],
    [
      "Goblin Instigator",
      { title: "Goblin Instigator", rules_text: "When this creature enters, create a 1/1 red Goblin creature token.", subtypes: "Goblin, Rogue", card_type: "creature" },
      ["goblins", "rogues", "tokens"],
    ],
    ["Opt", { title: "Opt", rules_text: "Scry 1.\nDraw a card.", card_type: "instant" }, ["card draw", "scry"]],
    [
      "Thought Scour",
      { title: "Thought Scour", rules_text: "Target player mills two cards. (They put the top two cards of their library into their graveyard.)\nDraw a card.", card_type: "instant" },
      ["card draw", "mill"],
    ],
    [
      "Hardened Scales",
      { title: "Hardened Scales", rules_text: "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.", card_type: "enchantment" },
      ["counters"],
    ],
    [
      "Ajani's Pridemate",
      { title: "Ajani’s Pridemate", rules_text: "Whenever you gain life, put a +1/+1 counter on this creature.", subtypes: ["Cat", "Soldier"], card_type: "creature" },
      ["cats", "soldiers", "lifegain", "counters"],
    ],
    [
      "Glorious Anthem",
      { title: "Glorious Anthem", rules_text: "Creatures you control get +1/+1.", card_type: "enchantment" },
      ["anthem"],
    ],
    [
      "Unsummon",
      { title: "Unsummon", rules_text: "Return target creature to its owner’s hand.", card_type: "instant" },
      ["bounce"],
    ],
    [
      "Cloudshift",
      { title: "Cloudshift", rules_text: "Exile target creature you control, then return that card to the battlefield under your control.", card_type: "instant" },
      ["removal", "flicker"],
    ],
    [
      "Lotus Cobra",
      { title: "Lotus Cobra", rules_text: "Landfall — Whenever a land you control enters, add one mana of any color.", subtypes: ["Snake"], card_type: "creature" },
      ["snakes", "landfall"],
    ],
    [
      "Giant Growth (a type in the name counts; the maker removes what doesn't fit)",
      { title: "Giant Growth", rules_text: "Target creature gets +3/+3 until end of turn.", card_type: "instant" },
      ["giants"],
    ],
    [
      "Jolrael's Centaur: Flash and shroud, keyword line",
      { title: "Jolrael’s Centaur", rules_text: "Flash\nShroud (This creature can’t be the target of spells or abilities.)", subtypes: ["Centaur", "Archer"], card_type: "creature" },
      ["centaurs", "flash", "shroud"],
    ],
    [
      "a granted keyword counts; one merely named does not",
      { title: "Rally the Wings", rules_text: "Creatures you control gain flying and haste until end of turn. Creatures without flying can’t block this turn.", card_type: "instant" },
      ["flying", "haste"],
    ],
    [
      "reminder text names nothing (Flying's reminder names reach)",
      { title: "Storm Crow", rules_text: "Flying (This creature can’t be blocked except by creatures with flying or reach.)", subtypes: ["Bird"], card_type: "creature" },
      ["birds", "flying"],
    ],
    [
      "Ward with its cost, Toxic with its number",
      { title: "Venomous Seer", rules_text: "Ward {2}\nToxic 1", subtypes: ["Phyrexian", "Wizard"], card_type: "creature" },
      ["phyrexians", "wizards", "poison", "ward", "toxic"],
    ],
    [
      "Flashback is a keyword and a graveyard card, never Flash",
      { title: "Think Twice", rules_text: "Draw a card.\nFlashback {2}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)", card_type: "instant" },
      ["card draw", "graveyard", "flashback"],
    ],
    [
      "an Equipment and an Aura are tagged by subtype, never by Equip / Enchant",
      { title: "Bonesplitter", rules_text: "Equipped creature gets +2/+0.\nEquip {1}", subtypes: ["Equipment"], card_type: "artifact" },
      ["equipment"],
    ],
    [
      "words in prose are never a tribe: lower-case, inside a word",
      { title: "Fishing Gear", rules_text: "Target pirate draws a card. Its controller cat-naps.", card_type: "instant" },
      ["card draw"],
    ],
    [
      "a planeswalker's rows read as rules text",
      { title: "Chandra, Flamecaller", rules_text: "+1: Create two 3/1 red Elemental creature tokens with haste. Exile them at the beginning of the next end step.\n0: Discard all the cards in your hand, then draw that many cards plus one.\n−X: Chandra deals X damage to each creature.", card_type: "planeswalker" },
      ["tokens", "card draw", "board wipe", "elementals"],
    ],
    [
      "Doubling Season: tokens and counters",
      { title: "Doubling Season", rules_text: "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.", card_type: "enchantment" },
      ["tokens"],
    ],
    ["an empty card suggests nothing", { title: "", rules_text: "", card_type: "creature" }, []],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(autoTagsFor(input)).toEqual(expected);
    });
  }
});

describe("the list", () => {
  it("is capped at AUTO_TAG_LIMIT, in its fixed order, and the same every time", () => {
    const input = {
      title: "Dragon Angel of the Goblin Elves",
      rules_text: "Flying, first strike, vigilance, trample, haste, lifelink\nWhen this creature enters, create two 1/1 Goblin tokens and draw a card.",
      subtypes: ["Dragon", "Angel"],
      card_type: "creature",
    };
    const tags = autoTagsFor(input);
    expect(tags).toHaveLength(AUTO_TAG_LIMIT);
    expect(tags).toEqual(["dragons", "angels", "tokens", "card draw", "flying", "first strike"]);
    expect(autoTagsFor(input)).toEqual(tags);
  });

  it("never lifts a word the maker typed into a tag", () => {
    expect(autoTagsFor({ title: "Gorbash the Unspeakable", rules_text: "Gorbash smells of brimstone.", card_type: "creature" })).toEqual([]);
  });
});
