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

  it("both renderers wire every field of brandMarkLayout to the same CSS property", () => {
    const bake = readFileSync("lib/render/card-image.tsx", "utf8");
    const preview = readFileSync("components/cards/card-preview.tsx", "utf8");
    for (const src of [bake, preview]) {
      expect(src).toContain("const markLayout = brandMarkLayout(layout);");
      expect(src).toContain("right: `${markLayout.rightPct}%`,");
      expect(src).toContain("bottom: `${markLayout.bottomPct}%`,");
      expect(src).not.toMatch(/bottom: "1\.8%"/);
    }
    // Size: font, star and gap all scale off the short side in both.
    expect(bake).toContain("fontSize: fpx(0.026 * markLayout.scale, width)");
    expect(bake).toContain("width={Math.round(fpx(0.03 * markLayout.scale, width))}");
    expect(bake).toContain("height={Math.round(fpx(0.03 * markLayout.scale, width))}");
    expect(bake).toContain("marginRight: Math.round(fpx(0.008 * markLayout.scale, width))");
    expect(preview).toContain("fontSize: cqw(0.026 * markLayout.scale)");
    expect(preview).toContain("width: cqw(0.03 * markLayout.scale)");
    expect(preview).toContain("height: cqw(0.03 * markLayout.scale)");
    expect(preview).toContain("marginRight: cqw(0.008 * markLayout.scale)");
    // The preview pins Satori's line box (Beleren hhea "normal").
    expect(preview).toContain('lineHeight: "normal"');
  });
});
