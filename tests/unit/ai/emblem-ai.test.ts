import { describe, expect, it } from "vitest";
import { autofixCard, lintCardDesign } from "@/lib/ai/mtg-rules";
import { fillPromptNote } from "@/lib/ai/card-fill-shared";

// ---------------------------------------------------------------------------
// TODO 6.23 on the AI side: an emblem has no mana cost (CR 114), so the lint
// doesn't ask about one, and a per-field fill on an open emblem pins its
// printed line ("Emblem", "Emblem — Kaito").
// ---------------------------------------------------------------------------

const base = {
  title: "Kaito, Cunning Infiltrator",
  cost: "",
  card_type: "emblem" as const,
  supertype: null,
  subtypes: [],
  color_identity: [],
  rules_text: "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.",
  power: null,
  toughness: null,
  loyalty: null,
  defense: null,
};

describe("the AI rules on an emblem", () => {
  it("doesn't warn that an emblem has no mana cost (a nonland spell still does)", () => {
    const emblem = lintCardDesign(base);
    expect(emblem.warnings.map((w) => w.field)).not.toContain("cost");
    expect(emblem.errors).toEqual([]);
    const sorcery = lintCardDesign({ ...base, card_type: "sorcery" });
    expect(sorcery.warnings.map((w) => w.field)).toContain("cost");
  });

  it("pins an emblem's printed line in a per-field fill", () => {
    expect(fillPromptNote({ card_type: "emblem", subtypes: [] }, ["rules_text"])).toContain('type line "Emblem"');
    expect(fillPromptNote({ card_type: "emblem", subtypes: ["Kaito"] }, ["rules_text"])).toContain(
      'type line "Emblem — Kaito"',
    );
  });
});

describe("CR 114 in the AI lint and autofix (skeptic review)", () => {
  it("an emblem with a mana cost is an error, as a land's is", () => {
    for (const cost of ["{2}{U}", "{0}"]) {
      const lint = lintCardDesign({ ...base, cost });
      expect(lint.errors.map((e) => e.field), cost).toContain("cost");
    }
    expect(lintCardDesign({ ...base, cost: "—" }).errors).toEqual([]);
  });

  it("an emblem has no colour: a colour is an error, and its text's mana symbols give it none", () => {
    const red = lintCardDesign({ ...base, color_identity: ["red"] });
    expect(red.errors.map((e) => e.field)).toContain("color_identity");
    // "Add {U}" on a colourless emblem asks for no blue.
    const mana = lintCardDesign({ ...base, color_identity: ["colorless"], rules_text: "At the beginning of your upkeep, add {U}." });
    expect(mana.errors).toEqual([]);
    expect(mana.warnings.map((w) => w.field)).not.toContain("color_identity");
  });

  it("autofix leaves an emblem with no cost, colour or stats", () => {
    const fixed = autofixCard({
      ...base,
      cost: "{2}{U}",
      color_identity: ["blue"],
      rules_text: "At the beginning of your upkeep, add {U}.",
      power: "2",
      toughness: "2",
      loyalty: "3",
    });
    expect(fixed).toMatchObject({ cost: "—", color_identity: ["colorless"], power: null, toughness: null, loyalty: null, defense: null });
    expect(lintCardDesign(fixed).errors).toEqual([]);
  });

  it("the fill tells the designer what an emblem is, only for an emblem", () => {
    const note = fillPromptNote({ card_type: "emblem", subtypes: [] }, ["rules_text"]);
    expect(note).toMatch(/emblem/i);
    expect(note).toContain('no mana cost (use "—")');
    expect(note).toContain('color_identity ["colorless"]');
    expect(fillPromptNote({ card_type: "creature", subtypes: [] }, ["rules_text"])).not.toMatch(/emblem/i);
    // Generating the card type leaves the emblem: no emblem rules then.
    expect(fillPromptNote({ card_type: "emblem", subtypes: [] }, ["card_type", "rules_text"])).not.toMatch(/emblem/i);
  });
});
