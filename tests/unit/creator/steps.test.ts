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
  it("a plain creature has no layout panel (abilities visible)", () => {
    expect(keys(base)).toEqual([
      "frame",
      "identity",
      "pips",
      "art",
      "text",
      "abilities",
      "effects",
      "publish",
    ]);
  });

  it("a stat-less type (instant) hides the abilities panel", () => {
    expect(keys({ ...base, cardType: "instant" })).toEqual([
      "frame",
      "identity",
      "pips",
      "art",
      "text",
      "effects",
      "publish",
    ]);
  });

  it("a planeswalker shows the abilities panel (loyalty)", () => {
    expect(keys({ ...base, cardType: "planeswalker" })).toContain("abilities");
  });

  it("the Adventure frame always adds the layout panel", () => {
    expect(keys({ ...base, template: "adventure" })).toEqual([
      "frame",
      "identity",
      "pips",
      "art",
      "text",
      "abilities",
      "layout",
      "effects",
      "publish",
    ]);
  });

  it("enabling a back face adds the layout panel on any frame", () => {
    expect(keys({ ...base, hasBackFace: true })).toContain("layout");
  });

  it("the Flip frame always adds the layout panel (intrinsic second face)", () => {
    expect(keys({ ...base, template: "flip" })).toContain("layout");
  });

  it("the Split frame always adds the layout panel (right half)", () => {
    expect(keys({ ...base, template: "split" })).toContain("layout");
  });

  it("the Aftermath frame always adds the layout panel (bottom half)", () => {
    expect(keys({ ...base, template: "aftermath" })).toContain("layout");
  });

  it("an unknown/legacy template still yields the base panels (no crash)", () => {
    expect(keys({ ...base, template: "regular" })).toEqual([
      "frame",
      "identity",
      "pips",
      "art",
      "text",
      "abilities",
      "effects",
      "publish",
    ]);
  });
});

describe("stepLabel", () => {
  const layout = visibleSteps({ ...base, hasBackFace: true }).find(
    (s) => s.key === "layout",
  )!;

  it("labels the layout panel 'Adventure' on the Adventure frame", () => {
    expect(stepLabel(layout, { ...base, template: "adventure" })).toBe(
      "Adventure",
    );
  });

  it("labels the layout panel 'Back face' on a normal DFC", () => {
    expect(stepLabel(layout, { ...base, hasBackFace: true })).toBe("Back face");
  });

  it("labels the layout panel 'Flip side' on the Flip frame", () => {
    expect(stepLabel(layout, { ...base, template: "flip" })).toBe("Flip side");
  });

  it("labels the layout panel 'Other half' on the Split frame", () => {
    expect(stepLabel(layout, { ...base, template: "split" })).toBe(
      "Other half",
    );
  });

  it("labels the layout panel 'Aftermath' on the Aftermath frame", () => {
    expect(stepLabel(layout, { ...base, template: "aftermath" })).toBe(
      "Aftermath",
    );
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
    expect(map.get("power")).toBe("abilities");
    expect(map.get("art_url")).toBe("art");
    expect(map.get("frame_style")).toBe("frame");
    expect(map.get("visibility")).toBe("publish");
    expect(map.get("tags_text")).toBe("publish");
    expect(map.get("back_face")).toBe("layout");
  });

  it("routes card type to identity and color identity to pips", () => {
    const map = buildFieldToStep();
    expect(map.get("card_type")).toBe("identity");
    expect(map.get("color_identity")).toBe("pips");
  });

  it("routes a nested back_face.* error to the layout panel when visible", () => {
    const steps = visibleSteps({ ...base, hasBackFace: true });
    const idx = stepIndexForField("back_face.title", steps);
    expect(steps[idx].key).toBe("layout");
  });

  it("falls back to the last panel when the target panel is hidden", () => {
    const steps = visibleSteps(base); // no layout panel
    const idx = stepIndexForField("back_face.title", steps);
    expect(steps[idx].key).toBe("publish");
  });

  it("routes a known front-face field to its panel", () => {
    const steps = visibleSteps(base);
    expect(steps[stepIndexForField("title", steps)].key).toBe("identity");
  });
});
