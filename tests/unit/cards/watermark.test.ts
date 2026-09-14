import { describe, expect, it } from "vitest";
import {
  basicLandManaKey,
  basicSubtypeManaKey,
  hasBasicSupertype,
  isBasicLandTitle,
  resolveWatermark,
} from "@/lib/cards/watermark";

describe("basicLandManaKey — the one basic-land rule", () => {
  it("a Basic supertype with a basic land type is a basic (big symbol)", () => {
    expect(basicLandManaKey({ cardType: "land", supertype: "Basic", subtypes: ["Forest"], title: "Forest" })).toBe("g");
    expect(basicLandManaKey({ cardType: "land", supertype: "Basic Snow", subtypes: ["Island"], title: "Snow-Covered Island" })).toBe("u");
    // Case/whitespace tolerant on the subtype.
    expect(basicLandManaKey({ cardType: "land", supertype: "basic", subtypes: [" plains "] })).toBe("w");
  });

  it("Wastes is a basic with NO land type — recognised by name", () => {
    expect(basicLandManaKey({ cardType: "land", supertype: "Basic", subtypes: [], title: "Wastes" })).toBe("c");
    expect(basicLandManaKey({ cardType: "land", supertype: "Basic", subtypes: [], title: "Snow-Covered Wastes" })).toBe("c");
    // Legacy rows stored Wastes as a subtype — still a basic.
    expect(basicLandManaKey({ cardType: "land", supertype: "Basic", subtypes: ["Wastes"], title: "Wastes" })).toBe("c");
  });

  it("REGRESSION 2026-09-14: a renamed/imported nonbasic never goes textless", () => {
    // Command Tower typed over a seeded Plains — once the creator drops the
    // seed the card has no Basic supertype and prints its text.
    expect(
      basicLandManaKey({
        cardType: "land",
        supertype: "",
        subtypes: [],
        title: "Command Tower",
        rulesText: "{T}: Add one mana of any color in your commander's color identity.",
      }),
    ).toBeNull();
    // A dual land with basic land types prints rules text (Breeding Pool).
    expect(
      basicLandManaKey({
        cardType: "land",
        supertype: null,
        subtypes: ["Forest", "Island"],
        title: "Breeding Pool",
        rulesText: "({T}: Add {G} or {U}.)\nAs Breeding Pool enters, you may pay 2 life.",
      }),
    ).toBeNull();
    // Legendary land with a land type and text (Dryad Arbor-style) — nonbasic.
    expect(
      basicLandManaKey({ cardType: "land", supertype: "Legendary", subtypes: ["Forest"], title: "Elder Grove", rulesText: "Hexproof" }),
    ).toBeNull();
  });

  it("legacy/AI shape: a basic subtype with no supertype and no text stays a basic", () => {
    expect(basicLandManaKey({ cardType: "land", supertype: null, subtypes: ["Mountain"], title: "Mountain", rulesText: "" })).toBe("r");
    expect(basicLandManaKey({ cardType: "land", supertype: undefined, subtypes: ["Swamp"], title: "Gloom Marsh", rulesText: null })).toBe("b");
  });

  it("only lands qualify, and a Basic supertype without any land type (not Wastes) is not a basic", () => {
    expect(basicLandManaKey({ cardType: "creature", supertype: "Basic", subtypes: ["Forest"] })).toBeNull();
    expect(basicLandManaKey({ cardType: null, subtypes: ["Forest"] })).toBeNull();
    expect(basicLandManaKey({ cardType: "land", supertype: "Basic", subtypes: [], title: "Elven Grove" })).toBeNull();
  });
});

describe("helpers", () => {
  it("hasBasicSupertype / isBasicLandTitle / basicSubtypeManaKey", () => {
    expect(hasBasicSupertype("Basic")).toBe(true);
    expect(hasBasicSupertype("Basic Snow")).toBe(true);
    expect(hasBasicSupertype("Legendary")).toBe(false);
    expect(hasBasicSupertype(null)).toBe(false);
    expect(isBasicLandTitle("Forest")).toBe(true);
    expect(isBasicLandTitle(" snow-covered mountain ")).toBe(true);
    expect(isBasicLandTitle("Wastes")).toBe(true);
    expect(isBasicLandTitle("Command Tower")).toBe(false);
    expect(isBasicLandTitle("")).toBe(false);
    expect(basicSubtypeManaKey(["Elf", "Forest"])).toBe("g");
    expect(basicSubtypeManaKey(["Elf"])).toBeNull();
    expect(basicSubtypeManaKey(null)).toBeNull();
  });
});

describe("resolveWatermark", () => {
  it("an explicit watermark wins; basics get the large mana symbol; others nothing", () => {
    const explicit = { kind: "preset" as const, key: "order-sun", size: "normal" as const };
    expect(resolveWatermark(explicit, { cardType: "land", supertype: "Basic", subtypes: ["Forest"] })).toBe(explicit);
    expect(resolveWatermark(null, { cardType: "land", supertype: "Basic", subtypes: ["Forest"] })).toEqual({
      kind: "mana",
      key: "g",
      size: "large",
    });
    expect(resolveWatermark(null, { cardType: "land", supertype: "", subtypes: [], title: "Command Tower", rulesText: "{T}: Add {C}." })).toBeNull();
    expect(resolveWatermark(undefined, { cardType: "creature", subtypes: ["Elf"] })).toBeNull();
  });
});
