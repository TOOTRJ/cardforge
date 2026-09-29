import { describe, expect, it } from "vitest";
import { lintCardDesign } from "@/lib/ai/mtg-rules";
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
