import { describe, expect, it } from "vitest";
import {
  buildFieldToStep,
  hidesCost,
  isAdventureFrame,
  panelConfigFor,
  statVisibility,
  stepIndexForField,
  stepLabel,
  visibleSteps,
  type StepContext,
} from "@/lib/creator/steps";
import { kindFromCard } from "@/lib/creator/card-kinds";
import type { CardType, FrameTemplate } from "@/types/card";

function ctx(
  overrides: Partial<Omit<StepContext, "kind">> = {},
): StepContext {
  const cardType = (overrides.cardType ?? "creature") as CardType | "";
  const template = overrides.template ?? "m15";
  return {
    template,
    cardType,
    hasBackFace: overrides.hasBackFace ?? false,
    kind: kindFromCard(cardType, template as FrameTemplate | string),
  };
}

const base = ctx();

const keys = (c: StepContext) => visibleSteps(c).map((s) => s.key);

describe("visibleSteps", () => {
  const SEVEN: string[] = [
    "kind",
    "frame",
    "identity",
    "pips",
    "art",
    "text",
    "publish",
  ];

  it("is the kind-first seven-step flow for a plain creature", () => {
    expect(keys(base)).toEqual(SEVEN);
  });

  it("is the same seven steps regardless of card type (stats gate inside Text)", () => {
    expect(keys(ctx({ cardType: "instant" }))).toEqual(SEVEN);
    expect(keys(ctx({ cardType: "planeswalker", template: "m15pw" }))).toEqual(
      SEVEN,
    );
    expect(keys(ctx({ cardType: "battle", template: "battle" }))).toEqual(
      SEVEN,
    );
  });

  it("keeps the flow stable across layout frames and back faces", () => {
    expect(keys(ctx({ template: "adventure" }))).toEqual(SEVEN);
    expect(keys(ctx({ template: "flip" }))).toEqual(SEVEN);
    expect(keys(ctx({ template: "split" }))).toEqual(SEVEN);
    expect(keys(ctx({ hasBackFace: true }))).toEqual(SEVEN);
    expect(keys(ctx({ template: "regular" }))).toEqual(SEVEN);
  });

  it("hides the Pips step for frames that paint no cost (tokens, lands)", () => {
    expect(keys(ctx({ cardType: "token", template: "m15token" }))).not.toContain(
      "pips",
    );
    expect(keys(ctx({ cardType: "land", template: "m15land" }))).not.toContain(
      "pips",
    );
    expect(keys(ctx({ template: "m15" }))).toContain("pips");
  });
});

describe("stepLabel", () => {
  it("returns each step's static label", () => {
    const byKey = (k: string) =>
      stepLabel(visibleSteps(base).find((s) => s.key === k)!);
    expect(byKey("kind")).toBe("Card kind");
    expect(byKey("art")).toBe("Art");
    expect(byKey("text")).toBe("Text & stats");
    expect(byKey("publish")).toBe("Publish");
  });
});

describe("isAdventureFrame", () => {
  it("is true only for the adventure frame", () => {
    expect(isAdventureFrame("adventure")).toBe(true);
    expect(isAdventureFrame("m15")).toBe(false);
    expect(isAdventureFrame(undefined)).toBe(false);
  });
});

describe("hidesCost", () => {
  it("hides the cost on token frames, shows it on standard frames", () => {
    expect(hidesCost("m15token")).toBe(true);
    expect(hidesCost("alphatoken")).toBe(true);
    expect(hidesCost("m15")).toBe(false);
  });
});

describe("statVisibility", () => {
  it("creature/token → P/T only", () => {
    expect(statVisibility("creature")).toEqual({
      pt: true,
      loyalty: false,
      defense: false,
    });
    expect(statVisibility("token").pt).toBe(true);
  });

  it("planeswalker → loyalty only", () => {
    expect(statVisibility("planeswalker")).toEqual({
      pt: false,
      loyalty: true,
      defense: false,
    });
  });

  it("battle → defense only", () => {
    expect(statVisibility("battle")).toEqual({
      pt: false,
      loyalty: false,
      defense: true,
    });
  });

  it("instant/sorcery/empty → no stats", () => {
    expect(statVisibility("instant")).toEqual({
      pt: false,
      loyalty: false,
      defense: false,
    });
    expect(statVisibility("")).toEqual({
      pt: false,
      loyalty: false,
      defense: false,
    });
  });
});

describe("panelConfigFor", () => {
  it("split/aftermath get two art slots; everything else gets one", () => {
    expect(panelConfigFor(ctx({ template: "split" })).artSlots).toEqual([
      "front",
      "second",
    ]);
    expect(panelConfigFor(ctx({ template: "aftermath" })).artSlots).toEqual([
      "front",
      "second",
    ]);
    expect(panelConfigFor(ctx({ template: "flip" })).artSlots).toEqual([
      "front",
    ]);
    expect(panelConfigFor(base).artSlots).toEqual(["front"]);
  });

  it("maps kinds to their text-editor variants", () => {
    expect(
      panelConfigFor(ctx({ cardType: "planeswalker", template: "m15pw" }))
        .textVariant,
    ).toBe("loyalty");
    expect(
      panelConfigFor(ctx({ cardType: "enchantment", template: "saga" }))
        .textVariant,
    ).toBe("saga");
    expect(panelConfigFor(ctx({ template: "adventure" })).textVariant).toBe(
      "adventure",
    );
    expect(panelConfigFor(ctx({ template: "aftermath" })).textVariant).toBe(
      "split",
    );
    expect(panelConfigFor(base).textVariant).toBe("standard");
  });

  it("forces the back face exactly for inline-second-face kinds", () => {
    for (const template of ["adventure", "split", "aftermath", "flip"]) {
      expect(panelConfigFor(ctx({ template })).forcedBackFace).toBe(true);
    }
    expect(panelConfigFor(ctx({ template: "saga" })).forcedBackFace).toBe(
      false,
    );
    expect(panelConfigFor(base).forcedBackFace).toBe(false);
  });
});

describe("field → step routing", () => {
  it("maps each owned field to exactly one panel", () => {
    const map = buildFieldToStep();
    expect(map.get("title")).toBe("identity");
    expect(map.get("cost")).toBe("pips");
    // Color lives on the Frame step (inline, under the gallery).
    expect(map.get("color_identity")).toBe("frame");
    expect(map.get("rules_text")).toBe("text");
    // Stats fold into the Text step.
    expect(map.get("power")).toBe("text");
    expect(map.get("art_url")).toBe("art");
    expect(map.get("frame_style")).toBe("frame");
    expect(map.get("visibility")).toBe("publish");
    expect(map.get("tags_text")).toBe("publish");
    // Back face folds into the Art step.
    expect(map.get("back_face")).toBe("art");
  });

  it("routes card type to the Kind step (its single writer)", () => {
    const map = buildFieldToStep();
    expect(map.get("card_type")).toBe("kind");
    expect(map.get("color_identity")).toBe("frame");
  });

  it("routes a nested back_face.* error to the Art panel", () => {
    const steps = visibleSteps(base);
    const idx = stepIndexForField("back_face.title", steps);
    expect(steps[idx].key).toBe("art");
  });

  it("falls back to the last panel for a field no panel owns", () => {
    // primary_set_id isn't listed on any step, so it routes to the last panel.
    const steps = visibleSteps(base);
    const idx = stepIndexForField("primary_set_id", steps);
    expect(steps[idx].key).toBe("publish");
  });

  it("routes a cost error to the last panel when Pips is hidden (token frame)", () => {
    const steps = visibleSteps(ctx({ cardType: "token", template: "m15token" }));
    const idx = stepIndexForField("cost", steps);
    expect(steps[idx].key).toBe("publish");
  });

  it("routes a known front-face field to its panel", () => {
    const steps = visibleSteps(base);
    expect(steps[stepIndexForField("title", steps)].key).toBe("identity");
  });
});
