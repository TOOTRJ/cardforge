import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BRAND_MARK_PLACEMENT,
  brandMarkLayout,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// Thin-border frames centre the pipglyph.com mark in their own black border
// (brand-mark survey 2026-09-25: the default 1.8% straddled the coloured
// frame edge on these). Everything else keeps the M15 default, so their
// stored bakes stay byte-identical.
const THIN_BORDER: Record<string, { rightPct: number; bottomPct: number }> = {
  agclassic: { rightPct: 3.5, bottomPct: 0.55 },
  alphaland: { rightPct: 3.5, bottomPct: 0.55 },
  alphatoken: { rightPct: 3.5, bottomPct: 0.55 },
  retro: { rightPct: 3.5, bottomPct: 0.95 },
  retroland: { rightPct: 3.5, bottomPct: 0.95 },
  modern: { rightPct: 3.5, bottomPct: 0.8 },
  modernland: { rightPct: 3.5, bottomPct: 0.8 },
  extendedart: { rightPct: 3.5, bottomPct: 0.8 },
  battle: { rightPct: 11, bottomPct: 0.8 },
  split: { rightPct: 3.5, bottomPct: 0.8 },
};

describe("brand-mark placement", () => {
  it.each([...FRAME_TEMPLATE_VALUES])("%s", (template) => {
    const layout = brandMarkLayout(getFrameProfile(template));
    const expected = THIN_BORDER[template] ?? BRAND_MARK_PLACEMENT;
    expect({ rightPct: layout.rightPct, bottomPct: layout.bottomPct }).toEqual(expected);
  });

  it("sizes the mark off the short side (landscape = 5/7 of the width)", () => {
    expect(brandMarkLayout(getFrameProfile("m15")).scale).toBe(1);
    expect(brandMarkLayout(getFrameProfile("battle")).scale).toBeCloseTo(5 / 7);
    expect(brandMarkLayout(getFrameProfile("split")).scale).toBeCloseTo(5 / 7);
  });

  it("both renderers place the mark through brandMarkLayout", () => {
    for (const file of ["lib/render/card-image.tsx", "components/cards/card-preview.tsx"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("brandMarkLayout(layout)");
      expect(src).not.toMatch(/bottom: "1\.8%"/);
    }
  });
});
