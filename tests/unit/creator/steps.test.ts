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
  it("a plain creature has no extra step", () => {
    expect(keys(base)).toEqual(["frame", "details", "art", "rules", "publish"]);
  });

  it("the Adventure frame always adds the extra step", () => {
    expect(keys({ ...base, template: "adventure" })).toEqual([
      "frame",
      "details",
      "art",
      "rules",
      "extra",
      "publish",
    ]);
  });

  it("enabling a back face adds the extra step on any frame", () => {
    expect(keys({ ...base, hasBackFace: true })).toContain("extra");
  });

  it("the Flip frame always adds the extra step (intrinsic second face)", () => {
    expect(keys({ ...base, template: "flip" })).toContain("extra");
  });

  it("an unknown/legacy template still yields the base steps (no crash)", () => {
    expect(keys({ ...base, template: "regular" })).toEqual([
      "frame",
      "details",
      "art",
      "rules",
      "publish",
    ]);
  });
});

describe("stepLabel", () => {
  const extra = visibleSteps({ ...base, hasBackFace: true }).find(
    (s) => s.key === "extra",
  )!;

  it("labels the extra step 'Adventure' on the Adventure frame", () => {
    expect(stepLabel(extra, { ...base, template: "adventure" })).toBe(
      "Adventure",
    );
  });

  it("labels the extra step 'Back face' on a normal DFC", () => {
    expect(stepLabel(extra, { ...base, hasBackFace: true })).toBe("Back face");
  });

  it("labels the extra step 'Flip side' on the Flip frame", () => {
    expect(stepLabel(extra, { ...base, template: "flip" })).toBe("Flip side");
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
  it("maps each owned field to exactly one step", () => {
    const map = buildFieldToStep();
    expect(map.get("title")).toBe("details");
    expect(map.get("rules_text")).toBe("rules");
    expect(map.get("art_url")).toBe("art");
    expect(map.get("frame_style")).toBe("frame");
    expect(map.get("visibility")).toBe("publish");
    expect(map.get("back_face")).toBe("extra");
  });

  it("routes a nested back_face.* error to the extra step when visible", () => {
    const steps = visibleSteps({ ...base, hasBackFace: true });
    const idx = stepIndexForField("back_face.title", steps);
    expect(steps[idx].key).toBe("extra");
  });

  it("falls back to the last step when the target step is hidden", () => {
    const steps = visibleSteps(base); // no extra step
    const idx = stepIndexForField("back_face.title", steps);
    expect(steps[idx].key).toBe("publish");
  });

  it("routes a known front-face field to its step", () => {
    const steps = visibleSteps(base);
    expect(steps[stepIndexForField("title", steps)].key).toBe("details");
  });
});
