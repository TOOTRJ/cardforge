import { describe, expect, it } from "vitest";
import {
  mapScryfallToFormPatch,
  parseColorIdentity,
  parseTypeLine,
} from "@/lib/scryfall/import-mapper";
import type { ScryfallCard } from "@/lib/scryfall/client";

// ---------------------------------------------------------------------------
// Tests for lib/scryfall/import-mapper.ts.
//
// The mapper is the bridge between Scryfall's payload shape and our
// form's CardCreatorForm field names. It's pure (no I/O) so we feed it
// fixtures and assert the patch shape.
//
// Fixtures are minimal — only fields the mapper actually reads. Real
// Scryfall responses carry dozens more keys; we ignore them.
// ---------------------------------------------------------------------------

function fixture(overrides: Partial<ScryfallCard>): ScryfallCard {
  return {
    id: "94c70f23-0ca9-425e-a53a-6c09921c0075",
    name: "Test Card",
    ...overrides,
  } as ScryfallCard;
}

describe("parseTypeLine", () => {
  it("handles 'Type — Subtype' form", () => {
    expect(parseTypeLine("Creature — Dragon")).toEqual({
      supertype: undefined,
      card_type: "creature",
      subtypes_text: "Dragon",
    });
  });

  it("captures Legendary as a supertype", () => {
    // The mapper joins subtypes with ", " — Scryfall type lines list
    // subtypes space-separated, but our DB stores them comma-separated.
    expect(parseTypeLine("Legendary Creature — Dragon Elder")).toEqual({
      supertype: "Legendary",
      card_type: "creature",
      subtypes_text: "Dragon, Elder",
    });
  });

  it("collapses Instant/Sorcery to our 'spell' enum", () => {
    expect(parseTypeLine("Instant")).toEqual({
      supertype: undefined,
      card_type: "spell",
      subtypes_text: undefined,
    });
    expect(parseTypeLine("Sorcery")).toEqual({
      supertype: undefined,
      card_type: "spell",
      subtypes_text: undefined,
    });
  });

  it("returns empty object for null input", () => {
    expect(parseTypeLine(null)).toEqual({});
    expect(parseTypeLine(undefined)).toEqual({});
  });

  it("reads only the front of a DFC type line", () => {
    expect(
      parseTypeLine("Creature — Human Wizard // Creature — Human Insect"),
    ).toEqual({
      supertype: undefined,
      card_type: "creature",
      subtypes_text: "Human, Wizard",
    });
  });
});

describe("parseColorIdentity", () => {
  it("maps W/U/B/R/G to the readable enum", () => {
    const card = fixture({ color_identity: ["W", "U"] });
    expect(parseColorIdentity(card)).toEqual(["white", "blue"]);
  });

  it("falls back to `colors` when color_identity is missing", () => {
    const card = fixture({ colors: ["R"] });
    expect(parseColorIdentity(card)).toEqual(["red"]);
  });

  it("surfaces 'colorless' for an empty identity", () => {
    const card = fixture({ color_identity: [] });
    expect(parseColorIdentity(card)).toEqual(["colorless"]);
  });

  it("ignores unknown color codes", () => {
    const card = fixture({ color_identity: ["W", "Q"] });
    expect(parseColorIdentity(card)).toEqual(["white"]);
  });
});

describe("mapScryfallToFormPatch", () => {
  it("seeds a single-face card patch", () => {
    const card = fixture({
      name: "Lightning Bolt",
      mana_cost: "{R}",
      type_line: "Instant",
      oracle_text: "Lightning Bolt deals 3 damage to any target.",
      rarity: "common",
      color_identity: ["R"],
      colors: ["R"],
      artist: "Christopher Rush",
    });

    const patch = mapScryfallToFormPatch(card);
    expect(patch.title).toBe("Lightning Bolt");
    expect(patch.cost).toBe("{R}");
    expect(patch.card_type).toBe("spell");
    expect(patch.rarity).toBe("common");
    expect(patch.color_identity).toEqual(["red"]);
    expect(patch.rules_text).toBe(
      "Lightning Bolt deals 3 damage to any target.",
    );
    expect(patch.artist_credit).toBe("Christopher Rush");
    expect(patch.source_scryfall_id).toBe(card.id);
    expect(patch.back_face).toBeUndefined();
  });

  it("collapses Scryfall's 'special' rarity to mythic", () => {
    const card = fixture({ rarity: "special" });
    expect(mapScryfallToFormPatch(card).rarity).toBe("mythic");
  });

  it("emits back_face for a DFC card (chunk 10)", () => {
    const card = fixture({
      name: "Delver of Secrets",
      type_line: "Creature — Human Wizard",
      card_faces: [
        {
          name: "Delver of Secrets",
          type_line: "Creature — Human Wizard",
          mana_cost: "{U}",
        },
        {
          name: "Insectile Aberration",
          type_line: "Creature — Human Insect",
          mana_cost: undefined,
          power: "3",
          toughness: "2",
        },
      ],
    });

    const patch = mapScryfallToFormPatch(card);
    expect(patch.back_face).toBeDefined();
    expect(patch.back_face?.title).toBe("Insectile Aberration");
    expect(patch.back_face?.card_type).toBe("creature");
    expect(patch.back_face?.subtypes_text).toBe("Human, Insect");
    expect(patch.back_face?.power).toBe("3");
    expect(patch.back_face?.toughness).toBe("2");
  });

  it("omits back_face for a single-faced card", () => {
    const card = fixture({
      card_faces: [
        { name: "Lightning Bolt", type_line: "Instant", mana_cost: "{R}" },
      ],
    });
    expect(mapScryfallToFormPatch(card).back_face).toBeUndefined();
  });

  it("doesn't fabricate fields when Scryfall data is missing", () => {
    const card = fixture({ name: "Mystery", rarity: undefined });
    const patch = mapScryfallToFormPatch(card);
    expect(patch.rarity).toBeUndefined();
    expect(patch.cost).toBeUndefined();
  });
});
