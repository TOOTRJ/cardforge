import { describe, expect, it } from "vitest";
import {
  BASIC_SYMBOL_CC_2022,
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
// only the full-art basics of 4.39 set one, so every other card bakes as
// before (proven on real bakes of production's public cards; see the PR).
// fullartland's re-source is its own v30 sweep; m15fullartland is new. The
// borderless M15 frame (4.32) needs none: its bottom bar carries the brand
// mark and the footer.
// ---------------------------------------------------------------------------

describe("opt-in profile fields", () => {
  const FULL_ART_BASICS = ["m15fullartland", "fullartland"];

  it("are set only by the full-art basics", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      expect(p.textless, template).toBeUndefined();
      expect(p.type.split, template).toBeUndefined();
      if (FULL_ART_BASICS.includes(template)) continue;
      expect(p.basicSymbol, template).toBeUndefined();
      expect(p.footerOnArt, template).toBeUndefined();
      expect(brandMarkLayout(p).pill, template).toBeUndefined();
    }
  });

  it("put a full-art basic's symbol in Card Conjurer's disc; only the borderless one prints on the art", () => {
    for (const template of FULL_ART_BASICS) {
      const p = getFrameProfile(template);
      expect(p.basicSymbol, template).toEqual({
        ...BASIC_SYMBOL_CC_2022,
        assetPathTemplate: `/frames/${template}/symbol/{symbol}.png`,
      });
    }
    const bordered = getFrameProfile("m15fullartland");
    expect(bordered.footerOnArt).toBeUndefined();
    expect(brandMarkLayout(bordered)).toEqual({ ...BRAND_MARK_PLACEMENT, scale: 1 });
    const borderless = getFrameProfile("fullartland");
    expect(borderless.footerOnArt).toBe(true);
    expect(brandMarkLayout(borderless)).toEqual({ ...BRAND_MARK_ON_ART, scale: 1 });
    // Its footer declares no shadow of its own: the em outline prints.
    expect(footerInk(borderless.footer!, "w", borderless).shadowCss).toBe(ON_ART_OUTLINE);
  });

  it("place the full-art basics' art, bands and set symbol on Card Conjurer's bounds (4.39)", () => {
    const bordered = getFrameProfile("m15fullartland");
    const borderless = getFrameProfile("fullartland");
    // CC artBounds inside the black ring; edge to edge without it.
    expect(bordered.artSlot).toEqual({ topPct: 2.81, leftPct: 3.94, widthPct: 92.14, heightPct: 89.29 });
    expect(borderless.artSlot).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: 100 });
    for (const p of [bordered, borderless]) {
      expect(p.hideCost).toBe(true);
      // The set symbol right-anchored at 92.13 %W, centred on 87.39 %H.
      const s = p.symbolRect!;
      expect(s.leftPct + s.widthPct).toBeCloseTo(92.13, 6);
      expect(s.topPct + s.heightPct / 2).toBeCloseTo(87.39, 6);
      // Title and type centred within 0.5 % H of CC's bands (y 5.22 / 84.81,
      // 5.43 % tall), the type line starting past the disc.
      const centre = (r: { topPct: number; heightPct: number }) => r.topPct + r.heightPct / 2;
      expect(Math.abs(centre(p.title.rect) - (5.22 + 5.43 / 2))).toBeLessThan(0.5);
      expect(Math.abs(centre(p.type.rect) - (84.81 + 5.43 / 2))).toBeLessThan(0.5);
      expect(p.type.rect.leftPct).toBeGreaterThan(BASIC_SYMBOL_CC_2022.rect.leftPct + BASIC_SYMBOL_CC_2022.rect.widthPct);
      expect(p.type.rect.leftPct + p.type.rect.widthPct).toBeLessThanOrEqual(s.leftPct + s.widthPct);
    }
  });

  it("put the borderless M15 frame on Card Conjurer's bounds (4.32)", () => {
    const m15 = getFrameProfile("m15");
    for (const template of ["m15borderless", "m15borderlessartifact"] as const) {
      const p = getFrameProfile(template);
      expect(p.artSlot, template).toEqual({ topPct: 0, leftPct: 0, widthPct: 100, heightPct: 92.24 });
      // M15's measured text slots, in white.
      for (const slot of ["title", "type", "rules"] as const) {
        expect(p[slot].rect, `${template} ${slot}`).toEqual(m15[slot].rect);
        expect(p[slot].colorHex, `${template} ${slot}`).toBe("#ffffff");
      }
      expect(p.costDy).toBe(m15.costDy);
      // The pack's 274 × 140 plate at its own box (native 1.96 aspect); the
      // digits in M15's box, white.
      expect(p.pt!.plateRect).toEqual({ topPct: 88.62, leftPct: 76.4, widthPct: 18.27, heightPct: 6.67 });
      expect(p.pt!.rect).toEqual(m15.pt!.rect);
      expect(p.pt!.colorHex).toBe("#ffffff");
      expect(p.pt!.plateAssetPathTemplate).toBe(`/frames/${template}/pt/{color}.png`);
      // No see-through art under the frame: the art already reaches it.
      expect(p.underFrameArt, template).toBeUndefined();
      // The brand mark keeps its place in the bottom bar.
      expect(brandMarkLayout(p)).toEqual({ ...BRAND_MARK_PLACEMENT, scale: 1 });
    }
  });
});

describe("footerInk on the art (TODO 3.8 / 3.23)", () => {
  const footer: TextSlot = {
    rect: { topPct: 93, leftPct: 6.5, widthPct: 87, heightPct: 3 },
    sizePct: 0.019,
    colorHex: "#f4eee2",
  };

  it("never draws a declared shadowCss without the opt-in", () => {
    const m15 = getFrameProfile("m15");
    expect(footerInk({ ...footer, shadowCss: "1px 1px 0 #000" }, "w", m15)).toEqual({
      colorHex: "#f4eee2",
      shadowCss: undefined,
    });
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
