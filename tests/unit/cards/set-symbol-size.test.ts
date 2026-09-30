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
import { SET_SYMBOL_PRINTED_PX, printedSetSymbolPx } from "@/lib/cards/set-symbol-prints";
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
// type.sizePct × 1.1, byte for byte. Layout v36 (TODO 4.46): a set whose
// printed symbol was measured (lib/cards/set-symbol-prints.ts) draws at the
// print's size instead — its glyph fitted inside the printed box by its ink,
// never wider than 0.12 W — on every family frame but the full-art basics
// (setSymbolFit "ink-box", 4.39's print-checked size).
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
    // …and 4.33's borderless planeswalkers, which keep m15pw's box.
    const thin = new Set(["m15pw", "m15borderlesspw", "m15borderlesspwtall", "saga"]);
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

  it("gives an unmeasured short glyph box × KEYRUNE_EM_PER_BOX = 0.065 W, the full-art basics' size", () => {
    // M14's ink is 0.53 em tall: 0.065 W stands it 51 px tall, well inside.
    expect(printedSetSymbolPx(KEYRUNE_CODEPOINTS.m14)).toBeNull();
    const s = setSymbolSize(m15, glyph("m14"));
    expect(s.sizePct).toBe(0.065);
    expect(SET_SYMBOL_BOX_PCT * KEYRUNE_EM_PER_BOX).toBe(0.065);
    expect(Math.round(s.sizePct * HD)).toBe(98);
  });

  it("fits an unmeasured tall glyph's ink to the box exactly (XLN: 86 px font and ink)", () => {
    expect(printedSetSymbolPx(KEYRUNE_CODEPOINTS.xln)).toBeNull();
    const xln = setSymbolSize(m15, glyph("xln"));
    const { heightEm } = ink(KEYRUNE_CODEPOINTS.xln);
    expect(heightEm).toBeGreaterThan(1 / KEYRUNE_EM_PER_BOX);
    expect(xln.sizePct * heightEm).toBeCloseTo(SET_SYMBOL_BOX_PCT, 12);
    expect(Math.round(xln.sizePct * HD)).toBe(86);
  });

  it("never stands an unmeasured glyph's ink taller than the box, nor wider than 0.12 W, on any family frame", () => {
    for (const template of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(template);
      const box = setSymbolBoxPct(p);
      for (const source of ALL_GLYPHS) {
        if (p.setSymbolFit === "ink" && printedSetSymbolPx(source.codepoint)) continue;
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

  it("draws a measured set's glyph at its PRINTED size on every ink-fit frame, the thin bars included (4.46, v36)", () => {
    for (const template of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(template);
      if (p.setSymbolFit !== "ink") continue;
      for (const [code, [h, w]] of Object.entries(SET_SYMBOL_PRINTED_PX)) {
        const s = setSymbolSize(p, glyph(code));
        const { heightEm, widthEm, advanceEm } = ink(KEYRUNE_CODEPOINTS[code]);
        const label = `${template} ${code}`;
        const inkH = s.sizePct * heightEm * HD;
        const inkW = s.sizePct * widthEm * HD;
        // Inside the printed box and CC's 0.12 W width, touching one of them.
        expect(inkH, label).toBeLessThanOrEqual(h + 1e-9);
        expect(inkW, label).toBeLessThanOrEqual(Math.min(w, SET_SYMBOL_MAX_WIDTH_PCT * HD) + 1e-9);
        const touches = Math.abs(inkH - h) < 1e-9 || Math.abs(inkW - w) < 1e-9 || Math.abs(inkW - SET_SYMBOL_MAX_WIDTH_PCT * HD) < 1e-9;
        expect(touches, label).toBe(true);
        expect(s.drawnWidthPct, label).toBeCloseTo(advanceEm * s.sizePct, 12);
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
      const basic = template === "m15fullartland" || template === "fullartland";
      expect(p.setSymbolFit, template).toBe(M15_FAMILY_TEMPLATES.includes(template) ? (basic ? "ink-box" : "ink") : undefined);
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

  it("uses the thin-bar box on the planeswalker and saga (80 px) — for the mark, an icon and an unmeasured glyph", () => {
    for (const template of ["m15pw", "m15borderlesspw", "m15borderlesspwtall", "saga"]) {
      const p = getFrameProfile(template);
      expect(setSymbolSize(p, MARK).sizePct * HD, template).toBeCloseTo(79.95, 6);
      const xln = setSymbolSize(p, glyph("xln"));
      expect(xln.sizePct * ink(KEYRUNE_CODEPOINTS.xln).heightEm * HD, template).toBeCloseTo(79.95, 6);
      expect(setSymbolSize(p, glyph("m14")).sizePct, template).toBeCloseTo(SET_SYMBOL_BOX_PCT_THIN_BAR * KEYRUNE_EM_PER_BOX, 12);
      // A measured set prints at its regular size there too (the walker and
      // saga prints: 0.99–1.01 of the set's regular print) — DOM 88.5 px.
      const dom = setSymbolSize(p, glyph("dom"));
      expect(dom.sizePct * ink(KEYRUNE_CODEPOINTS.dom).heightEm * HD, template).toBeCloseTo(88.5, 6);
    }
  });

  it("keeps the full-art basics' glyph at 0.065 W unless its ink is taller than the box", () => {
    for (const template of ["m15fullartland", "fullartland"]) {
      const p = getFrameProfile(template);
      // Measured sets too: the printed-size table is the type bars' (v36).
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

// Print check (layout v36, TODO 4.46): the per-set table's effect on M15
// against the prints it was measured on (keyline-inclusive ink, HD px; a
// rare and an uncommon per set, lib/cards/set-symbol-prints.ts). v32's ink
// fit drew these 0.47–1.03 of the print's height — M20 / M21 / M19 0.47, NEO
// / DSK 0.64, OTJ 0.58, FDN 0.88 — the table draws every one at the print's
// height, but where Keyrune's glyph is wider than the print's in proportion
// (the box's width binds: EOE 0.91, OTJ 0.90, GRN / WOE / SNC 0.89–0.95) or
// wider than CC's 0.12 W (the core-set pills, 0.87).
describe("print check", () => {
  it("draws every measured set within its printed box, and its height to 0.87 of the print or better", () => {
    const m15 = getFrameProfile("m15");
    for (const [code, [h, w]] of Object.entries(SET_SYMBOL_PRINTED_PX)) {
      const s = setSymbolSize(m15, glyph(code));
      const { heightEm, widthEm } = ink(KEYRUNE_CODEPOINTS[code]);
      const oursH = s.sizePct * heightEm * HD;
      const oursW = s.sizePct * widthEm * HD;
      expect(oursH / h, code).toBeGreaterThanOrEqual(0.87);
      expect(oursH / h, code).toBeLessThanOrEqual(1 + 1e-9);
      expect(oursW / w, code).toBeLessThanOrEqual(1 + 1e-9);
    }
    // The owner's examples: the wide glyphs and FDN, which v32 drew small.
    const px = (code: string) => setSymbolSize(m15, glyph(code)).sizePct * ink(KEYRUNE_CODEPOINTS[code]).heightEm * HD;
    expect(px("neo")).toBeCloseTo(71.5, 1); // its width binds: 148 px, the print's
    expect(px("dsk")).toBeCloseTo(73, 0);
    expect(px("fdn")).toBeCloseTo(88.5, 6);
    expect(px("dom")).toBeCloseTo(88.5, 6);
    expect(Math.round(px("m20"))).toBe(75); // 180 px wide: CC's 0.12 W
  });

  it("lists every creator preset set (components/creator/panels/set-icon-panel.tsx) but the two v32 already drew at print size", () => {
    for (const code of ["dom", "eld", "thb", "iko", "khm", "stx", "afr", "mid", "neo", "dmu"]) {
      expect(SET_SYMBOL_PRINTED_PX[code], code).toBeDefined();
      expect(printedSetSymbolPx(keyruneCodepointFor(code)), code).toEqual(SET_SYMBOL_PRINTED_PX[code]);
    }
    // WAR (print 86.0 × 74.5) and ZNR (85.5 × 77.0) — and BFZ (86.0 × 65.0) —
    // draw at v32's fit, the same whole px as their print's size would.
    const m15 = getFrameProfile("m15");
    const printed: Record<string, [number, number]> = { war: [86, 74.5], znr: [85.5, 77], bfz: [86, 65] };
    for (const [code, [h, w]] of Object.entries(printed)) {
      expect(printedSetSymbolPx(keyruneCodepointFor(code)), code).toBeNull();
      const { heightEm, widthEm } = ink(KEYRUNE_CODEPOINTS[code]);
      const atPrint = Math.min(h / heightEm, w / widthEm);
      for (const width of [HD, 750]) {
        expect(Math.round((setSymbolSize(m15, glyph(code)).sizePct * width)), `${code} @${width}`).toBe(Math.round((atPrint * width) / HD));
      }
    }
  });
});
