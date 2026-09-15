import { describe, expect, it } from "vitest";
import {
  CARD_LAYOUT_VERSION,
  isRenderStale,
  templateOfFrameStyle,
} from "@/lib/cards/layout-version";

describe("isRenderStale — which stored renders a version bump invalidates", () => {
  it("treats unversioned or override-cleared renders as stale", () => {
    expect(isRenderStale(null, "m15")).toBe(true);
    expect(isRenderStale(undefined, "m15")).toBe(true);
  });

  it("treats the current (or a newer) version as current", () => {
    expect(isRenderStale(CARD_LAYOUT_VERSION, "m15")).toBe(false);
    expect(isRenderStale(CARD_LAYOUT_VERSION + 1, "m15")).toBe(false);
  });

  it("with no scoped bumps, every older version is stale", () => {
    expect(isRenderStale(CARD_LAYOUT_VERSION - 1, "m15", {})).toBe(true);
    expect(isRenderStale(1, "battle", {})).toBe(true);
  });

  it("a template-scoped bump leaves other templates current", () => {
    const scoped = { 20: ["m15", "m15land"], 21: ["battle"] };
    // Baked at 19, current 21: bumps 20 (m15 family) and 21 (battle).
    expect(isRenderStale(19, "m15", scoped, 21)).toBe(true);
    expect(isRenderStale(19, "battle", scoped, 21)).toBe(true);
    expect(isRenderStale(19, "saga", scoped, 21)).toBe(false);
    // Baked at 20: only bump 21 applies.
    expect(isRenderStale(20, "m15", scoped, 21)).toBe(false);
    expect(isRenderStale(20, "battle", scoped, 21)).toBe(true);
    // An unknown template is treated as touched.
    expect(isRenderStale(19, null, scoped, 21)).toBe(true);
    // One unscoped bump in the range touches everything.
    expect(isRenderStale(19, "saga", { 20: ["m15"] }, 21)).toBe(true);
  });

  it("reads the template out of the frame_style jsonb", () => {
    expect(templateOfFrameStyle({ template: "m15", finish: "foil" })).toBe("m15");
    expect(templateOfFrameStyle({})).toBeNull();
    expect(templateOfFrameStyle(null)).toBeNull();
    expect(templateOfFrameStyle("m15")).toBeNull();
  });
});
