import { describe, expect, it } from "vitest";
import {
  keyruneCodepointFor,
  setSymbolBoxPct,
  setSymbolDrawnPx,
  setSymbolSize,
  setSymbolSource,
  type SetSymbolSource,
} from "@/lib/cards/set-symbol-size";
import {
  KEYRUNE_CODEPOINTS,
  KEYRUNE_DEFAULT_CODEPOINT,
  KEYRUNE_GLYPHS,
  KEYRUNE_UNITS_PER_EM,
} from "@/lib/cards/keyrune-metrics";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  KEYRUNE_EM_PER_BOX,
  SET_SYMBOL_BOX_PCT,
  SET_SYMBOL_BOX_PCT_THIN_BAR,
  SET_SYMBOL_MAX_WIDTH_PCT,
} from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The set-symbol size rule (TODO 4.20, layout v32; owner decision 2026-09-28),
// read by both renderers: the M15-era family's profiles set a BOX
// (symbolSizePct — Card Conjurer's 0.041 H, 0.0381 H on the planeswalker and
// saga bars); an uploaded icon and the default mark fill it; a Keyrune glyph
// is fitted to it by its ink — font = min(box × KEYRUNE_EM_PER_BOX, box ÷ ink
// height, 0.12 W ÷ ink width). Every other frame keeps font = box =
// type.sizePct × 1.1, byte for byte.
// ---------------------------------------------------------------------------

const HD = 1500;
const ICON: SetSymbolSource = { kind: "icon" };
const MARK: SetSymbolSource = { kind: "mark" };
const glyph = (code: string) => setSymbolSource(null, code);
const ALL_GLYPHS = Object.keys(KEYRUNE_GLYPHS).map((cp) => ({ kind: "glyph", codepoint: Number(cp) }) as const);

function ink(codepoint: number) {
  const [advance, xMin, yMin, xMax, yMax] = KEYRUNE_GLYPHS[codepoint];
  return {
    advanceEm: advance / KEYRUNE_UNITS_PER_EM,
    heightEm: (yMax - yMin) / KEYRUNE_UNITS_PER_EM,
    widthEm: (xMax - xMin) / KEYRUNE_UNITS_PER_EM,
  };
}

describe("setSymbolSource / keyruneCodepointFor", () => {
  it("takes an icon over a set code over the mark, like both renderers", () => {
    expect(setSymbolSource("https://x.test/i.png", "dom")).toEqual({ kind: "icon" });
    expect(setSymbolSource(null, "dom")).toEqual({ kind: "glyph", codepoint: KEYRUNE_CODEPOINTS.dom });
    expect(setSymbolSource(null, null)).toEqual({ kind: "mark" });
    expect(setSymbolSource("", "")).toEqual({ kind: "mark" });
  });

  it("resolves codes as getKeyruneCodepoint does, the default glyph for anything unknown", () => {
    expect(keyruneCodepointFor("DOM")).toBe(KEYRUNE_CODEPOINTS.dom);
    expect(keyruneCodepointFor("ss-dom")).toBe(KEYRUNE_CODEPOINTS.dom);
    expect(keyruneCodepointFor("zzz9")).toBe(KEYRUNE_DEFAULT_CODEPOINT);
    // Never an Object.prototype member.
    for (const code of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(keyruneCodepointFor(code), code).toBe(KEYRUNE_DEFAULT_CODEPOINT);
    }
  });
});

describe("the family's set-symbol boxes", () => {
  it("are set on every M15-era family profile and on nothing else", () => {
    const thin = new Set(["m15pw", "saga"]);
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      if (!M15_FAMILY_TEMPLATES.includes(template)) {
        expect(p.symbolSizePct, template).toBeUndefined();
        continue;
      }
      expect(p.symbolSizePct, template).toBe(thin.has(template) ? SET_SYMBOL_BOX_PCT_THIN_BAR : SET_SYMBOL_BOX_PCT);
    }
    // Split and battle stay out of v32 (4.21): no box, today's size.
    expect(getFrameProfile("split").symbolSizePct).toBeUndefined();
    expect(getFrameProfile("battle").symbolSizePct).toBeUndefined();
  });

  it("are Card Conjurer's: 86 px on M15, 80 px on the planeswalker and saga bars (HD)", () => {
    expect(SET_SYMBOL_BOX_PCT * HD).toBeCloseTo(0.041 * 2100, 1);
    expect(Math.abs(SET_SYMBOL_BOX_PCT_THIN_BAR * HD - 0.0381 * 2100)).toBeLessThan(0.1);
    // The planeswalker's box is its symbolRect's height; the full-art
    // basics' too.
    const pw = getFrameProfile("m15pw");
    expect(Math.abs(pw.symbolSizePct! * HD - (pw.symbolRect!.heightPct / 100) * 2100)).toBeLessThan(0.5);
    const basic = getFrameProfile("m15fullartland");
    expect(Math.abs(basic.symbolSizePct! * HD - (basic.symbolRect!.heightPct / 100) * 2100)).toBeLessThan(0.5);
  });
});

describe("setSymbolSize on the family", () => {
  const m15 = getFrameProfile("m15");

  it("draws an uploaded icon and the default mark in a square of the box (72 → 86 px on M15)", () => {
    for (const source of [ICON, MARK]) {
      const s = setSymbolSize(m15, source);
      expect(s).toEqual({
        boxPct: SET_SYMBOL_BOX_PCT,
        sizePct: SET_SYMBOL_BOX_PCT,
        advanceUnits: null,
        drawnWidthPct: SET_SYMBOL_BOX_PCT,
        inkLeftPct: 0,
      });
      expect(setSymbolDrawnPx(s, HD)).toBe(86);
    }
    // It was type.sizePct × 1.1: 0.0435 × 1.1 × 1500 = 71.8 px.
    expect(Math.round(0.0435 * 1.1 * HD)).toBe(72);
  });

  it("gives a short glyph box × KEYRUNE_EM_PER_BOX = 0.065 W, the full-art basics' size", () => {
    // M20's ink is 0.42 em tall: 0.065 W stands it 41 px tall, well inside.
    const s = setSymbolSize(m15, glyph("m20"));
    expect(s.sizePct).toBe(0.065);
    expect(SET_SYMBOL_BOX_PCT * KEYRUNE_EM_PER_BOX).toBe(0.065);
    expect(Math.round(s.sizePct * HD)).toBe(98);
  });

  it("fits a tall glyph's ink to the box exactly (DOM: 87 px font, 86 px of ink)", () => {
    const dom = setSymbolSize(m15, glyph("dom"));
    const { heightEm } = ink(KEYRUNE_CODEPOINTS.dom);
    expect(heightEm).toBeGreaterThan(1 / KEYRUNE_EM_PER_BOX);
    expect(dom.sizePct * heightEm).toBeCloseTo(SET_SYMBOL_BOX_PCT, 12);
    expect(Math.round(dom.sizePct * HD)).toBe(87);
  });

  it("never stands a glyph's ink taller than the box, nor wider than 0.12 W, on any family frame", () => {
    for (const template of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(template);
      const box = setSymbolBoxPct(p);
      for (const source of ALL_GLYPHS) {
        const s = setSymbolSize(p, source);
        const { heightEm, widthEm, advanceEm } = ink(source.codepoint);
        const label = `${template} U+${source.codepoint.toString(16)}`;
        expect(s.boxPct, label).toBe(box);
        expect(s.sizePct, label).toBeLessThanOrEqual(box * KEYRUNE_EM_PER_BOX);
        expect(s.sizePct * heightEm, label).toBeLessThanOrEqual(box + 1e-12);
        expect(s.sizePct * widthEm, label).toBeLessThanOrEqual(SET_SYMBOL_MAX_WIDTH_PCT + 1e-12);
        // Drawn as wide as its advance at that size.
        expect(s.drawnWidthPct, label).toBeCloseTo(advanceEm * s.sizePct, 12);
        // Either the em-per-box size or the ink fit binds.
        const bound = Math.min(box * KEYRUNE_EM_PER_BOX, box / heightEm);
        expect(s.sizePct, label).toBeCloseTo(bound, 12);
      }
    }
  });

  it("caps a glyph's ink at CC's 0.12 W box width (a wider glyph than keyrune 3.19 has)", () => {
    // A synthetic wide, flat glyph: 2.93 em of ink, 0.2 em tall — neither
    // box × KEYRUNE_EM_PER_BOX nor the ink height binds, the width cap does.
    const cp = 0x10fff0;
    const table = KEYRUNE_GLYPHS as Record<number, readonly [number, number, number, number, number]>;
    table[cp] = [3000, 0, 0, 3000, 200];
    try {
      const s = setSymbolSize(m15, { kind: "glyph", codepoint: cp });
      expect(s.sizePct).toBeCloseTo(SET_SYMBOL_MAX_WIDTH_PCT / (3000 / KEYRUNE_UNITS_PER_EM), 12);
      expect(s.sizePct).toBeLessThan(SET_SYMBOL_BOX_PCT * KEYRUNE_EM_PER_BOX);
      expect(s.sizePct * (3000 / KEYRUNE_UNITS_PER_EM)).toBeCloseTo(SET_SYMBOL_MAX_WIDTH_PCT, 12);
    } finally {
      delete table[cp];
    }
  });

  it("reports where a glyph's ink starts in its advance (its left side bearing at its size)", () => {
    for (const code of ["dom", "m20", "one", "zzz9"]) {
      const cp = keyruneCodepointFor(code);
      const [, xMin] = KEYRUNE_GLYPHS[cp];
      const s = setSymbolSize(m15, glyph(code));
      expect(s.inkLeftPct, code).toBeCloseTo((Math.max(0, xMin) * s.sizePct) / KEYRUNE_UNITS_PER_EM, 12);
      expect(s.inkLeftPct, code).toBeLessThan(s.drawnWidthPct);
    }
  });

  it("fits a glyph by its ink only on a profile that says so (setSymbolFit, code-owned)", () => {
    // Every family profile carries the flag; nothing else does.
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      expect(p.setSymbolFit, template).toBe(M15_FAMILY_TEMPLATES.includes(template) ? "ink" : undefined);
    }
    // An override's symbolSizePct on a frame outside the family resizes the
    // box but keeps font = box, as before v32 — it never switches the frame
    // to the ink fit (that would re-draw it outside v32's template scope).
    const modern = { ...getFrameProfile("modern"), symbolSizePct: 0.06 };
    for (const code of ["dom", "m20"]) expect(setSymbolSize(modern, glyph(code)).sizePct, code).toBe(0.06);
    // …and a family profile without the flag would too.
    const unflagged = { ...m15, setSymbolFit: undefined };
    expect(setSymbolSize(unflagged, glyph("dom")).sizePct).toBe(SET_SYMBOL_BOX_PCT);
  });

  it("uses the thin-bar box on the planeswalker and saga (80 px; DOM's ink 80 px)", () => {
    for (const template of ["m15pw", "saga"]) {
      const p = getFrameProfile(template);
      expect(setSymbolSize(p, MARK).sizePct * HD, template).toBeCloseTo(79.95, 6);
      const dom = setSymbolSize(p, glyph("dom"));
      expect(dom.sizePct * ink(KEYRUNE_CODEPOINTS.dom).heightEm * HD, template).toBeCloseTo(79.95, 6);
      expect(setSymbolSize(p, glyph("m20")).sizePct, template).toBeCloseTo(SET_SYMBOL_BOX_PCT_THIN_BAR * KEYRUNE_EM_PER_BOX, 12);
    }
  });

  it("keeps the full-art basics' glyph at 0.065 W unless its ink is taller than the box", () => {
    for (const template of ["m15fullartland", "fullartland"]) {
      const p = getFrameProfile(template);
      for (const code of ["m20", "fdn", "tdm", "dsk", "fin"]) {
        expect(setSymbolSize(p, glyph(code)).sizePct, `${template} ${code}`).toBe(0.065);
      }
      // …and draws the mark and an icon at the box (97.5 → 86 px).
      expect(setSymbolSize(p, MARK).sizePct).toBe(SET_SYMBOL_BOX_PCT);
      expect(setSymbolSize(p, ICON).sizePct).toBe(SET_SYMBOL_BOX_PCT);
    }
  });
});

describe("setSymbolSize off the family (byte-identical fallback)", () => {
  it("draws at type.sizePct × 1.1 — the icon, the mark and every glyph's font", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      if (M15_FAMILY_TEMPLATES.includes(template)) continue;
      const p = getFrameProfile(template);
      const box = p.type.sizePct * 1.1;
      expect(setSymbolBoxPct(p), template).toBe(box);
      for (const source of [ICON, MARK, ...ALL_GLYPHS]) {
        expect(setSymbolSize(p, source).sizePct, template).toBe(box);
      }
    }
  });

  it("measures the width as the bake always has: the rounded size, or the glyph's advance at it", () => {
    const modern = getFrameProfile("modern");
    for (const width of [750, HD]) {
      const px = Math.round(modern.type.sizePct * 1.1 * width);
      expect(setSymbolDrawnPx(setSymbolSize(modern, ICON), width)).toBe(px);
      expect(setSymbolDrawnPx(setSymbolSize(modern, MARK), width)).toBe(px);
      for (const code of ["dom", "m20", "zzz9"]) {
        const [advance] = KEYRUNE_GLYPHS[keyruneCodepointFor(code)];
        // keyruneAdvancePx's formula (fontkit's advance × px ÷ unitsPerEm).
        expect(setSymbolDrawnPx(setSymbolSize(modern, glyph(code)), width), code).toBe(
          (advance * px) / KEYRUNE_UNITS_PER_EM,
        );
      }
    }
  });
});

// Print check (2026-09-28, 43 cached Scryfall scans, HD px): each set's
// symbol ink height on the print, measured over the whole type-bar interior
// (sym_measure.py; measure.py's 5 px inset capped symbols at 84 px). The
// compact glyphs land 0.93–1.03 of the print (a tall one fills CC's 86 px
// box, which BFZ's 84 px print is a touch under); medium-wide ones (FIN, EOE,
// the Command Tower's MSC) 0.83–0.9, and the wide ones (M20/M21/SLD, DSK,
// NEO, OTJ, WOE, MH3, LTR) 0.51–0.62 — box × KEYRUNE_EM_PER_BOX caps them
// (owner decision 2026-09-28; the wide-glyph fit is TODO 4.46). Measured
// against the prints' keyline-inclusive height instead (the 4.20 print
// review: DOM #33 84 px, DOM #254 81, BFZ 80), compact glyphs read up to 1.07.
describe("print check", () => {
  const PRINT_INK_PX: Record<string, number> = { dom: 88, bfz: 84, ktk: 86, tla: 87.5, spm: 83, iko: 76 };
  it("puts the compact glyphs at 0.9–1.03 of the print on M15", () => {
    const m15 = getFrameProfile("m15");
    for (const [code, printPx] of Object.entries(PRINT_INK_PX)) {
      const s = setSymbolSize(m15, glyph(code));
      const ours = s.sizePct * ink(KEYRUNE_CODEPOINTS[code]).heightEm * HD;
      expect(ours / printPx, code).toBeGreaterThanOrEqual(0.9);
      expect(ours / printPx, code).toBeLessThanOrEqual(1.03);
    }
  });
});
