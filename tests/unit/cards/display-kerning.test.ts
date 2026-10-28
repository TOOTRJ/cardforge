import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { describe, expect, it } from "vitest";
import {
  ACCENTED_KERNS_KEPT,
  ZEROED_ACCENTED_KERN_PAIRS,
  ZEROED_DISPLAY_KERN_PAIRS,
  hasZeroedKernPair,
} from "@/lib/cards/display-kerning";

// ---------------------------------------------------------------------------
// Layout v72: the committed Beleren Bold carries its collision-guard kerns at
// 0 (lib/cards/display-kerning.ts, scripts/fix-beleren-kerning.mjs). Read
// both files the renderers load — the TTF the bake registers and the WOFF2
// the preview's @font-face takes first — and hold every listed pair to 0,
// and the pairs v72 deliberately left alone to the font's own values (a
// re-import of the unpatched file, or a patch that went wider, fails here).
// ---------------------------------------------------------------------------

type Font = ReturnType<typeof fontkit.create>;
const load = (file: string): Font => fontkit.create(readFileSync(join(process.cwd(), "public/fonts", file)));
const FACES = { ttf: load("Beleren-Bold.ttf"), woff2: load("Beleren-Bold.woff2") };

/** How far the font kerns a pair apart (+) or together (−), font units —
 *  as Satori draws it (opentype.js GPOS, ligatures off; fontkit agrees). */
function kern(font: Font, pair: string): number {
  const run = font.layout(pair, { liga: false });
  expect(run.glyphs).toHaveLength(2);
  return run.positions[0].xAdvance - font.glyphsForString(pair[0])[0].advanceWidth;
}

describe("the zeroed pairs (v72)", () => {
  it("lists 21 distinct two-letter pairs, a letter that overhangs on the left", () => {
    expect(ZEROED_DISPLAY_KERN_PAIRS).toHaveLength(21);
    expect(new Set(ZEROED_DISPLAY_KERN_PAIRS).size).toBe(21);
    for (const pair of ZEROED_DISPLAY_KERN_PAIRS) expect(pair, pair).toMatch(/^[KQRfk][a-z]$/);
  });

  for (const [name, font] of Object.entries(FACES)) {
    it(`${name}: every listed pair — and with an accented right letter — draws unkerned`, () => {
      for (const pair of ZEROED_DISPLAY_KERN_PAIRS) expect(kern(font, pair), pair).toBe(0);
      expect(ZEROED_ACCENTED_KERN_PAIRS).toEqual(["fí"]);
      for (const pair of ZEROED_ACCENTED_KERN_PAIRS) expect(kern(font, pair), pair).toBe(0);
    });

    it(`${name}: the accented forms kerned far wider than their plain pair keep the font's kern`, () => {
      // fi was +180; these guard the f's hook off the accent, and no print
      // shows them set tight.
      expect(ACCENTED_KERNS_KEPT).toEqual({ "fì": 495, "fî": 451, "fï": 631 });
      for (const [pair, units] of Object.entries(ACCENTED_KERNS_KEPT)) expect(kern(font, pair), pair).toBe(units);
    });

    it(`${name}: no other accented right letter of a listed pair is kerned`, () => {
      // An accented form the font kerns is either zeroed with its plain pair
      // or kept on purpose — never left out of the data by accident.
      const listed = new Set([...ZEROED_ACCENTED_KERN_PAIRS, ...Object.keys(ACCENTED_KERNS_KEPT)]);
      const accented = "àáâãäåāăąçćčďèéêëēėęěìíîïīįñńňòóôõöøōőŕřśšşťùúûüūůűųýÿźżž";
      for (const pair of ZEROED_DISPLAY_KERN_PAIRS) {
        for (const ch of accented) {
          if (ch.normalize("NFD").charAt(0) !== pair[1] || listed.has(pair[0] + ch)) continue;
          if (font.glyphsForString(ch)[0].id === 0) continue; // not in the font
          expect(kern(font, pair[0] + ch), pair[0] + ch).toBe(0);
        }
      }
    });

    it(`${name}: every other pair keeps the font's own kern`, () => {
      // Font units at 2048 per em, as Beleren P1.01 ships them.
      const kept: Record<string, number> = {
        AV: -451, To: -224, Ty: 68, Ko: -134, fa: -112, "f.": -180, // tightening, and Ty's small spread
        RA: 293, KA: 224, fT: 383, TT: 224, // capital pairs: no print has shown us
        ry: 112, fu: 68, Rn: 90, ff: -68, // small spacing pairs
        "f'": 315, "K)": 675, "77": 224, // punctuation and digits (f→’ is spaced on print)
      };
      for (const [pair, units] of Object.entries(kept)) expect(kern(font, pair), pair).toBe(units);
    });
  }
});

describe("hasZeroedKernPair", () => {
  it("finds a pair anywhere in the text, and the one accented form zeroed with its plain pair (fí)", () => {
    for (const text of ["Kylox", "Magnetic Snuffler", "Skyfisher", "Ryusei", "Elfhame", "Halfling", "Grifín", "of Kjeldor", "Qyst"]) {
      expect(hasZeroedKernPair(text), text).toBe(true);
    }
    // A decomposed accent reads as its plain pair (errs wide).
    expect(hasZeroedKernPair("Grifìn")).toBe(true);
  });

  it("reads an accented form the font still kerns, or never kerned, as no pair", () => {
    for (const text of ["Grifìn", "Elfîr", "Grifïn", "Kýlox", "Rýu"]) {
      expect(hasZeroedKernPair(text), text).toBe(false);
    }
  });

  it("is case- and order-exact: no other pair, nothing across a space, no empty text", () => {
    for (const text of ["KYLOX", "kYLOX", "yK", "lf", "Serra Angel", "AV To Ty", "of lions", "Aardwolf's", "Fly", "", null, undefined]) {
      expect(hasZeroedKernPair(text), String(text)).toBe(false);
    }
  });
});
