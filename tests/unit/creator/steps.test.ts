import { describe, expect, it } from "vitest";
import {
  buildFieldToStep,
  hidesCost,
  isAdventureFrame,
  statVisibility,
  stepIndexForField,
  stepLabel,
  visibleSteps,
  type StepContext,
} from "@/lib/creator/steps";

const base: StepContext = {
  template: "m15",
  cardType: "creature",
  hasBackFace: false,
};

const keys = (ctx: StepContext) => visibleSteps(ctx).map((s) => s.key);

describe("visibleSteps", () => {
  const SIX: string[] = ["frame", "identity", "pips", "art", "text", "publish"];

  it("is the fixed six-step flow for a plain creature", () => {
    expect(keys(base)).toEqual(SIX);
  });

  it("is the same six steps regardless of card type (stats gate inside Text)", () => {
    expect(keys({ ...base, cardType: "instant" })).toEqual(SIX);
    expect(keys({ ...base, cardType: "planeswalker" })).toEqual(SIX);
    expect(keys({ ...base, cardType: "battle" })).toEqual(SIX);
  });

  it("is the same six steps regardless of frame or back face (back face is in Art)", () => {
    expect(keys({ ...base, template: "adventure" })).toEqual(SIX);
    expect(keys({ ...base, template: "flip" })).toEqual(SIX);
    expect(keys({ ...base, template: "split" })).toEqual(SIX);
    expect(keys({ ...base, hasBackFace: true })).toEqual(SIX);
    expect(keys({ ...base, template: "regular" })).toEqual(SIX);
  });
});

describe("stepLabel", () => {
  it("returns each step's static label", () => {
    const byKey = (k: string) =>
      stepLabel(visibleSteps(base).find((s) => s.key === k)!);
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

describe("field → step routing", () => {
  it("maps each owned field to exactly one panel", () => {
    const map = buildFieldToStep();
    expect(map.get("title")).toBe("identity");
    expect(map.get("cost")).toBe("pips");
    expect(map.get("rules_text")).toBe("text");
    // Stats fold into the Text step now.
    expect(map.get("power")).toBe("text");
    expect(map.get("art_url")).toBe("art");
    expect(map.get("frame_style")).toBe("frame");
    expect(map.get("visibility")).toBe("publish");
    expect(map.get("tags_text")).toBe("publish");
    // Back face folds into the Art step now.
    expect(map.get("back_face")).toBe("art");
  });

  it("routes card type to identity and color identity to pips", () => {
    const map = buildFieldToStep();
    expect(map.get("card_type")).toBe("identity");
    expect(map.get("color_identity")).toBe("pips");
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

  it("routes a known front-face field to its panel", () => {
    const steps = visibleSteps(base);
    expect(steps[stepIndexForField("title", steps)].key).toBe("identity");
  });
});
