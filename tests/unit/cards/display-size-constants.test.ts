import { describe, expect, it } from "vitest";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  ADVENTURE_PANEL_COST_PCT,
  ADVENTURE_PANEL_PCT,
  COST_DISC_PCT,
  KEYRUNE_EM_PER_BOX,
  SET_SYMBOL_BOX_PCT,
  TITLE_SIZE_PCT,
  TYPE_SIZE_PCT,
  displayPct,
  ptToPct,
} from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The M15-era display sizes (TODO 4.20, layout v32) — Card Conjurer's, which
// match the prints. CC states them as fractions of the card's HEIGHT; ours
// are fractions of a portrait card's WIDTH (× 7/5).
// ---------------------------------------------------------------------------

const HD = 1500;
const ofHeight = (pctOfHeight: number) => pctOfHeight * 1.4;

describe("M15-era display sizes", () => {
  it("are Card Conjurer's, in px at HD", () => {
    expect(TITLE_SIZE_PCT).toBeCloseTo(ofHeight(0.0381), 3);
    expect(TYPE_SIZE_PCT).toBeCloseTo(ofHeight(0.0324), 3);
    expect(SET_SYMBOL_BOX_PCT).toBeCloseTo(ofHeight(0.041), 3);
    expect(ADVENTURE_PANEL_PCT).toBeCloseTo(ofHeight(0.0296), 3);
    expect(Math.round(TITLE_SIZE_PCT * HD)).toBe(80);
    expect(Math.round(TYPE_SIZE_PCT * HD)).toBe(68);
    expect(Math.round(SET_SYMBOL_BOX_PCT * HD)).toBe(86);
    expect(Math.round(ADVENTURE_PANEL_PCT * HD)).toBe(62);
    expect(Math.round(ADVENTURE_PANEL_COST_PCT * HD)).toBe(60);
    expect(COST_DISC_PCT * HD).toBeCloseTo(72.75, 6);
  });

  it("name the values the verified profiles already print", () => {
    // M15's measured pip disc…
    expect(getFrameProfile("m15").costSizePct).toBe(COST_DISC_PCT);
    // …and the full-art basics' print-checked name and type line (4.39).
    for (const t of ["m15fullartland", "fullartland"]) {
      expect(getFrameProfile(t).title.sizePct, t).toBe(TITLE_SIZE_PCT);
      expect(getFrameProfile(t).type.sizePct, t).toBe(TYPE_SIZE_PCT);
    }
  });

  it("derive a Keyrune glyph's font from the set-symbol box: 0.065 W on M15", () => {
    expect(SET_SYMBOL_BOX_PCT * KEYRUNE_EM_PER_BOX).toBeCloseTo(0.065, 12);
    expect(KEYRUNE_EM_PER_BOX).toBeCloseTo(1.1324, 4);
  });
});

describe("displayPct", () => {
  it("is the identity on a portrait card", () => {
    expect(displayPct(TITLE_SIZE_PCT)).toBe(TITLE_SIZE_PCT);
    expect(displayPct(TYPE_SIZE_PCT, "portrait")).toBe(TYPE_SIZE_PCT);
  });

  it("keeps the absolute size on a landscape card (× 5/7 of its wider width)", () => {
    expect(displayPct(TITLE_SIZE_PCT, "landscape")).toBeCloseTo((TITLE_SIZE_PCT * 5) / 7, 12);
    // 80 px on a 1500-wide portrait card = 80 px on a 2100-wide landscape one.
    expect(displayPct(TITLE_SIZE_PCT, "landscape") * 2100).toBeCloseTo(TITLE_SIZE_PCT * HD, 9);
    expect(displayPct(TYPE_SIZE_PCT, "landscape") * 2100).toBeCloseTo(TYPE_SIZE_PCT * HD, 9);
    // The same rule ptToPct follows for a point size.
    expect(displayPct(ptToPct(9), "landscape")).toBeCloseTo(ptToPct(9, "landscape"), 12);
  });
});

describe("M15_FAMILY_TEMPLATES", () => {
  it("lists real templates once each, without split and battle (TODO 4.21)", () => {
    expect(new Set(M15_FAMILY_TEMPLATES).size).toBe(M15_FAMILY_TEMPLATES.length);
    for (const t of M15_FAMILY_TEMPLATES) expect(FRAME_TEMPLATE_VALUES, t).toContain(t);
    expect(M15_FAMILY_TEMPLATES).not.toContain("split");
    expect(M15_FAMILY_TEMPLATES).not.toContain("battle");
    // Every family frame is portrait.
    for (const t of M15_FAMILY_TEMPLATES) expect(getFrameProfile(t).orientation ?? "portrait", t).toBe("portrait");
  });
});
