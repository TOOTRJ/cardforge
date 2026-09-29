import { describe, expect, it } from "vitest";
import {
  BASIC_SYMBOL_CC_2022,
  BRAND_MARK_ON_ART,
  BRAND_MARK_PLACEMENT,
  ON_ART_OUTLINE,
  SET_SYMBOL_KEYLINE,
  brandMarkLayout,
  footerInk,
  textShadowCopies,
  getFrameProfile,
  type TextSlot,
} from "@/lib/cards/template-layout";
import { KEYRUNE_EM_PER_BOX } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";

// ---------------------------------------------------------------------------
// The edge-to-edge / full-art profile fields (TODO 3.23 / 3.24) are OPT-IN:
// only the full-art basics of 4.39 set one, so every other card bakes as
// before (proven on real bakes of production's public cards; see the PR).
// fullartland's re-source is its own v30 sweep; m15fullartland is new. The
// borderless M15 frame (4.32) needs none of those (its bottom bar carries the
// brand mark and the footer); it opts into the set symbol's white keyline on
// its dark type bar (setSymbolKeyline), which nothing else sets.
// ---------------------------------------------------------------------------

describe("opt-in profile fields", () => {
  const FULL_ART_BASICS = ["m15fullartland", "fullartland"];

  // 3.24's `textless` has one user: the full-art token's textless height
  // (TODO 4.48), which keeps its type line (`textlessTypeLine`).
  const TEXTLESS_TOKENS = ["m20token", "m20tokenartifact"];

  it("are set only by the full-art basics (and `textless` by the full-art token's textless height)", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      if (TEXTLESS_TOKENS.includes(template)) {
        expect(p.textless, template).toBe(true);
        expect(p.textlessTypeLine, template).toBe(true);
      } else {
        expect(p.textless, template).toBeUndefined();
        expect(p.textlessTypeLine, template).toBeUndefined();
      }
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
      // Card Conjurer's text boxes and sizes, measured against 17 prints
      // (print review 2026-09-26: name ink within 1 px of the print at its
      // width; type line within 2 px), and the set symbol at the print's
      // size. Literal numbers: a nudge must fail here, not pass silently.
      expect(p.title.rect).toEqual({ topPct: 5.4, leftPct: 8.54, widthPct: 80.46, heightPct: 4.6 });
      expect(p.title.sizePct).toBe(0.0533);
      expect(p.type.rect).toEqual({ topPct: 85.1, leftPct: 18.87, widthPct: 65.13, heightPct: 4.2 });
      expect(p.type.sizePct).toBe(0.0453);
      // Layout v32 (TODO 4.20): none of M15's text changes reach these
      // print-verified slots — no baseline dy, the old fit path — although
      // they spread M15's.
      for (const slot of [p.title, p.type]) {
        expect(slot.dy ?? 0).toBe(0);
        expect(slot.fit).toBeUndefined();
      }
      // Since layout v32 symbolSizePct is the symbol BOX — CC's 0.041 H, the
      // rect's height (86 px) — not a font size: the default mark and an
      // icon fill it (they drew at 97.5 px, past the rect), and a Keyrune
      // glyph keeps its print-checked 0.065 W font (box × KEYRUNE_EM_PER_BOX)
      // unless its ink would stand taller than the box
      // (lib/cards/set-symbol-size.ts).
      expect(p.symbolSizePct).toBe(0.0574);
      expect(p.symbolSizePct! * KEYRUNE_EM_PER_BOX).toBeCloseTo(0.065, 12);
      expect(p.symbolSizePct! * 1500).toBeCloseTo((s.heightPct / 100) * 2100, 1);
      expect(setSymbolSize(p, setSymbolSource(null, "m20")).sizePct).toBe(0.065);
      expect(setSymbolSize(p, setSymbolSource(null, null)).sizePct).toBe(0.0574);
    }
    // CC's 168 px disc box (62/1752 px on 1500 × 2100).
    expect(BASIC_SYMBOL_CC_2022.rect).toEqual({ topPct: 83.43, leftPct: 4.13, widthPct: 11.2, heightPct: 8.0 });
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

describe("the set symbol's keyline on a dark type bar (4.32, owner evidence 2026-09-26)", () => {
  const BORDERLESS = ["m15borderless", "m15borderlessartifact"];

  it("is set by the borderless M15 pair only — every other profile draws the glyph as before", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      if (BORDERLESS.includes(template)) expect(p.setSymbolKeyline, template).toBe(SET_SYMBOL_KEYLINE);
      else expect(p.setSymbolKeyline, template).toBeUndefined();
    }
  });

  it("is eight white zero-blur layers 0.05 em out, in em (the same at every render size)", () => {
    expect(SET_SYMBOL_KEYLINE).not.toMatch(/px/);
    const copies = textShadowCopies(SET_SYMBOL_KEYLINE, 40)!;
    expect(copies).toHaveLength(8);
    for (const c of copies) {
      expect(c.color).toBe("#ffffff");
      // On a 40 px glyph: 2 px out along the axes and the diagonals (±0.1 px).
      expect(Math.hypot(c.dx, c.dy)).toBeGreaterThan(1.9);
      expect(Math.hypot(c.dx, c.dy)).toBeLessThan(2.05);
    }
    // Every direction once: right, left, down, up and the four diagonals.
    const dirs = copies.map((c) => `${Math.sign(Math.round(c.dx))},${Math.sign(Math.round(c.dy))}`).sort();
    expect(dirs).toEqual(["-1,-1", "-1,0", "-1,1", "0,-1", "0,1", "1,-1", "1,0", "1,1"]);
  });
});

describe("textShadowCopies — the bake's multi-layer outline (new-frames review 2026-09-26)", () => {
  it("turns ON_ART_OUTLINE into four black copies, in px at the font size", () => {
    expect(textShadowCopies(ON_ART_OUTLINE, 29)).toEqual([
      { dx: 0.06 * 29, dy: 0.06 * 29, color: "#000" },
      { dx: -0.06 * 29, dy: 0.06 * 29, color: "#000" },
      { dx: 0.06 * 29, dy: -0.06 * 29, color: "#000" },
      { dx: -0.06 * 29, dy: -0.06 * 29, color: "#000" },
    ]);
    // px layers and colour functions with commas inside them.
    expect(
      textShadowCopies("1px 1px 0 #000, -1px -1px rgba(0, 0, 0, 0.5)", 20),
    ).toEqual([
      { dx: 1, dy: 1, color: "#000" },
      { dx: -1, dy: -1, color: "rgba(0, 0, 0, 0.5)" },
    ]);
  });

  it("leaves a single layer or a blurred one to CSS (they rasterise correctly)", () => {
    expect(textShadowCopies("0.035em 0.035em 0 rgba(0,0,0,0.75)", 20)).toBeNull();
    expect(textShadowCopies("0 1px 3px rgba(0,0,0,0.8), 1px 1px 0 #000", 20)).toBeNull();
    expect(textShadowCopies("1px 1px 0 #000, 2px", 20)).toBeNull();
    expect(textShadowCopies("1px 1px 0 #000, 2 2 0 #000", 20)).toBeNull();
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
