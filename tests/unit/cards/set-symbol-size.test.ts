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
import {
  SET_SYMBOL_PRINTED_PAST_CAP,
  SET_SYMBOL_PRINTED_PX,
  printedPastCap,
  printedSetSymbolPx,
} from "@/lib/cards/set-symbol-prints";
import { getFrameProfile, SET_SYMBOL_KEYLINE } from "@/lib/cards/template-layout";
import {
  ALPHA_SET_SYMBOL_BOX_PCT,
  KEYRUNE_EM_PER_BOX,
  SET_SYMBOL_BOX_PCT,
  SET_SYMBOL_BOX_PCT_THIN_BAR,
  SET_SYMBOL_KEYLINE_EM,
  SET_SYMBOL_MAX_WIDTH_PCT,
  SPLIT_SET_SYMBOL_BOX_PCT,
  displayPct,
} from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

/** The 1993 pair: outside the family, with a pinned box (TODO 4.10c). */
const ALPHA_1993: readonly string[] = ["agclassic", "alphaland"];

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
// never wider than 0.12 W but for the core-set pills M19 / M20 / M21, which
// print wider (owner round 18) — on every family frame but the full-art basics
// (setSymbolFit "ink-box", 4.39's print-checked size). The printed box is
// keyline-inclusive, so on a frame that draws a keyline round the glyph (the
// borderless bars' white SET_SYMBOL_KEYLINE) the ink AND its ring fit it.
// ---------------------------------------------------------------------------

const HD = 1500;
/** The HD width of the card a profile draws: 2100 px on a landscape one (the
 *  battle, the family's one landscape member — TODO 4.21b; split). */
const hdOf = (p: { orientation?: "portrait" | "landscape" }) => (p.orientation === "landscape" ? 2100 : HD);
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
        // Split (TODO 4.21b) is the one frame outside the family with a box
        // of its own: the prints' 48 px on its thin type bar.
        // …and the 1993 pair (TODO 4.10c, owner round 44): pinned at the
        // 49.5 px it drew at before its type line grew to 70 px.
        const own = template === "split" ? SPLIT_SET_SYMBOL_BOX_PCT : ALPHA_1993.includes(template) ? ALPHA_SET_SYMBOL_BOX_PCT : undefined;
        expect(p.symbolSizePct, template).toBe(own);
        continue;
      }
      // The family's box is the same px on the page on its one landscape
      // member (the battle): the constant × 5/7 of its 2100 px width.
      const box = thin.has(template) ? SET_SYMBOL_BOX_PCT_THIN_BAR : SET_SYMBOL_BOX_PCT;
      expect(p.symbolSizePct, template).toBe(p.orientation === "landscape" ? displayPct(box, "landscape") : box);
    }
    // The battle joined the family with its Card Conjurer master (layout
    // v43): CC's 86 px box, on the landscape card.
    const battle = getFrameProfile("battle");
    expect(battle.symbolSizePct! * 2100).toBeCloseTo(SET_SYMBOL_BOX_PCT * HD, 9);
    expect(battle.symbolSizePct).toBeLessThan(SET_SYMBOL_BOX_PCT);
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
      // A keylined bar draws the ring 0.05 em out on every side: it is part
      // of the symbol as drawn, as the keyline is of the printed box.
      const ringEm = p.setSymbolKeyline ? SET_SYMBOL_KEYLINE_EM : 0;
      // The printed box is HD px of a PORTRAIT card: the same px on the
      // landscape battle's 2100 px card (a symbol prints no bigger there).
      const hd = hdOf(p);
      for (const [code, [h, w]] of Object.entries(SET_SYMBOL_PRINTED_PX)) {
        const s = setSymbolSize(p, glyph(code));
        const { heightEm, widthEm, advanceEm } = ink(KEYRUNE_CODEPOINTS[code]);
        const [, xMin] = KEYRUNE_GLYPHS[KEYRUNE_CODEPOINTS[code]];
        const label = `${template} ${code}`;
        const inkH = s.sizePct * (heightEm + 2 * ringEm) * hd;
        const inkW = s.sizePct * (widthEm + 2 * ringEm) * hd;
        // Inside the printed box and CC's 0.12 W width (the core-set pills:
        // the box alone), touching one of them.
        const cap = SET_SYMBOL_PRINTED_PAST_CAP.includes(code) ? Infinity : SET_SYMBOL_MAX_WIDTH_PCT * HD;
        expect(inkH, label).toBeLessThanOrEqual(h + 1e-9);
        expect(inkW, label).toBeLessThanOrEqual(Math.min(w, cap) + 1e-9);
        const touches = Math.abs(inkH - h) < 1e-9 || Math.abs(inkW - w) < 1e-9 || Math.abs(inkW - cap) < 1e-9;
        expect(touches, label).toBe(true);
        expect(s.drawnWidthPct, label).toBeCloseTo(advanceEm * s.sizePct, 12);
        // The type line stops a gap before the silhouette: the ink's side
        // bearing, less the ring on a keylined bar.
        expect(s.inkLeftPct, label).toBeCloseTo((Math.max(0, xMin) / KEYRUNE_UNITS_PER_EM - ringEm) * s.sizePct, 12);
      }
    }
  });

  it("fits the ink AND the keyline's ring on the keylined borderless bars, and nowhere else (4.46 review)", () => {
    // SET_SYMBOL_KEYLINE's axis copies sit SET_SYMBOL_KEYLINE_EM out.
    const axis = SET_SYMBOL_KEYLINE.split(",").map((layer) => layer.trim().split(/\s+/).slice(0, 2).map((v) => Math.abs(parseFloat(v))));
    expect(Math.max(...axis.flat())).toBe(SET_SYMBOL_KEYLINE_EM);
    const keylined = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).setSymbolKeyline);
    expect(keylined.sort()).toEqual(["m15borderless", "m15borderlessartifact", "m15borderlessland"]);
    const m15 = getFrameProfile("m15");
    for (const template of keylined) {
      const p = getFrameProfile(template);
      // DMU (the matrix's set): 91.5 × 83 printed, keyline included. M15
      // draws the ink at 91.5 px tall; the borderless bar fits the ink + ring
      // (83 px wide binds: 91.0 × 83.0).
      const dmu = setSymbolSize(p, glyph("dmu"));
      const { heightEm, widthEm } = ink(KEYRUNE_CODEPOINTS.dmu);
      expect(dmu.sizePct * (widthEm + 0.1) * HD, template).toBeCloseTo(83, 9);
      expect(dmu.sizePct * (heightEm + 0.1) * HD, template).toBeLessThanOrEqual(91.5);
      expect(dmu.sizePct * heightEm * HD, template).toBeLessThan(setSymbolSize(m15, glyph("dmu")).sizePct * heightEm * HD - 8);
      // The core-set pill: past CC's 180 px (owner round 18), ink + ring at
      // its print's 86 px height (183 px wide; the width, 187.5, has room).
      const m20 = setSymbolSize(p, glyph("m20"));
      expect(m20.sizePct * (ink(KEYRUNE_CODEPOINTS.m20).heightEm + 0.1) * HD, template).toBeCloseTo(86, 9);
      expect(m20.sizePct * (ink(KEYRUNE_CODEPOINTS.m20).widthEm + 0.1) * HD, template).toBeCloseTo(182.96, 2);
      // An unmeasured set keeps v32's fit exactly (its ring was never
      // counted there; changing that would re-bake unlisted cards).
      for (const code of ["xln", "m14", "war", "bfz"]) {
        expect(setSymbolSize(p, glyph(code)), `${template} ${code}`).toEqual(setSymbolSize(m15, glyph(code)));
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

  it("lifts CC's 0.12 W cap for the core-set pills only (M19 / M20 / M21 at their print's width; owner round 18)", () => {
    expect([...SET_SYMBOL_PRINTED_PAST_CAP].sort()).toEqual(["m19", "m20", "m21"]);
    const cap = SET_SYMBOL_MAX_WIDTH_PCT * HD;
    for (const [code, [, w]] of Object.entries(SET_SYMBOL_PRINTED_PX)) {
      const cp = KEYRUNE_CODEPOINTS[code];
      const inkW = setSymbolSize(m15, glyph(code)).sizePct * ink(cp).widthEm * HD;
      if (SET_SYMBOL_PRINTED_PAST_CAP.includes(code)) {
        // Every one prints wider than the cap, and draws at its print's width.
        expect(w, code).toBeGreaterThan(cap);
        expect(printedPastCap(cp), code).toBe(true);
        expect(inkW, code).toBeCloseTo(w, 9);
      } else {
        expect(printedPastCap(cp), code).toBe(false);
        expect(inkW, code).toBeLessThanOrEqual(cap + 1e-9);
      }
    }
    // Only these three print wider than the cap: the list is the whole set.
    expect(Object.entries(SET_SYMBOL_PRINTED_PX).filter(([, [, w]]) => w > cap).map(([code]) => code).sort()).toEqual([
      "m19",
      "m20",
      "m21",
    ]);
    // Their exact sizes on M15 (HD px, ink): M19 188 × 78.4, M20 187.5 × 78.2, M21 189 × 78.5.
    for (const [code, w, h] of [
      ["m19", 188, 78.42],
      ["m20", 187.5, 78.21],
      ["m21", 189, 78.44],
    ] as const) {
      const s = setSymbolSize(m15, glyph(code));
      expect(s.sizePct * ink(KEYRUNE_CODEPOINTS[code]).widthEm * HD, code).toBeCloseTo(w, 9);
      expect(s.sizePct * ink(KEYRUNE_CODEPOINTS[code]).heightEm * HD, code).toBeCloseTo(h, 1);
    }
    // The cap still holds for an unlisted glyph (the synthetic wide one
    // above) and for the full-art basics, which never read the table.
    for (const template of ["m15fullartland", "fullartland"]) {
      expect(setSymbolSize(getFrameProfile(template), glyph("m20")).sizePct, template).toBe(0.065);
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
    // Every family profile carries the flag; outside it only split does —
    // its own "ink-height" (TODO 4.21b), never the family's printed sizes.
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      const basic = template === "m15fullartland" || template === "fullartland";
      const outside = template === "split" ? "ink-height" : undefined;
      expect(p.setSymbolFit, template).toBe(M15_FAMILY_TEMPLATES.includes(template) ? (basic ? "ink-box" : "ink") : outside);
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
      // (Split has a box and a fit of its own — the next block.)
      if (M15_FAMILY_TEMPLATES.includes(template) || template === "split") continue;
      const p = getFrameProfile(template);
      // The 1993 pair's box is pinned (49.5 px, what 45 px × 1.1 gave it
      // before v48): same rule — the box is every source's size — off the
      // type line.
      const box = ALPHA_1993.includes(template) ? ALPHA_SET_SYMBOL_BOX_PCT : p.type.sizePct * 1.1;
      if (ALPHA_1993.includes(template)) expect(box * 1500).toBeCloseTo(49.5, 9);
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
// (the box's width binds: EOE 0.91, OTJ 0.90, GRN / WOE / SNC 0.89–0.95, the
// core-set pills 0.91 — at their print's 187.5–189 px width, past CC's 0.12 W
// since owner round 18; 0.87 under it).
describe("the split card's thin type bar (setSymbolFit \"ink-height\", TODO 4.21b)", () => {
  // MH2 #123 / #60 print their symbol 47–48 px tall (72 wide), TSR #161 /
  // #186 47–50, on a bar whose face is 69 px — where the same sets' symbols
  // stand 88–91 px tall on a regular card. A split half's symbol is fitted by
  // its ink's HEIGHT to a 48 px box, whatever the glyph's shape.
  const split = getFrameProfile("split");
  const W = 2100;
  const BOX = 48;

  it("has a 48 px box: the default mark and an uploaded icon fill a square of it", () => {
    expect(split.symbolSizePct! * W).toBeCloseTo(BOX, 9);
    expect(setSymbolBoxPct(split) * W).toBeCloseTo(BOX, 9);
    for (const source of [ICON, MARK]) {
      const s = setSymbolSize(split, source);
      expect(s.sizePct * W).toBeCloseTo(BOX, 9);
      expect(s.drawnWidthPct * W).toBeCloseTo(BOX, 9);
      expect(s.inkLeftPct).toBe(0);
    }
  });

  it("stands every glyph's ink exactly as tall as the box — a wide mark and a tall hourglass alike — unless the width cap binds", () => {
    // Never wider than the box × the family's width-to-box ratio (CC's
    // 0.12 W box over its 0.041 H one): 100.5 px.
    const maxWidthPx = BOX * (SET_SYMBOL_MAX_WIDTH_PCT / SET_SYMBOL_BOX_PCT);
    expect(maxWidthPx).toBeCloseTo(100.35, 1);
    let capped = 0;
    for (const source of ALL_GLYPHS) {
      const s = setSymbolSize(split, source);
      const { heightEm, widthEm, advanceEm } = ink(source.codepoint);
      const label = `U+${source.codepoint.toString(16)}`;
      const inkH = s.sizePct * heightEm * W;
      const inkW = s.sizePct * widthEm * W;
      expect(inkH, label).toBeLessThanOrEqual(BOX + 1e-9);
      expect(inkW, label).toBeLessThanOrEqual(maxWidthPx + 1e-9);
      if (Math.abs(inkW - maxWidthPx) < 1e-9 && inkH < BOX - 1e-9) capped += 1;
      else expect(inkH, label).toBeCloseTo(BOX, 9);
      expect(s.drawnWidthPct, label).toBeCloseTo(advanceEm * s.sizePct, 12);
    }
    // Only a handful of very wide glyphs meet the cap.
    expect(capped).toBeLessThan(ALL_GLYPHS.length * 0.1);
    // MH2's wide mark and TSR's tall hourglass: both 48 px tall.
    for (const code of ["mh2", "tsr"]) {
      const s = setSymbolSize(split, glyph(code));
      expect(s.sizePct * ink(KEYRUNE_CODEPOINTS[code]).heightEm * W, code).toBeCloseTo(BOX, 9);
    }
  });

  it("never reads the printed-size table: that one holds a regular card's sizes", () => {
    // DOM prints 88.5 px tall on a regular card (and so on the battle, a
    // family frame); on a split half its ink is the box's 48 px.
    expect(printedSetSymbolPx(KEYRUNE_CODEPOINTS.dom)).not.toBeNull();
    const onSplit = setSymbolSize(split, glyph("dom"));
    expect(onSplit.sizePct * ink(KEYRUNE_CODEPOINTS.dom).heightEm * W).toBeCloseTo(BOX, 9);
    const battle = getFrameProfile("battle");
    const onBattle = setSymbolSize(battle, glyph("dom"));
    expect(onBattle.sizePct * ink(KEYRUNE_CODEPOINTS.dom).heightEm * W).toBeCloseTo(88.5, 6);
    // …the same px as on M15.
    const onM15 = setSymbolSize(getFrameProfile("m15"), glyph("dom"));
    expect(onBattle.sizePct * W).toBeCloseTo(onM15.sizePct * HD, 9);
    // An unflagged copy of split would draw font = box, as any frame off the
    // family: the fit is the flag's.
    const unflagged = { ...split, setSymbolFit: undefined };
    expect(setSymbolSize(unflagged, glyph("mh2")).sizePct).toBe(SPLIT_SET_SYMBOL_BOX_PCT);
  });
});

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
    expect(Math.round(px("m20"))).toBe(78); // 187.5 px wide, the print's (the 0.12 W cap drew 180 × 75)
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
