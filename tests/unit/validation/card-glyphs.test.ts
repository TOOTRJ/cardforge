import { describe, expect, it } from "vitest";
import {
  cardGlyphFields,
  displayCharacter,
  findUnrenderableText,
  unrenderableCharacters,
  type GlyphCheckValues,
} from "@/lib/validation/card-glyphs";

// TODO 6.16a: the creator warns (never blocks) about characters the card
// IMAGE can't draw now that the bake never fetches fonts or emoji.

const BASE: GlyphCheckValues = {
  title: "Kiba and Akamaru",
  supertype: "Legendary",
  subtypes_text: "Wurm",
  rules_text: "Trample\nWhen this creature enters, create a 5/5 green Wurm — {T}: add {G}.",
  flavor_text: "“No one in the Conclave acts alone.” — Élan, ½ ∞ • ←→",
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
  it("passes everything the card fonts (and the Noto fallback, in body text) draw", () => {
    expect(unrenderableCharacters(BASE.rules_text, "body")).toEqual([]);
    expect(unrenderableCharacters(BASE.flavor_text, "body")).toEqual([]);
    expect(unrenderableCharacters("Ǵoran of the Бездна — Δράκων", "body")).toEqual([]);
    expect(unrenderableCharacters("​Roots hold.", "body")).toEqual([]);
  });

  it("flags emoji and scripts no bundled font covers, once each, in order", () => {
    expect(unrenderableCharacters("Fire 🔥 and 竜の炎 🔥 👍🏽", "body")).toEqual(["🔥", "竜", "の", "炎", "👍🏽"]);
    expect(unrenderableCharacters("Flying ★ عربى", "body")).toEqual(["★", "ع", "ر", "ب", "ى"]);
  });

  it("holds display fields to the display face (Beleren) alone", () => {
    // ǵ is in the Noto fallback, but inside a Beleren word it draws as a box.
    expect(unrenderableCharacters("Volkan Baǵa", "display")).toEqual(["ǵ"]);
    expect(unrenderableCharacters("Volkan Baǵa", "body")).toEqual([]);
    expect(unrenderableCharacters("Serra Angel — Ω", "display")).toEqual([]);
  });

  it("ignores whitespace and handles empty values", () => {
    expect(unrenderableCharacters("a\n\tb  c\r\n", "body")).toEqual([]);
    expect(unrenderableCharacters("", "body")).toEqual([]);
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
});

describe("displayCharacter", () => {
  it("shows visible characters as themselves and invisible ones by code point", () => {
    expect(displayCharacter("🔥")).toBe("🔥");
    expect(displayCharacter("ǵ")).toBe("ǵ");
    expect(displayCharacter("​")).toBe("U+200B");
    expect(displayCharacter("́")).toBe("U+0301");
  });
});
