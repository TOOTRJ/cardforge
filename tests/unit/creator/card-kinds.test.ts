import { describe, expect, it } from "vitest";
import {
  CARD_KIND_VALUES,
  KIND_DEFS,
  framesForKind,
  basicLandSeedForColorKey,
  isSeedableLandIdentity,
  kindFromCard,
  planKindChange,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { normalizeColorSelection } from "@/lib/creator/card-fields";

const NO_VERIFIED: ReadonlySet<string> = new Set();

describe("kindFromCard", () => {
  it("derives the kind from the template for layout kinds (template wins)", () => {
    expect(kindFromCard("enchantment", "saga")).toBe("saga");
    expect(kindFromCard("creature", "adventure")).toBe("adventure");
    expect(kindFromCard("instant", "split")).toBe("split");
    expect(kindFromCard("sorcery", "aftermath")).toBe("aftermath");
    expect(kindFromCard("creature", "flip")).toBe("flip");
    // Even a mismatched stored card_type can't shake the template's kind.
    expect(kindFromCard("creature", "saga")).toBe("saga");
  });

  it("derives the kind from card_type for standards, skins, and showcase", () => {
    expect(kindFromCard("creature", "m15")).toBe("creature");
    expect(kindFromCard("planeswalker", "m15pw")).toBe("planeswalker");
    expect(kindFromCard("creature", "m15snow")).toBe("creature");
    expect(kindFromCard("instant", "m15devoid")).toBe("instant");
    expect(kindFromCard("creature", "lotr")).toBe("creature");
    expect(kindFromCard("land", "alphaland")).toBe("land");
  });

  it("maps the legacy 'spell' card_type to sorcery without needing a template", () => {
    expect(kindFromCard("spell", "m15")).toBe("sorcery");
    expect(kindFromCard("spell", undefined)).toBe("sorcery");
  });

  it("defaults to creature for empty type + unknown/retired templates", () => {
    expect(kindFromCard("", undefined)).toBe("creature");
    expect(kindFromCard(null, "regular")).toBe("creature");
  });

  it("round-trips every kind through planKindChange's patch", () => {
    for (const kind of CARD_KIND_VALUES) {
      const plan = planKindChange(kind, { cardType: "creature", template: "m15" });
      expect(kindFromCard(plan.patch.card_type, plan.patch.template)).toBe(kind);
    }
  });
});

describe("framesForKind", () => {
  it("yields at least one frame for every kind, even with nothing verified", () => {
    for (const kind of CARD_KIND_VALUES) {
      expect(framesForKind(kind, NO_VERIFIED).length).toBeGreaterThan(0);
    }
  });

  it("never leaks an era that lacks the kind (no classic/retro/modern planeswalker)", () => {
    for (const kind of ["planeswalker", "battle"] as CardKind[]) {
      const eras = framesForKind(kind, NO_VERIFIED).map((f) => f.era);
      expect(eras).not.toContain("classic");
      expect(eras).not.toContain("retro");
      expect(eras).not.toContain("modern");
    }
    // Tokens exist in classic + m15 but not retro/modern.
    const tokenEras = framesForKind("token", NO_VERIFIED).map((f) => f.era);
    expect(tokenEras).toContain("classic");
    expect(tokenEras).toContain("m15");
    expect(tokenEras).not.toContain("retro");
    expect(tokenEras).not.toContain("modern");
  });

  it("gives layout kinds exactly their template family, nothing else", () => {
    expect(framesForKind("saga", NO_VERIFIED).map((f) => f.template)).toEqual([
      "saga",
    ]);
    expect(framesForKind("split", NO_VERIFIED).map((f) => f.template)).toEqual([
      "split",
    ]);
    // No skins, no showcase for layout kinds.
    for (const f of framesForKind("adventure", NO_VERIFIED)) {
      expect(f.group).toBe("layout");
    }
  });

  it("brings each era standard exactly its own skin variants", () => {
    const skinsFor = (kind: CardKind) =>
      framesForKind(kind, NO_VERIFIED)
        .filter((f) => f.group === "skin")
        .map((f) => f.template);
    expect(skinsFor("creature")).toEqual(["m15snow", "m15devoid"]);
    expect(skinsFor("land")).toEqual(["m15snowland"]);
    expect(skinsFor("token")).toEqual(["m15tokenartifact"]);
    // Standards with their own geometry and no skin set stay bare.
    for (const kind of ["planeswalker", "battle", "artifact"] as CardKind[]) {
      expect(skinsFor(kind)).toEqual([]);
    }
  });

  it("appends showcase treatments for every standard kind", () => {
    const groups = framesForKind("creature", NO_VERIFIED).map((f) => f.group);
    expect(groups).toContain("showcase");
    const eras = framesForKind("land", NO_VERIFIED).map((f) => f.era);
    expect(eras).toContain("showcase");
  });

  it("gates every combo on verification — nothing is grandfathered", () => {
    // With nothing verified, EVERY frame tile is gated.
    for (const f of framesForKind("creature", NO_VERIFIED)) {
      expect(f.availableColorKeys).toEqual([]);
    }

    // Publishing a combo makes exactly that color available.
    const oneCombo = new Set([frameComboKey("saga", "g")]);
    const saga = framesForKind("saga", oneCombo)[0];
    expect(saga.availableColorKeys).toEqual(["g"]);
    const m15 = framesForKind(
      "creature",
      new Set([frameComboKey("m15", "w")]),
    ).find((f) => f.template === "m15");
    expect(m15?.availableColorKeys).toEqual(["w"]);
  });
});

describe("planKindChange", () => {
  it("remaps within the current era when it has an equivalent frame", () => {
    expect(
      planKindChange("planeswalker", { cardType: "creature", template: "m15" }),
    ).toEqual({
      action: "apply",
      patch: { card_type: "planeswalker", template: "m15pw" },
    });
    expect(
      planKindChange("land", { cardType: "creature", template: "retro" }),
    ).toEqual({
      action: "apply",
      patch: { card_type: "land", template: "retroland" },
    });
  });

  it("asks before leaving an era that lacks the kind — never a silent fallback", () => {
    const plan = planKindChange("planeswalker", {
      cardType: "creature",
      template: "agclassic",
    });
    expect(plan.action).toBe("confirm");
    if (plan.action === "confirm") {
      expect(plan.reason).toBe("era-lacks-kind");
      expect(plan.message).toContain("Classic");
      expect(plan.patch).toEqual({
        card_type: "planeswalker",
        template: "m15pw",
      });
    }

    expect(
      planKindChange("battle", { cardType: "creature", template: "retro" })
        .action,
    ).toBe("confirm");
    expect(
      planKindChange("token", { cardType: "creature", template: "modern" })
        .action,
    ).toBe("confirm");
    // Showcase frames have no type mapping — any standard-kind change asks.
    expect(
      planKindChange("land", { cardType: "creature", template: "lotr" }).action,
    ).toBe("confirm");
  });

  it("applies layout kinds deterministically and force-enables the inline second face", () => {
    for (const kind of ["adventure", "split", "aftermath", "flip"] as CardKind[]) {
      const plan = planKindChange(kind, {
        cardType: "creature",
        template: "agclassic",
      });
      expect(plan.action).toBe("apply");
      expect(plan.patch.template).toBe(KIND_DEFS[kind].layoutTemplates?.[0]);
      expect(plan.patch.has_back_face).toBe(true);
    }
    // Saga is a layout kind but its face is single — no forced back face.
    const saga = planKindChange("saga", {
      cardType: "creature",
      template: "m15",
    });
    expect(saga.action).toBe("apply");
    expect(saga.patch).toEqual({ card_type: "enchantment", template: "saga" });
  });

  it("tolerates legacy/unknown current templates by normalizing to the default frame", () => {
    const plan = planKindChange("land", {
      cardType: "creature",
      template: "regular",
    });
    expect(plan).toEqual({
      action: "apply",
      patch: { card_type: "land", template: "m15land" },
    });
  });
});

describe("basic-land auto-identity", () => {
  it("seeds the basic matching the frame color, none for multicolor", () => {
    expect(basicLandSeedForColorKey("c")).toEqual({
      title: "Wastes",
      supertype: "Basic",
      subtypes_text: "Wastes",
    });
    expect(basicLandSeedForColorKey("g")?.title).toBe("Forest");
    expect(basicLandSeedForColorKey("m")).toBeNull();
    expect(basicLandSeedForColorKey("nope")).toBeNull();
  });

  it("treats empty or exactly-seeded identities as rewritable, user text as owned", () => {
    expect(
      isSeedableLandIdentity({ title: "", supertype: "", subtypes_text: "" }),
    ).toBe(true);
    expect(
      isSeedableLandIdentity({
        title: "Forest",
        supertype: "Basic",
        subtypes_text: "Forest",
      }),
    ).toBe(true);
    // A renamed card is user-owned even with the seeded subtype intact.
    expect(
      isSeedableLandIdentity({
        title: "Mystic Grove",
        supertype: "Basic",
        subtypes_text: "Forest",
      }),
    ).toBe(false);
    // Mixed seed (title from one basic, subtype from another) is user-owned.
    expect(
      isSeedableLandIdentity({
        title: "Forest",
        supertype: "Basic",
        subtypes_text: "Island",
      }),
    ).toBe(false);
    expect(
      isSeedableLandIdentity({
        title: "Forest",
        supertype: "",
        subtypes_text: "Forest",
      }),
    ).toBe(false);
  });
});

describe("normalizeColorSelection", () => {
  it("collapses 2+ real colors to multicolor, passes singles through", () => {
    expect(normalizeColorSelection(["white", "blue"])).toEqual(["multicolor"]);
    expect(normalizeColorSelection(["red"])).toEqual(["red"]);
    expect(normalizeColorSelection(["multicolor"])).toEqual(["multicolor"]);
    expect(normalizeColorSelection(["colorless"])).toEqual(["colorless"]);
    expect(normalizeColorSelection([])).toEqual([]);
    // A real color beside colorless keeps the real color.
    expect(normalizeColorSelection(["colorless", "green"])).toEqual(["green"]);
    // Duplicates don't fake a multicolor.
    expect(normalizeColorSelection(["red", "red"])).toEqual(["red"]);
  });
});
