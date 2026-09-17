import { describe, expect, it } from "vitest";
import {
  CARD_FILL_FIELDS,
  CREATE_ONLY_FILL_FIELDS,
  FILL_PRESETS,
  fillPromptNote,
  pickFillResult,
  type DesignedLike,
} from "@/lib/ai/card-fill-shared";

const designed: DesignedLike = {
  title: "Emberwake Tyrant",
  cost: "{3}{R}{R}",
  card_type: "creature",
  supertype: null,
  subtypes: ["Dragon"],
  rarity: "rare",
  color_identity: ["red"],
  rules_text: "Flying, haste",
  flavor_text: "Its allies learned to fly behind it.",
  power: "4",
  toughness: "4",
  loyalty: null,
  defense: null,
  tags: ["dragons", "aggro"],
};

describe("pickFillResult", () => {
  it("keeps only the wanted fields", () => {
    const out = pickFillResult(designed, ["title", "flavor_text"]);
    expect(out).toEqual({
      title: "Emberwake Tyrant",
      flavor_text: "Its allies learned to fly behind it.",
    });
  });

  it("moves stats and the type line as groups", () => {
    const out = pickFillResult(designed, ["stats", "card_type"]);
    expect(out.power).toBe("4");
    expect(out.toughness).toBe("4");
    expect(out.loyalty).toBeNull();
    expect(out.card_type).toBe("creature");
    expect(out.subtypes).toEqual(["Dragon"]);
    expect(out.title).toBeUndefined();
  });

  it("never carries the designer's take on an unticked field", () => {
    const out = pickFillResult(designed, ["art"]);
    expect(Object.keys(out)).toEqual([]);
  });

  it("returns [] for tags when the designer omitted them", () => {
    const out = pickFillResult({ ...designed, tags: undefined }, ["tags"]);
    expect(out.tags).toEqual([]);
  });
});

describe("fillPromptNote", () => {
  it("pins every unticked value verbatim and names what to design", () => {
    const note = fillPromptNote(
      {
        title: "Stone Stare",
        card_type: "instant",
        color_identity: ["black"],
        cost: "{2}{B}",
        rules_text: "Target creature gets -X/-X.",
      },
      ["flavor_text", "art"],
    );
    expect(note).toContain('title "Stone Stare"');
    expect(note).toContain('type line "instant"');
    expect(note).toContain("color identity black");
    expect(note).toContain("mana cost {2}{B}");
    expect(note).toContain('rules text "Target creature gets -X/-X."');
    expect(note).toContain("Design only: flavor text");
    expect(note).not.toContain("artwork");
  });

  it("asks only for an art prompt when just the art is wanted", () => {
    const note = fillPromptNote({ title: "Stone Stare" }, ["art"]);
    expect(note).toContain("Only the artwork is being generated");
  });

  it("pins nothing for an empty card", () => {
    const note = fillPromptNote({}, ["title", "rules_text"]);
    expect(note).not.toContain("Keep these");
    expect(note).toContain("Design only: title, rules text");
  });
});

describe("presets", () => {
  it("hero ticks everything; the step buttons tick their own fields", () => {
    expect(FILL_PRESETS.all).toEqual([...CARD_FILL_FIELDS]);
    expect(FILL_PRESETS.artAndTitle).toEqual(["title", "art"]);
    expect(FILL_PRESETS.textStep).toContain("rules_text");
    expect(FILL_PRESETS.textStep).not.toContain("art");
  });

  it("only the structural fields are create-only", () => {
    expect(CREATE_ONLY_FILL_FIELDS).toEqual(["card_type", "color_identity"]);
  });
});
