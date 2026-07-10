import { describe, expect, it } from "vitest";
import {
  autofixCard,
  buildRaritySkeleton,
  buildSetSkeleton,
  colorLettersFromWords,
  colorWordsFromLetters,
  deriveColorLetters,
  isNoCost,
  lintCardDesign,
  parseManaCost,
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
// Set skeleton
// ---------------------------------------------------------------------------

describe("buildRaritySkeleton", () => {
  it("gives a 3-card set one common, one uncommon, one rare", () => {
    expect(buildRaritySkeleton(3)).toEqual(["common", "uncommon", "rare"]);
  });

  it("always allocates exactly the requested count", () => {
    for (const count of [1, 2, 3, 5, 8, 12, 30, 281]) {
      expect(buildRaritySkeleton(count)).toHaveLength(count);
    }
  });

  it("approximates real set ratios at scale", () => {
    const skeleton = buildRaritySkeleton(281);
    const byRarity = skeleton.reduce<Record<string, number>>((acc, rarity) => {
      acc[rarity] = (acc[rarity] ?? 0) + 1;
      return acc;
    }, {});
    // Bloomburrow-era ratios: 81C/100U/60R/20M (+ basics) ≈ 31/38/23/8.
    expect(byRarity.common).toBeGreaterThanOrEqual(84);
    expect(byRarity.common).toBeLessThanOrEqual(91);
    expect(byRarity.uncommon).toBeGreaterThanOrEqual(103);
    expect(byRarity.uncommon).toBeLessThanOrEqual(110);
    expect(byRarity.mythic).toBeGreaterThanOrEqual(20);
    expect(byRarity.mythic).toBeLessThanOrEqual(25);
  });
});

describe("buildSetSkeleton", () => {
  it("touches every color in a 5-card set", () => {
    const slots = buildSetSkeleton(5);
    const colors = new Set(slots.map((slot) => slot.colorHint));
    expect(colors).toEqual(
      new Set(["white", "blue", "black", "red", "green"]),
    );
  });

  it("mixes creature and noncreature roles", () => {
    const slots = buildSetSkeleton(12);
    const roles = new Set(slots.map((slot) => slot.roleHint));
    expect(roles.has("creature")).toBe(true);
    expect(roles.has("noncreature")).toBe(true);
  });

  it("frees a slot for artifacts/multicolor in bigger sets", () => {
    const slots = buildSetSkeleton(12);
    expect(slots.some((slot) => slot.colorHint === null)).toBe(true);
  });
});
