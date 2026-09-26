import { describe, expect, it } from "vitest";
import {
  BRAND_MARK_ON_ART,
  BRAND_MARK_PLACEMENT,
  ON_ART_OUTLINE,
  brandMarkLayout,
  footerInk,
  getFrameProfile,
  type TextSlot,
} from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The edge-to-edge / full-art profile fields (TODO 3.23 / 3.24) are OPT-IN:
// no profile sets one today, so every existing card bakes as before (proven
// on real bakes of production's public cards; see the PR). New templates
// (4.32 m15borderless, 4.39 m15fullartland / fullartland) opt in.
// ---------------------------------------------------------------------------

describe("opt-in profile fields", () => {
  it("are set by no profile today", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      expect(p.basicSymbol, template).toBeUndefined();
      expect(p.textless, template).toBeUndefined();
      expect(p.footerOnArt, template).toBeUndefined();
      expect(p.type.split, template).toBeUndefined();
      expect(brandMarkLayout(p).pill, template).toBeUndefined();
    }
  });
});

describe("footerInk on the art (TODO 3.8 / 3.23)", () => {
  const footer: TextSlot = {
    rect: { topPct: 93, leftPct: 6.5, widthPct: 87, heightPct: 3 },
    sizePct: 0.019,
    colorHex: "#f4eee2",
  };

  it("never draws a declared shadowCss without the opt-in (fullartland's never printed)", () => {
    const full = getFrameProfile("fullartland");
    expect(full.footer!.shadowCss).toBeTruthy();
    expect(footerInk(full.footer!, "w", full)).toEqual({ colorHex: full.footer!.colorHex, shadowCss: undefined });
    expect(footerInk({ ...footer, shadowCss: "1px 1px 0 #000" }, "w")).toEqual({ colorHex: "#f4eee2", shadowCss: undefined });
  });

  it("draws the footer's own shadow, or ON_ART_OUTLINE, on a profile that prints it on the art", () => {
    expect(footerInk(footer, "w", { footerOnArt: true })).toEqual({ colorHex: "#f4eee2", shadowCss: ON_ART_OUTLINE });
    expect(footerInk({ ...footer, shadowCss: "1px 1px 0 #000" }, "w", { footerOnArt: true }).shadowCss).toBe(
      "1px 1px 0 #000",
    );
    // A per-master ink entry still wins, shadow and all.
    const alpha = { ...footer, inkByColorKey: { u: { colorHex: "#b4c0c2", shadowCss: "0.035em 0.035em 0 #000" } } };
    expect(footerInk(alpha, "u", { footerOnArt: true })).toEqual({ colorHex: "#b4c0c2", shadowCss: "0.035em 0.035em 0 #000" });
    // ON_ART_OUTLINE is in em: the same outline at every render size.
    expect(ON_ART_OUTLINE).not.toMatch(/px/);
  });
});

describe("the brand mark on the art (TODO 3.23)", () => {
  it("keeps the default placement with no pill, and the on-art preset carries one", () => {
    expect(brandMarkLayout(getFrameProfile("m15"))).toEqual({ ...BRAND_MARK_PLACEMENT, scale: 1 });
    expect(brandMarkLayout({ ...getFrameProfile("fullartland"), brandMark: BRAND_MARK_ON_ART })).toEqual({
      ...BRAND_MARK_ON_ART,
      pill: true,
      scale: 1,
    });
  });
});
