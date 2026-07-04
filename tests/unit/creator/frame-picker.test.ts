import { describe, expect, it } from "vitest";
import {
  eraForTemplate,
  standardFrameFor,
} from "@/lib/creator/frame-picker";
import {
  FRAME_TEMPLATE_VALUES,
  FRAME_ERA_VALUES,
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
