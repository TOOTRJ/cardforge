import { describe, expect, it } from "vitest";
import {
  kindFromScryfall,
  mapScryfallToFormPatch,
  parseColorIdentity,
  parseTypeLine,
} from "@/lib/scryfall/import-mapper";
import {
  normalizeScryfallImageUrl,
  scryfallImageUrisSchema,
  type ScryfallCard,
} from "@/lib/scryfall/client";
import { statVisibility } from "@/lib/creator/steps";
import { parseSubtypes } from "@/lib/creator/card-fields";

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

  it("maps Instant/Sorcery to their own card types", () => {
    expect(parseTypeLine("Instant")).toEqual({
      supertype: undefined,
      card_type: "instant",
      subtypes_text: undefined,
    });
    expect(parseTypeLine("Sorcery")).toEqual({
      supertype: undefined,
      card_type: "sorcery",
      subtypes_text: undefined,
    });
  });

  it("lets creature win over other type words (artifact/enchantment creatures)", () => {
    // Real MTG renders these with a P/T box, and the form gates the P/T
    // inputs on card_type === creature — so creature must win.
    expect(parseTypeLine("Artifact Creature — Construct")).toEqual({
      supertype: undefined,
      card_type: "creature",
      subtypes_text: "Construct",
    });
    expect(parseTypeLine("Legendary Enchantment Creature — God")).toEqual({
      supertype: "Legendary",
      card_type: "creature",
      subtypes_text: "God",
    });
    // Word order doesn't matter — creature wins even when listed first.
    expect(parseTypeLine("Creature Artifact — Construct").card_type).toBe(
      "creature",
    );
  });

  it("keeps token precedence over creature", () => {
    // Token type lines ("Token Creature — Goblin") stay tokens: token is
    // a distinct kind with its own frames, and those render P/T anyway.
    expect(parseTypeLine("Token Creature — Goblin")).toEqual({
      supertype: undefined,
      card_type: "token",
      subtypes_text: "Goblin",
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
    expect(patch.card_type).toBe("instant");
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

  it("keeps P/T visible for an imported artifact creature", () => {
    // Regression: card_type "artifact" would hide the P/T inputs via
    // statVisibility even though the card has power/toughness.
    const patch = mapScryfallToFormPatch(
      fixture({
        name: "Steel Overseer",
        type_line: "Artifact Creature — Construct",
        power: "1",
        toughness: "1",
      }),
    );
    expect(patch.card_type).toBe("creature");
    expect(patch.power).toBe("1");
    expect(patch.toughness).toBe("1");
    expect(statVisibility(patch.card_type).pt).toBe(true);
  });

  it("keeps P/T visible for an imported Vehicle (subtype-driven)", () => {
    // Vehicles are artifacts with printed P/T — the type line has no
    // creature word, so visibility comes from the Vehicle subtype.
    const patch = mapScryfallToFormPatch(
      fixture({
        name: "Smuggler's Copter",
        type_line: "Artifact — Vehicle",
        power: "3",
        toughness: "3",
      }),
    );
    expect(patch.card_type).toBe("artifact");
    expect(patch.subtypes_text).toBe("Vehicle");
    expect(patch.power).toBe("3");
    expect(patch.toughness).toBe("3");
    // Same call shape as the form: parsed subtypes_text feeds the gate.
    expect(
      statVisibility(patch.card_type, parseSubtypes(patch.subtypes_text ?? ""))
        .pt,
    ).toBe(true);
  });

  it("doesn't fabricate fields when Scryfall data is missing", () => {
    const card = fixture({ name: "Mystery", rarity: undefined });
    const patch = mapScryfallToFormPatch(card);
    expect(patch.rarity).toBeUndefined();
    expect(patch.cost).toBeUndefined();
  });
});

describe("kindFromScryfall", () => {
  it("maps layout kinds directly (saga / adventure / flip)", () => {
    expect(
      kindFromScryfall(
        fixture({ layout: "saga", type_line: "Enchantment — Saga" }),
      ),
    ).toBe("saga");
    expect(
      kindFromScryfall(
        fixture({ layout: "adventure", type_line: "Creature — Human // Instant — Adventure" }),
      ),
    ).toBe("adventure");
    expect(kindFromScryfall(fixture({ layout: "flip" }))).toBe("flip");
  });

  it("splits split vs aftermath on the Aftermath keyword", () => {
    expect(
      kindFromScryfall(fixture({ layout: "split", keywords: ["Fuse"] })),
    ).toBe("split");
    expect(
      kindFromScryfall(fixture({ layout: "split", keywords: ["Aftermath"] })),
    ).toBe("aftermath");
    expect(kindFromScryfall(fixture({ layout: "split" }))).toBe("split");
  });

  it("derives planeswalker from the type line — there is no planeswalker layout", () => {
    expect(
      kindFromScryfall(
        fixture({
          layout: "normal",
          type_line: "Legendary Planeswalker — Jace",
          loyalty: "3",
        }),
      ),
    ).toBe("planeswalker");
  });

  it("derives battle from the transform front face (layout battle matches zero real cards)", () => {
    expect(
      kindFromScryfall(
        fixture({
          layout: "transform",
          type_line: "Battle — Siege // Land",
          card_faces: [
            { name: "Invasion of Zendikar", type_line: "Battle — Siege", defense: "3" },
            { name: "Awakened Skyclave", type_line: "Land" },
          ],
        }),
      ),
    ).toBe("battle");
  });

  it("degrades unmodeled layouts to the type-mapped standard kind", () => {
    expect(
      kindFromScryfall(
        fixture({ layout: "class", type_line: "Enchantment — Class" }),
      ),
    ).toBe("enchantment");
    expect(
      kindFromScryfall(
        fixture({ layout: "leveler", type_line: "Creature — Human Warrior" }),
      ),
    ).toBe("creature");
    // Creature outranks the other type words, so "Artifact Creature"
    // maps to the creature kind (it renders with a P/T box).
    expect(
      kindFromScryfall(
        fixture({ layout: "prototype", type_line: "Artifact Creature — Construct" }),
      ),
    ).toBe("creature");
  });

  it("returns undefined when nothing is derivable", () => {
    expect(kindFromScryfall(fixture({ layout: "planar" }))).toBeUndefined();
  });

  it("lands on the patch via mapScryfallToFormPatch", () => {
    const patch = mapScryfallToFormPatch(
      fixture({ layout: "saga", type_line: "Enchantment — Saga" }),
    );
    expect(patch.kind).toBe("saga");
    expect(patch.card_type).toBe("enchantment");
  });
});

describe("normalizeScryfallImageUrl", () => {
  it("rewrites the ad-blocker-prone bcdn host to the canonical one", () => {
    expect(
      normalizeScryfallImageUrl(
        "https://cards.bcdn.scryfall.io/png/front/a/a/aa8f58f1.png?123",
      ),
    ).toBe("https://cards.scryfall.io/png/front/a/a/aa8f58f1.png?123");
  });

  it("leaves canonical and unrelated URLs untouched", () => {
    expect(
      normalizeScryfallImageUrl("https://cards.scryfall.io/art_crop/x.jpg"),
    ).toBe("https://cards.scryfall.io/art_crop/x.jpg");
    expect(normalizeScryfallImageUrl("https://svgs.scryfall.io/a.svg")).toBe(
      "https://svgs.scryfall.io/a.svg",
    );
  });

  it("normalizes through the image_uris schema parse", () => {
    const parsed = scryfallImageUrisSchema.parse({
      art_crop: "https://cards.bcdn.scryfall.io/art_crop/front/x.jpg",
    });
    expect(parsed.art_crop).toBe("https://cards.scryfall.io/art_crop/front/x.jpg");
  });
});
