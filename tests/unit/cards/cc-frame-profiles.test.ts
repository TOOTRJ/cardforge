import { describe, expect, it } from "vitest";
import manifest from "@/lib/frames/frame-manifest.json";
import { getFrameProfile, underFrameArtRect } from "@/lib/cards/template-layout";
import { COLORS, OUT_H, OUT_W, SHIELD_BOX } from "@/scripts/lib/cc-frames.mjs";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// Geometry that belongs to the Card Conjurer frames (swap 4.4) and must stay
// on exactly the templates that draw them. Owner review 2026-09-25: the CC
// title bar left the pips low (lifted via costDy) and our ability stripes
// washed out the shield CC paints (redrawn from the importer's cut-out).
// ---------------------------------------------------------------------------

const ccTemplates = new Set(Object.keys(manifest.files).map((key) => key.split("/")[0]));

describe("Card Conjurer frame profiles", () => {
  it("lifts the inline mana cost ~0.55 % of the card height on every CC frame that shows one", () => {
    for (const template of ccTemplates) {
      const profile = getFrameProfile(template);
      if (profile.hideCost || profile.costRect) continue;
      expect(profile.costDy, template).toBeCloseTo(-0.0077, 6);
      // costDy is a fraction of the WIDTH; the card is 5:7.
      expect((-(profile.costDy ?? 0) / 1.4) * 100, template).toBeCloseTo(0.55, 2);
    }
    expect([...ccTemplates].filter((t) => getFrameProfile(t).costDy)).toEqual(
      expect.arrayContaining(["m15", "m15artifact", "m15snow", "m15devoid"]),
    );
  });

  it("drops the planeswalker's detached cost to 48 % of CC's taller title plate, right end unchanged", () => {
    // Owner review, round 3: "pips look a little high". CC's pw title plate
    // spans 77–192 px at HD (1500 × 2100); eight printed M15 planeswalkers
    // centre their pips 47.3–48.8 % of the way down theirs. The box stays
    // where the compare tool tuned it; costDy (a fraction of the WIDTH)
    // moves the pips 6 px down, from 126 px to 132 px.
    const pw = getFrameProfile("m15pw");
    expect(pw.costRect).toEqual({ topPct: 3.8, leftPct: 51.2, widthPct: 40, heightPct: 4.4 });
    expect(pw.costDy).toBe(0.004);
    const centrePx = ((pw.costRect!.topPct + pw.costRect!.heightPct / 2) / 100) * 2100 + pw.costDy! * 1500;
    expect(centrePx).toBeCloseTo(132, 6);
    expect((centrePx - 77) / (192 - 77)).toBeCloseTo(0.48, 2);
    // The name does not move with it.
    expect(pw.title.rect.topPct).toBe(3.8);
  });

  it("leaves the MSE-framed templates' cost where it was", () => {
    // The re-cut Alpha masters carry their own, smaller lift — measured on
    // printed LEA/LEB pips (~138 px), not the CC title bar's.
    const OWN_LIFT: Record<string, number> = { agclassic: -0.004, alphaland: -0.004 };
    for (const template of FRAME_TEMPLATE_VALUES) {
      if (ccTemplates.has(template)) continue;
      expect(getFrameProfile(template).costDy, template).toBe(OWN_LIFT[template]);
    }
  });

  it("gives legacy and unknown templates the m15 frame's profile", () => {
    expect(getFrameProfile(undefined)).toBe(getFrameProfile("m15"));
    expect(getFrameProfile("regular")).toBe(getFrameProfile("m15"));
    expect(underFrameArtRect(getFrameProfile("regular"), "c")).not.toBeNull();
    expect(underFrameArtRect(getFrameProfile("m15"), "w")).toBeNull();
  });

  it("redraws the planeswalker shield from the importer's cut-out, exactly over the frame's own", () => {
    const loyalty = getFrameProfile("m15pw").loyalty!;
    expect(loyalty.plateAssetPathTemplate).toBe("/frames/m15pw/loyalty/{color}.png");
    const box = loyalty.plateRect!;
    // Within a tenth of a pixel on the 1500×2100 master.
    expect((box.leftPct / 100) * OUT_W).toBeCloseTo(SHIELD_BOX.x, 1);
    expect((box.topPct / 100) * OUT_H).toBeCloseTo(SHIELD_BOX.y, 0);
    expect((box.widthPct / 100) * OUT_W).toBeCloseTo(SHIELD_BOX.width, 1);
    expect((box.heightPct / 100) * OUT_H).toBeCloseTo(SHIELD_BOX.height, 0);
    for (const colour of COLORS) {
      expect(manifest.files, colour).toHaveProperty([`m15pw/loyalty/${colour}.png`]);
    }
  });
});
