import { describe, expect, it } from "vitest";
import {
  eraForTemplate,
  erasAvailableForType,
  eraSupportsType,
  resolveFrameTemplate,
  standardFrameFor,
} from "@/lib/creator/frame-picker";
import {
  FRAME_TEMPLATE_VALUES,
  FRAME_ERA_VALUES,
  type CardType,
} from "@/types/card";

describe("eraForTemplate", () => {
  it("maps every template to a valid era (round-trip, exhaustive)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const era = eraForTemplate(template);
      expect(FRAME_ERA_VALUES).toContain(era);
    }
  });

  it("groups the families correctly", () => {
    expect(eraForTemplate("agclassic")).toBe("classic");
    expect(eraForTemplate("alphaland")).toBe("classic");
    expect(eraForTemplate("m15")).toBe("m15");
    expect(eraForTemplate("m15pw")).toBe("m15");
    expect(eraForTemplate("saga")).toBe("m15");
    expect(eraForTemplate("lotr")).toBe("showcase");
    expect(eraForTemplate("tarkirghostfire")).toBe("showcase");
  });
});

describe("standardFrameFor", () => {
  it("derives the type-specific M15 frame", () => {
    expect(standardFrameFor("m15", "creature")).toBe("m15");
    expect(standardFrameFor("m15", "land")).toBe("m15land");
    expect(standardFrameFor("m15", "token")).toBe("m15token");
    expect(standardFrameFor("m15", "planeswalker")).toBe("m15pw");
    expect(standardFrameFor("m15", "battle")).toBe("battle");
    expect(standardFrameFor("m15", "instant")).toBe("m15");
  });

  it("derives the type-specific Classic frame and gaps the missing types", () => {
    expect(standardFrameFor("classic", "creature")).toBe("agclassic");
    expect(standardFrameFor("classic", "land")).toBe("alphaland");
    expect(standardFrameFor("classic", "token")).toBe("alphatoken");
    // No planeswalker/battle in the 1993 border.
    expect(standardFrameFor("classic", "planeswalker")).toBeNull();
    expect(standardFrameFor("classic", "battle")).toBeNull();
  });

  it("treats empty/nullish type as creature, and showcase as null", () => {
    expect(standardFrameFor("m15", "")).toBe("m15");
    expect(standardFrameFor("m15", null)).toBe("m15");
    expect(standardFrameFor("showcase", "creature")).toBeNull();
  });
});

describe("resolveFrameTemplate", () => {
  it("honors an override that belongs to the era", () => {
    expect(resolveFrameTemplate("m15", "creature", "saga")).toBe("saga");
    expect(resolveFrameTemplate("m15", "enchantment", "adventure")).toBe(
      "adventure",
    );
  });

  it("ignores an override from a different era", () => {
    // agclassic is a classic-era template; it can't override inside m15.
    expect(resolveFrameTemplate("m15", "creature", "agclassic")).toBe("m15");
  });

  it("falls back to the type default with no override", () => {
    expect(resolveFrameTemplate("m15", "land")).toBe("m15land");
    expect(resolveFrameTemplate("classic", "planeswalker")).toBeNull();
  });
});

describe("erasAvailableForType / eraSupportsType", () => {
  it("offers every era for a creature", () => {
    expect(erasAvailableForType("creature")).toEqual([
      "classic",
      "m15",
      "showcase",
    ]);
  });

  it("drops Classic for planeswalkers and battles (no 1993 frame)", () => {
    expect(erasAvailableForType("planeswalker")).toEqual(["m15", "showcase"]);
    expect(erasAvailableForType("battle")).toEqual(["m15", "showcase"]);
    expect(eraSupportsType("classic", "planeswalker")).toBe(false);
    expect(eraSupportsType("m15", "planeswalker")).toBe(true);
    expect(eraSupportsType("showcase", "planeswalker")).toBe(true);
  });

  it("keeps Classic for lands and tokens", () => {
    expect(erasAvailableForType("land")).toContain("classic");
    expect(erasAvailableForType("token")).toContain("classic");
  });

  it("never returns an empty list for any card type", () => {
    const TYPES: CardType[] = [
      "creature",
      "instant",
      "sorcery",
      "artifact",
      "enchantment",
      "land",
      "planeswalker",
      "battle",
      "token",
      "spell",
    ];
    for (const t of TYPES) {
      expect(erasAvailableForType(t).length).toBeGreaterThan(0);
    }
  });
});
