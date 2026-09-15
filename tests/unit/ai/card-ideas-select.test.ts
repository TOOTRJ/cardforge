import { describe, expect, it } from "vitest";
import {
  IDEA_FIELD_GROUPS,
  composeIdeaPatch,
  ideaFieldSummary,
  ideaHasField,
  wholeIdeaSelection,
  type CardIdea,
} from "@/lib/ai/card-ideas-select";

const a: CardIdea = {
  title: "Tidewatch Sentinel", cost: "{1}{U}", card_type: "creature", supertype: null, subtypes: ["Merfolk", "Scout"],
  rarity: "uncommon", color_identity: ["blue"], rules_text: "Flying", flavor_text: "It never blinks.",
  power: "1", toughness: "3", loyalty: null, defense: null,
};
const b: CardIdea = {
  title: "Riptide", cost: "{2}{U}", card_type: "instant", supertype: null, subtypes: [],
  rarity: "common", color_identity: ["blue"], rules_text: "Return target creature to its owner's hand.",
  flavor_text: null, power: null, toughness: null, loyalty: null, defense: null,
};

describe("card ideas — composing the user's picks into a form patch", () => {
  it("a whole-idea selection reproduces that idea", () => {
    const patch = composeIdeaPatch([a, b], wholeIdeaSelection(1));
    expect(patch).toEqual({
      title: "Riptide", card_type: "instant", supertype: "", subtypes_text: "", cost: "{2}{U}",
      color_identity: ["blue"], rarity: "common", rules_text: "Return target creature to its owner's hand.",
      flavor_text: "", power: "", toughness: "", loyalty: "", defense: "",
    });
  });

  it("mixes field groups across ideas", () => {
    const patch = composeIdeaPatch([a, b], { ...wholeIdeaSelection(0), title: 1, rulesText: 1 });
    expect(patch.title).toBe("Riptide");
    expect(patch.rules_text).toBe("Return target creature to its owner's hand.");
    expect(patch.card_type).toBe("creature");
    expect(patch.subtypes_text).toBe("Merfolk, Scout");
    expect(patch.power).toBe("1");
  });

  it("summarizes each group for the option chips", () => {
    expect(ideaFieldSummary(a, "typeLine")).toBe("creature — Merfolk Scout");
    expect(ideaFieldSummary(a, "costColors")).toBe("{1}{U} · blue");
    expect(ideaFieldSummary(a, "stats")).toBe("1 / 3");
    expect(ideaFieldSummary(b, "stats")).toBe("(none)");
    expect(ideaHasField(b, "flavorText")).toBe(false);
    expect(IDEA_FIELD_GROUPS).toHaveLength(7);
  });

  it("returns an empty patch with no ideas", () => {
    expect(composeIdeaPatch([], wholeIdeaSelection(0))).toEqual({});
  });
});
