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
  // (agclassic and alphaland left this table with TODO 4.10c: their mark is
  // drawn through the © slot on the same black band, ending on the same
  // 3.5 % — tests/unit/cards/alpha-1993-profile.test.ts — and `brandMark`
  // is not read.)
  // (retro and retroland left this table with TODO 4.10a: their mark sits in
  // the centred footer's © slot — FrameProfile.copyrightSlot,
  // tests/unit/cards/copyright-slot.test.ts — and `brandMark` is not read.)
  // (modern and modernland left it with TODO 4.10b: their mark sits in the
  // left-aligned footer's © slot, under the artist's brush.)
  extendedart: { rightPct: 3.5, bottomPct: 0.8 },
  // The Card Conjurer landscape masters (TODO 4.21b, layout v43): the mark's
  // 38 px of ink centred in the battle's 54 px bottom border (its right end
  // short of the painted shield) and in the split's 57 px one. The MSE
  // battle had no border — 0.8 % sat the mark on the art's last rows.
  battle: { rightPct: 11, bottomPct: 0.47 },
  split: { rightPct: 3.5, bottomPct: 0.57 },
  // No border at all (4.39, borderless full-art basic): the mark sits on the
  // art, on its pill (BRAND_MARK_ON_ART, 3.23).
  fullartland: { rightPct: 3.5, bottomPct: 1.6 },
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
