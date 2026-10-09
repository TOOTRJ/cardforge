import { describe, expect, it } from "vitest";
import {
  autofixCard,
  buildDeckSkeleton,
  colorLettersFromWords,
  colorWordsFromLetters,
  deriveColorLetters,
  isNoCost,
  lintCardDesign,
  parseManaCost,
  withDrawableSymbols,
  type LintableCard,
} from "@/lib/ai/mtg-rules";

// ---------------------------------------------------------------------------
// parseManaCost
// ---------------------------------------------------------------------------

describe("parseManaCost", () => {
  it("parses a simple cost with generics and colors", () => {
    const parsed = parseManaCost("{2}{R}{R}");
    expect(parsed).not.toBeNull();
    expect(parsed!.manaValue).toBe(4);
    expect(parsed!.colorLetters).toEqual(["R"]);
  });

  it("treats X as zero mana value", () => {
    expect(parseManaCost("{X}{G}{G}")!.manaValue).toBe(2);
  });

  it("handles hybrid, mono-hybrid, Phyrexian, and snow symbols", () => {
    const hybrid = parseManaCost("{W/U}{B/P}{2/G}{S}");
    expect(hybrid).not.toBeNull();
    // hybrid=1, phyrexian=1, mono-hybrid=2, snow=1
    expect(hybrid!.manaValue).toBe(5);
    expect(hybrid!.colorLetters).toEqual(["B", "G", "U", "W"]);
  });

  it("returns empty symbols for the land dash", () => {
    expect(parseManaCost("—")).toEqual({
      symbols: [],
      manaValue: 0,
      colorLetters: [],
    });
    expect(isNoCost("—")).toBe(true);
    expect(isNoCost("{1}")).toBe(false);
  });

  it("rejects malformed costs", () => {
    expect(parseManaCost("2RR")).toBeNull();
    expect(parseManaCost("{2}{Q}")).toBeNull();
    expect(parseManaCost("{2}{R} tap")).toBeNull();
    expect(parseManaCost("{R/R}")).toBeNull();
  });

  it("tolerates whitespace between symbols", () => {
    expect(parseManaCost("{1} {U}")!.manaValue).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Color identity helpers
// ---------------------------------------------------------------------------

describe("color identity helpers", () => {
  it("derives colors from rules-text activation costs", () => {
    expect(deriveColorLetters("{2}", "{W}: Tap target creature.")).toEqual(["W"]);
  });

  it("maps letters to word enum with multicolor flag", () => {
    expect(colorWordsFromLetters([])).toEqual(["colorless"]);
    expect(colorWordsFromLetters(["R"])).toEqual(["red"]);
    expect(colorWordsFromLetters(["U", "W"])).toEqual([
      "blue",
      "white",
      "multicolor",
    ]);
  });

  it("round-trips words back to letters, dropping flags", () => {
    expect(colorLettersFromWords(["blue", "white", "multicolor"])).toEqual([
      "U",
      "W",
    ]);
    expect(colorLettersFromWords(["colorless"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// lintCardDesign
// ---------------------------------------------------------------------------

function baseCard(overrides: Partial<LintableCard> = {}): LintableCard {
  return {
    title: "Emberwake Scout",
    cost: "{1}{R}",
    card_type: "creature",
    color_identity: ["red"],
    rules_text: "Haste",
    power: "2",
    toughness: "1",
    loyalty: null,
    defense: null,
    ...overrides,
  };
}

describe("lintCardDesign", () => {
  it("passes a clean creature", () => {
    const result = lintCardDesign(baseCard());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("errors on malformed mana cost", () => {
    const result = lintCardDesign(baseCard({ cost: "2RR" }));
    expect(result.errors.some((issue) => issue.field === "cost")).toBe(true);
  });

  it("errors on a land with a mana cost", () => {
    const result = lintCardDesign(
      baseCard({
        card_type: "land",
        cost: "{1}",
        power: null,
        toughness: null,
        rules_text: "{T}: Add {C}.",
        color_identity: ["colorless"],
      }),
    );
    expect(result.errors.some((issue) => issue.field === "cost")).toBe(true);
  });

  it("errors when a creature is missing power/toughness", () => {
    const result = lintCardDesign(baseCard({ power: null }));
    expect(result.errors.some((issue) => issue.field === "power")).toBe(true);
  });

  it("errors when a sorcery carries power/toughness or loyalty", () => {
    const result = lintCardDesign(
      baseCard({ card_type: "sorcery", rules_text: "Draw two cards.", loyalty: "3" }),
    );
    expect(result.errors.some((issue) => issue.field === "power")).toBe(true);
    expect(result.errors.some((issue) => issue.field === "loyalty")).toBe(true);
  });

  it("errors when color identity misses a cost color", () => {
    const result = lintCardDesign(baseCard({ color_identity: ["blue"] }));
    expect(
      result.errors.some((issue) => issue.field === "color_identity"),
    ).toBe(true);
  });

  it("accepts multicolor identity that covers all symbols", () => {
    const result = lintCardDesign(
      baseCard({
        cost: "{W}{U}",
        color_identity: ["white", "blue", "multicolor"],
        rules_text: "Flying",
      }),
    );
    expect(result.errors).toEqual([]);
  });

  it("warns on unknown keyword lines without reminder text", () => {
    const result = lintCardDesign(baseCard({ rules_text: "Fireborn" }));
    expect(result.warnings.some((issue) => issue.field === "rules_text")).toBe(
      true,
    );
  });

  it("accepts unknown keywords when reminder text explains them", () => {
    const result = lintCardDesign(
      baseCard({
        rules_text:
          "Fireborn (This creature enters with a +1/+1 counter for each Mountain you control.)",
      }),
    );
    expect(result.warnings).toEqual([]);
  });

  it("accepts parameterized known keywords", () => {
    const result = lintCardDesign(
      baseCard({
        rules_text: "Ward {2}, protection from blue\nWhenever Emberwake Scout attacks, scry 1.",
      }),
    );
    expect(result.warnings).toEqual([]);
  });

  it("warns on outdated templating", () => {
    const result = lintCardDesign(
      baseCard({
        rules_text: "Each player sacrifices a creature in play. He or she cannot regenerate it.",
      }),
    );
    const messages = result.warnings.map((issue) => issue.message).join(" ");
    expect(messages).toContain("in play");
  });

  it("warns on vanilla-test outliers without a drawback", () => {
    const pushed = lintCardDesign(
      baseCard({ cost: "{R}", power: "5", toughness: "5", rules_text: "Haste" }),
    );
    expect(pushed.warnings.some((issue) => issue.field === "balance")).toBe(true);

    const fair = lintCardDesign(
      baseCard({
        cost: "{R}",
        power: "5",
        toughness: "5",
        rules_text: "Haste\nAt the beginning of your upkeep, sacrifice Emberwake Scout unless you pay {R}{R}.",
      }),
    );
    expect(fair.warnings.some((issue) => issue.field === "balance")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// autofixCard
// ---------------------------------------------------------------------------

describe("autofixCard", () => {
  it("clears stat slots that don't belong to the type", () => {
    const fixed = autofixCard(
      baseCard({ card_type: "instant", rules_text: "Draw a card.", loyalty: "4" }),
    );
    expect(fixed.power).toBeNull();
    expect(fixed.toughness).toBeNull();
    expect(fixed.loyalty).toBeNull();
  });

  it("fills missing creature stats and realigns color identity", () => {
    const fixed = autofixCard(
      baseCard({ power: null, color_identity: ["blue"] }),
    );
    expect(fixed.power).not.toBeNull();
    expect(fixed.color_identity).toEqual(["red"]);
  });

  it("forces the land dash and modernizes templating", () => {
    const fixed = autofixCard(
      baseCard({
        card_type: "land",
        cost: "{2}",
        power: null,
        toughness: null,
        rules_text: "{T}: Add {G}. His or her creatures cannot block this turn.",
        color_identity: ["green"],
      }),
    );
    expect(fixed.cost).toBe("—");
    expect(fixed.rules_text).toContain("their");
    expect(fixed.rules_text).toContain("can't");
  });
});

// ---------------------------------------------------------------------------
// Tokens (TODO 3b.15): the P/T follows the Creature word, as the creator and
// the renderers read it — the AI used to make every token a 2/2 creature.
// ---------------------------------------------------------------------------

function tokenCard(overrides: Partial<LintableCard> = {}): LintableCard {
  return baseCard({
    title: "Treasure",
    cost: "—",
    card_type: "token",
    supertype: "Artifact",
    subtypes: ["Treasure"],
    color_identity: ["colorless"],
    rules_text: "{T}, Sacrifice this token: Add one mana of any color.",
    power: null,
    toughness: null,
    ...overrides,
  });
}

describe("tokens: lint and autofix read the type words", () => {
  it("a Treasure with no P/T lints clean, and autofix leaves it without one", () => {
    const treasure = tokenCard();
    expect(lintCardDesign(treasure).errors).toEqual([]);
    const fixed = autofixCard(treasure);
    expect(fixed.power).toBeNull();
    expect(fixed.toughness).toBeNull();
    expect(fixed.supertype).toBe("Artifact");
  });

  it("a Treasure given a P/T is an error, and autofix drops the stats", () => {
    const result = lintCardDesign(tokenCard({ power: "2", toughness: "2" }));
    expect(result.errors.map((issue) => issue.field)).toEqual(["power"]);
    const fixed = autofixCard(tokenCard({ power: "2", toughness: "2" }));
    expect(fixed.power).toBeNull();
    expect(fixed.toughness).toBeNull();
    expect(fixed.supertype).toBe("Artifact");
  });

  it("a creature token needs both stats; autofix fills them", () => {
    const soldier = tokenCard({
      title: "Soldier",
      supertype: "Creature",
      subtypes: ["Soldier"],
      color_identity: ["white"],
      rules_text: "",
      power: null,
      toughness: null,
    });
    expect(lintCardDesign(soldier).errors.map((issue) => issue.field)).toEqual(["power"]);
    const fixed = autofixCard(soldier);
    expect([fixed.power, fixed.toughness]).toEqual(["2", "2"]);
    expect(lintCardDesign({ ...soldier, power: "1", toughness: "1" }).errors).toEqual([]);
  });

  it("an Enchantment Creature token is a creature token", () => {
    const glimmer = tokenCard({
      title: "Glimmer",
      supertype: "Enchantment Creature",
      subtypes: ["Glimmer"],
      color_identity: ["white"],
      rules_text: "Flying",
      power: "1",
      toughness: "1",
    });
    expect(lintCardDesign(glimmer).errors).toEqual([]);
    expect(autofixCard(glimmer).power).toBe("1");
  });

  it("a token with a P/T and no type word was designed as a creature: autofix writes Creature", () => {
    const legacy = tokenCard({ title: "Soldier", supertype: null, subtypes: ["Soldier"], power: "1", toughness: "1", rules_text: "" });
    expect(lintCardDesign(legacy).errors.map((issue) => issue.field)).toEqual(["supertype"]);
    const fixed = autofixCard(legacy);
    expect(fixed.supertype).toBe("Creature");
    expect([fixed.power, fixed.toughness]).toEqual(["1", "1"]);
    expect(lintCardDesign(fixed).errors).toEqual([]);
  });

  it("a token with no type word and no P/T is only a warning (a Copy prints a bare \"Token\")", () => {
    const copy = tokenCard({ title: "Copy", supertype: null, subtypes: [], rules_text: "" });
    const result = lintCardDesign(copy);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((issue) => issue.field)).toContain("supertype");
    const fixed = autofixCard(copy);
    expect(fixed.power).toBeNull();
    expect(fixed.supertype).toBeNull();
  });

  it("a Vehicle keeps its P/T (artifact or token)", () => {
    const vehicle = baseCard({ card_type: "artifact", subtypes: ["Vehicle"], cost: "{2}", color_identity: ["colorless"], rules_text: "Crew 1" });
    expect(lintCardDesign(vehicle).errors).toEqual([]);
    expect(autofixCard(vehicle).power).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// Set skeleton
// ---------------------------------------------------------------------------

describe("buildDeckSkeleton", () => {
  it("leads with the commander in commander formats", () => {
    const slots = buildDeckSkeleton("commander", 3);
    expect(slots[0].role).toBe("commander");
    expect(slots).toHaveLength(3);
    expect(slots.every((slot) => slot.quantity === 1)).toBe(true);
  });

  it("has no commander in standard and doubles nonbasic lands", () => {
    const slots = buildDeckSkeleton("standard", 12);
    expect(slots.some((slot) => slot.role === "commander")).toBe(false);
    const lands = slots.filter((slot) => slot.role === "land");
    expect(lands.length).toBeGreaterThan(0);
    expect(lands.every((slot) => slot.quantity === 2)).toBe(true);
  });

  it("skips land designs in tiny batches", () => {
    const slots = buildDeckSkeleton("standard", 3);
    expect(slots.some((slot) => slot.role === "land")).toBe(false);
    expect(slots).toHaveLength(3);
  });

  it("splits spells roughly 55/45 creatures vs noncreatures along a curve", () => {
    const slots = buildDeckSkeleton("limited", 20);
    const creatures = slots.filter((slot) => slot.role === "creature").length;
    const noncreatures = slots.filter(
      (slot) => slot.role === "noncreature",
    ).length;
    expect(creatures).toBeGreaterThan(noncreatures);
    const hints = slots
      .filter((slot) => slot.manaValueHint != null)
      .map((slot) => slot.manaValueHint);
    expect(new Set(hints).size).toBeGreaterThan(2);
  });
});


// ---------------------------------------------------------------------------
// Symbols the card can't draw: the game's grammar accepts {21}-{99}, the
// mana font has no pip for them and the card leaves them out — the design
// may not use one. The hybrid Phyrexian {W/U/P} was one of them until layout
// v49 drew it: the lint lets it through and the autofix leaves it alone.
// ---------------------------------------------------------------------------

describe("symbols the card can't draw", () => {
  it("the grammar still reads them (mana value, colours)", () => {
    expect(parseManaCost("{2}{G/U/P}{U}")).toMatchObject({ manaValue: 4, colorLetters: ["G", "U"] });
    expect(parseManaCost("{21}")).toMatchObject({ manaValue: 21 });
  });

  it("the lint refuses one in the cost, naming it", () => {
    // A hybrid Phyrexian cost draws: no symbol error.
    const { errors } = lintCardDesign(baseCard({ cost: "{2}{G/U/P}{U}", color_identity: ["green", "blue"] }));
    expect(errors.filter((e) => e.message.includes("can't be drawn"))).toEqual([]);
    const big = lintCardDesign(baseCard({ cost: "{21}{R}" }));
    expect(big.errors.map((e) => e.message)).toContain(
      "{21} can't be drawn and will be left off the card — use a symbol the card has a pip for.",
    );
  });

  it("and in the rules text", () => {
    const { errors } = lintCardDesign(
      baseCard({ rules_text: "{T}, Pay {R/G/P}{21}: This creature gets +{1/2}/+0 until end of turn." }),
    );
    // {R/G/P} draws; the other two are named.
    expect(errors).toContainEqual({
      field: "rules_text",
      message: "{21} and {1/2} can't be drawn and will be left off the card — use a symbol the card has a pip for.",
    });
  });

  it("every symbol the designer is told to use passes", () => {
    const { errors } = lintCardDesign(
      baseCard({
        cost: "{20}{X}{W/U}{2/R}{R/P}{W/R/P}{S}{C}{R}",
        color_identity: ["white", "blue", "red"],
        rules_text: "{T}, {Q}, Pay {E}: Add {R}.",
      }),
    );
    expect(errors.filter((e) => e.message.includes("can't be drawn"))).toEqual([]);
  });

  it("the autofix swaps in the nearest symbol the card draws", () => {
    expect(withDrawableSymbols("{21}{R}")).toBe("{20}{R}");
    expect(withDrawableSymbols("{99}")).toBe("{20}");
    // A hybrid Phyrexian symbol is drawn as designed — no longer swapped
    // for the plain hybrid (the pre-v49 fix), as written.
    expect(withDrawableSymbols("{2}{G/U/P}{U}")).toBe("{2}{G/U/P}{U}");
    expect(withDrawableSymbols("{T}, Pay {w/b/p}{21}: Draw a card.")).toBe("{T}, Pay {w/b/p}{20}: Draw a card.");
    // Nothing to offer: it stays (and the lint still says so).
    expect(withDrawableSymbols("Pay {1/2}.")).toBe("Pay {1/2}.");
    // Drawable text is returned untouched.
    expect(withDrawableSymbols("{2}{r}{R}: Add {G}.")).toBe("{2}{r}{R}: Add {G}.");

    const fixed = autofixCard(
      baseCard({ cost: "{21}{R/G/P}{R}", rules_text: "{R/G/P}, Pay {30}: This creature gains haste.", color_identity: ["red"] }),
    );
    expect(fixed.cost).toBe("{20}{R/G/P}{R}");
    expect(fixed.rules_text).toBe("{R/G/P}, Pay {20}: This creature gains haste.");
    expect(fixed.color_identity).toEqual(["green", "red", "multicolor"]);
    expect(lintCardDesign(fixed).errors.filter((e) => e.message.includes("can't be drawn"))).toEqual([]);
  });

  it("a land keeps its dash", () => {
    expect(autofixCard(baseCard({ card_type: "land", cost: "{21}", rules_text: "{T}: Add {G}." })).cost).toBe("—");
  });
});
