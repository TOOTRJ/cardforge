import { describe, expect, it } from "vitest";
import {
  cardGlyphFields,
  displayCharacter,
  findUnrenderableText,
  unrenderableCharacters,
  type GlyphCheckValues,
} from "@/lib/validation/card-glyphs";

// TODO 6.16a: the creator warns (never blocks) about characters the card
// IMAGE may not draw now that the bake never fetches fonts or emoji. The
// expectations below were checked against real bakes (the 6.16a review's
// synthetic cards): what the model flags is what the PNG leaves blank.

const BASE: GlyphCheckValues = {
  title: "Kiba and Akamaru",
  supertype: "Legendary",
  subtypes_text: "Wurm",
  rules_text: "Trample\nWhen this creature enters, create a 5/5 green Wurm — {T}: add {G}.",
  flavor_text: "“No one in the Conclave acts alone.” — Élan, ½ • ←→",
  power: "5",
  toughness: "5",
  loyalty: "",
  defense: "",
  artist_credit: "Volkan Baǵa",
  footer_text: "",
  loyalty_abilities: [],
  saga_intro: "",
  saga_chapters: [],
  has_back_face: false,
  back_face: {
    title: "",
    supertype: "",
    subtypes_text: "",
    rules_text: "",
    flavor_text: "",
    power: "",
    toughness: "",
    loyalty: "",
    defense: "",
  },
};

describe("unrenderableCharacters", () => {
  it("passes everything the card fonts (and, in rules text, the Noto fallback) draw", () => {
    expect(unrenderableCharacters(BASE.rules_text, "rules")).toEqual([]);
    expect(unrenderableCharacters(BASE.flavor_text, "italic")).toEqual([]);
    expect(unrenderableCharacters("Ǵoran of the Бездна — Δράκων", "rules")).toEqual([]);
    expect(unrenderableCharacters("​Roots hold.", "italic")).toEqual([]);
  });

  it("flags emoji and scripts no bundled font covers, once each, in order", () => {
    expect(unrenderableCharacters("Fire 🔥 and 竜の炎 🔥 👍🏽", "rules")).toEqual(["🔥", "竜", "の", "炎", "👍🏽"]);
    expect(unrenderableCharacters("Flying ★ عربى", "rules")).toEqual(["★", "ع", "ر", "ب", "ى"]);
  });

  it("flags what MPlantin maps to an EMPTY glyph in rules text (it vanishes from the bake)", () => {
    // Baked on main and on 6.16a alike as "apek deals 2 damage at 90 — …".
    expect(unrenderableCharacters("Čapek deals 2× damage at 90° — đây → ∞", "rules")).toEqual([
      "Č",
      "×",
      "°",
      "đ",
      "→",
      "∞",
    ]);
    // …while MPlantin italic draws them, in flavor text and reminder text.
    expect(unrenderableCharacters("Čapek deals 2× damage at 90°", "italic")).toEqual([]);
    expect(unrenderableCharacters("Flying (Čapek, 90°.)", "rules")).toEqual([]);
  });

  it("never reaches the Noto fallback in italic runs", () => {
    // Real bake: "“Ǵoran…” —Ǵ. Baǵa" → "“ oran… — . Ba a".
    expect(unrenderableCharacters("“Ǵoran knew.” —Ǵ. Baǵa", "italic")).toEqual(["Ǵ", "ǵ"]);
    expect(unrenderableCharacters("Ward (Ǵ)", "rules")).toEqual(["Ǵ"]);
    expect(unrenderableCharacters("Ǵoran attacks.", "rules")).toEqual([]);
  });

  it("passes decomposed (NFD) letters in rules text — the bake answers their marks from Noto", () => {
    expect(unrenderableCharacters("Für den König: Jalapeño", "rules")).toEqual([]);
  });

  it("knows the bake prints a minus sign as a hyphen, and skips mana tokens", () => {
    expect(unrenderableCharacters("−2: Draw a card.", "rules")).toEqual([]);
    expect(unrenderableCharacters("{T}, {∞}: Add {G}.", "rules")).toEqual([]);
  });

  it("holds display fields to Beleren then MPlantin, without the Noto fallback", () => {
    expect(unrenderableCharacters("Volkan Baǵa", "display")).toEqual(["ǵ"]);
    expect(unrenderableCharacters("Volkan Baǵa", "rules")).toEqual([]);
    expect(unrenderableCharacters("Serra Angel — Ω", "display")).toEqual([]);
    expect(unrenderableCharacters("Čapek, 90°", "display")).toEqual([]);
    // Beleren lacks U+02BA; MPlantin, next in the display font list, draws it.
    expect(unrenderableCharacters("ʺ", "display")).toEqual([]);
  });

  it("checks the upper-case form of a line some templates print in capitals", () => {
    // ß upper-cases to "SS" (drawn); ƒ to Ƒ, which no display font has.
    expect(unrenderableCharacters("Straße", "display", { uppercase: true })).toEqual([]);
    expect(unrenderableCharacters("ƒ", "display")).toEqual([]);
    expect(unrenderableCharacters("ƒ", "display", { uppercase: true })).toEqual(["ƒ"]);
  });

  it("ignores whitespace and zero-width characters, and handles empty values", () => {
    expect(unrenderableCharacters("a\n\tb  c\r\n", "rules")).toEqual([]);
    expect(unrenderableCharacters("a​b", "display")).toEqual([]);
    expect(unrenderableCharacters("", "italic")).toEqual([]);
    expect(unrenderableCharacters(null, "display")).toEqual([]);
  });
});

describe("findUnrenderableText over the creator's fields", () => {
  it("is empty for a card the image draws in full", () => {
    expect(findUnrenderableText(cardGlyphFields({ ...BASE, artist_credit: "Volkan Baga" }))).toEqual([]);
  });

  it("labels each field with its characters, back face included only when on", () => {
    const values: GlyphCheckValues = {
      ...BASE,
      title: "Ember 🔥 Drake",
      flavor_text: "竜",
      loyalty_abilities: [{ text: "Draw ★" }],
      back_face: { ...BASE.back_face, title: "Ash 👍" },
    };
    expect(findUnrenderableText(cardGlyphFields(values))).toEqual([
      { label: "Name", characters: ["🔥"] },
      { label: "Loyalty ability 1", characters: ["★"] },
      { label: "Flavor text", characters: ["竜"] },
      { label: "Artist", characters: ["ǵ"] },
    ]);
    expect(findUnrenderableText(cardGlyphFields({ ...values, has_back_face: true })).map((f) => f.label)).toContain(
      "Back face name",
    );
  });

  it("survives missing row arrays (a partial reset never takes the form down)", () => {
    const values = { ...BASE, loyalty_abilities: undefined, saga_chapters: undefined };
    expect(() => cardGlyphFields(values)).not.toThrow();
    expect(findUnrenderableText(cardGlyphFields(values)).map((f) => f.label)).toEqual(["Artist"]);
  });
});

describe("displayCharacter", () => {
  it("shows visible characters as themselves and invisible ones by code point", () => {
    expect(displayCharacter("🔥")).toBe("🔥");
    expect(displayCharacter("ǵ")).toBe("ǵ");
    expect(displayCharacter("​")).toBe("U+200B");
    expect(displayCharacter("́")).toBe("U+0301");
  });
});
