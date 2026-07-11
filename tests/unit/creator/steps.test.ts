import { describe, expect, it } from "vitest";
import {
  LEGACY_STEP_ALIASES,
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
  const FIVE: string[] = ["card", "identity", "text", "seticon", "publish"];

  it("is the compact five-step flow for a plain creature", () => {
    expect(keys(base)).toEqual(FIVE);
  });

  it("is the same five steps regardless of card type (stats gate inside Text)", () => {
    expect(keys(ctx({ cardType: "instant" }))).toEqual(FIVE);
    expect(keys(ctx({ cardType: "planeswalker", template: "m15pw" }))).toEqual(
      FIVE,
    );
    expect(keys(ctx({ cardType: "battle", template: "battle" }))).toEqual(
      FIVE,
    );
    // Cost-less frames don't drop a step anymore — the pips block hides
    // itself inside Identity.
    expect(keys(ctx({ cardType: "token", template: "m15token" }))).toEqual(
      FIVE,
    );
  });

  it("keeps the flow stable across layout frames and back faces", () => {
    expect(keys(ctx({ template: "adventure" }))).toEqual(FIVE);
    expect(keys(ctx({ template: "flip" }))).toEqual(FIVE);
    expect(keys(ctx({ template: "split" }))).toEqual(FIVE);
    expect(keys(ctx({ hasBackFace: true }))).toEqual(FIVE);
    expect(keys(ctx({ template: "regular" }))).toEqual(FIVE);
  });

  it("maps every legacy step key to a live step", () => {
    for (const [legacy, target] of Object.entries(LEGACY_STEP_ALIASES)) {
      expect(legacy).not.toBe(target);
      expect(FIVE).toContain(target);
    }
  });
});

describe("stepLabel", () => {
  it("returns each step's static label", () => {
    const byKey = (k: string) =>
      stepLabel(visibleSteps(base).find((s) => s.key === k)!);
    expect(byKey("card")).toBe("Card");
    expect(byKey("identity")).toBe("Identity");
    expect(byKey("text")).toBe("Text & stats");
    expect(byKey("seticon")).toBe("Set icon");
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

  it("Vehicle/Spacecraft subtypes → P/T even on non-creatures", () => {
    // Vehicles print crewed stats, Spacecraft stationed stats — both are
    // artifacts, so P/T can't gate on card_type alone.
    expect(statVisibility("artifact", ["Vehicle"])).toEqual({
      pt: true,
      loyalty: false,
      defense: false,
    });
    expect(statVisibility("artifact", ["Spacecraft"]).pt).toBe(true);
    // Case-insensitive: hand-typed subtypes behave like imported ones.
    expect(statVisibility("artifact", ["vehicle"]).pt).toBe(true);
    // Other subtypes don't unlock P/T.
    expect(statVisibility("artifact", ["Equipment"]).pt).toBe(false);
    expect(statVisibility("artifact").pt).toBe(false);
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
    // Cost + art fold into Identity now.
    expect(map.get("cost")).toBe("identity");
    expect(map.get("art_url")).toBe("identity");
    expect(map.get("back_face")).toBe("identity");
    expect(map.get("color_identity")).toBe("card");
    expect(map.get("frame_style")).toBe("card");
    expect(map.get("rules_text")).toBe("text");
    // Stats fold into the Text step.
    expect(map.get("power")).toBe("text");
    // The direct set-symbol fields live on the Set icon step.
    expect(map.get("set_icon_url")).toBe("seticon");
    expect(map.get("set_icon_code")).toBe("seticon");
    expect(map.get("visibility")).toBe("publish");
    expect(map.get("tags_text")).toBe("publish");
  });

  it("routes card type to the Card step (its single writer)", () => {
    const map = buildFieldToStep();
    expect(map.get("card_type")).toBe("card");
  });

  it("routes a nested back_face.* error to the Identity step", () => {
    const steps = visibleSteps(base);
    const idx = stepIndexForField("back_face.title", steps);
    expect(steps[idx].key).toBe("identity");
  });

  it("falls back to the last panel for a field no panel owns", () => {
    // primary_set_id isn't listed on any step, so it routes to the last panel.
    const steps = visibleSteps(base);
    const idx = stepIndexForField("primary_set_id", steps);
    expect(steps[idx].key).toBe("publish");
  });

  it("routes a known front-face field to its panel", () => {
    const steps = visibleSteps(base);
    expect(steps[stepIndexForField("title", steps)].key).toBe("identity");
  });
});
