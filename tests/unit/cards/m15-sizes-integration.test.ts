import { describe, expect, it } from "vitest";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import {
  MEASURED_LINE_FIT_SAFETY,
  TYPE_SYMBOL_GAP_PCT,
  fitTypeLineBand,
  measuredLinePx,
  slotLineEm,
  typeLineRoomPct,
} from "@/lib/cards/render-tiers";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { fitTitleBand } from "@/lib/cards/title-band";
import { COST_DISC_PCT, RULES_TEXT, TITLE_SIZE_PCT, TYPE_SIZE_PCT, ptToPct } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// TODO 4.20 (layout v32) as SHIPPED: the family's profiles, the set-symbol
// box and the measured fits together, on the live profiles (each part's own
// tests set its inputs explicitly).
// ---------------------------------------------------------------------------

describe("layout v32 — the live family profiles with the measured fits and the set-symbol box", () => {
  it("sets the printed walkers' names whole beside their M15-size pips, at their print's size where our Beleren allows", () => {
    const pw = getFrameProfile("m15pw");
    expect(pw.title.fit).toBe("measured");
    expect(pw.title.sizePct).toBe(TITLE_SIZE_PCT);
    expect(pw.costSizePct).toBe(COST_DISC_PCT);
    // [name, cost, HD px, the print's] — tests/unit/cards/title-band.test.ts
    // holds the band-gap rule behind these.
    for (const [name, cost, px] of [
      ["Chandra, Torch of Defiance", "{2}{R}{R}", 78], // KLD #110 prints ≈ 78
      ["Gideon, Ally of Zendikar", "{2}{W}{W}", 80],
      ["Karn, Scion of Urza", "{4}", 80],
      ["Liliana, Death's Majesty", "{3}{B}{B}", 80],
    ] as const) {
      const fit = fitTitleBand(pw, name, cost)!;
      expect(fit.text, name).toBe(name);
      expect(measuredLinePx(fit.sizePct, TITLE_SIZE_PCT, 1500), name).toBe(px);
    }
  });

  it("ends a planeswalker's long type line a print's gap before the set symbol's ink in its symbolRect — even past the floor", () => {
    const pw = getFrameProfile("m15pw");
    const box = pw.symbolRect!;
    for (const line of [
      "Legendary Planeswalker — Nicol Bolas",
      // Too long even at 5 pt: cut with ONE "…", still clear of the symbol.
      "Legendary Snow Planeswalker — Nicol Bolas Tezzeret Sarkhan Ugin Karn Teferi Gideon",
    ]) {
      for (const code of [null, "dom", "m20"]) {
        const symbol = setSymbolSize(pw, setSymbolSource(null, code));
        const fit = fitTypeLineBand({
          layout: pw,
          text: line,
          symbolWidthPct: symbol.drawnWidthPct,
          symbolInkLeftPct: symbol.inkLeftPct,
        });
        const inkLeft = (box.leftPct + box.widthPct) / 100 - symbol.drawnWidthPct + symbol.inkLeftPct;
        expect(fit.sizePct, String(code)).toBeLessThanOrEqual(TYPE_SIZE_PCT);
        expect(fit.widthPct).toBeCloseTo(typeLineRoomPct(pw, symbol.drawnWidthPct, symbol.inkLeftPct), 12);
        // At the size either bake draws it (whole px, never below the floor's).
        for (const W of [750, 1500]) {
          const px = measuredLinePx(fit.sizePct, TYPE_SIZE_PCT, W);
          const end = pw.type.rect.leftPct / 100 + (slotLineEm(fit.text, pw.type) * MEASURED_LINE_FIT_SAFETY * px) / W;
          expect(end + TYPE_SYMBOL_GAP_PCT, `${line} ${code} ${W}`).toBeLessThanOrEqual(inkLeft + 1e-9);
        }
      }
    }
    const floorFit = fitTypeLineBand({
      layout: pw,
      text: "Legendary Snow Planeswalker — Nicol Bolas Tezzeret Sarkhan Ugin Karn Teferi Gideon",
      symbolWidthPct: setSymbolSize(pw, setSymbolSource(null, "dom")).drawnWidthPct,
    });
    expect(floorFit.sizePct).toBe(ptToPct(RULES_TEXT.hardFloorPt));
    expect(floorFit.text.endsWith("…")).toBe(true);
  });

  it("sets the print-checked long type lines within reach of the print (4.20 print review)", () => {
    // [line, the card's set, the HD px v32 draws it at, the print's]: the
    // prints keep these at the full 68 px with ≈ 20 px before the symbol;
    // ours measure by an upper bound (advances, the pairs the browser kerns
    // wider) that runs ≈ 2.6 % over the kerned ink, so they shrink a little
    // — no longer the 8–11 % the first cut's 5 % safety and band gap took.
    const m15 = getFrameProfile("m15");
    for (const [line, code, px] of [
      ["Legendary Creature — Phyrexian Angel", "one", 64], // ONE #196 Atraxa (was 61)
      // DSK #113 (was 60; 62 at v32–v35): layout v36 (4.46) draws DSK's
      // symbol at the print's 151.5 px, 54 px wider than v32's capped
      // glyph, so the line's room follows the print's symbol — our display
      // face sets it wider than the print's (TODO 4.8).
      ["Enchantment Creature — Avatar Horror", "dsk", 59],
      ["Legendary Enchantment Creature — Nymph", "mh2", 57], // MH2 #214 Sythis (was 54; the print ≈ 58)
      ["Legendary Creature — Human Wizard", "mh2", 66],
    ] as const) {
      const symbol = setSymbolSize(m15, setSymbolSource(null, code));
      const fit = fitTypeLineBand({
        layout: m15,
        text: line,
        symbolWidthPct: symbol.drawnWidthPct,
        symbolInkLeftPct: symbol.inkLeftPct,
      });
      expect(fit.text, line).toBe(line);
      expect(measuredLinePx(fit.sizePct, TYPE_SIZE_PCT, 1500), line).toBe(px);
    }
  });

  it("centres the token's type band on Card Conjurer's type pill, re-cut 8 px lower (1724–1830 px at HD; TODO 4.49)", () => {
    for (const t of ["m15token", "m15tokenartifact"] as const) {
      const { rect } = getFrameProfile(t).type;
      const centre = ((rect.topPct + rect.heightPct / 2) / 100) * 2100;
      expect(Math.abs(centre - (1724 + 1830) / 2), t).toBeLessThan(1);
    }
  });

  it("reserves each family frame's type line room from the symbol it draws (mark, icon, glyph)", () => {
    for (const template of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(template);
      if (p.textless) continue;
      const mark = setSymbolSize(p, setSymbolSource(null, null));
      const icon = setSymbolSize(p, setSymbolSource("https://x.test/i.png", null));
      expect(icon, template).toEqual(mark);
      expect(mark.drawnWidthPct, template).toBe(p.symbolSizePct);
      // A wider drawn symbol never leaves the line more room.
      const m20 = setSymbolSize(p, setSymbolSource(null, "m20"));
      expect(typeLineRoomPct(p, m20.drawnWidthPct, m20.inkLeftPct), template).toBeLessThanOrEqual(
        typeLineRoomPct(p, mark.drawnWidthPct, mark.inkLeftPct) + 1e-12,
      );
    }
  });

  it("puts every family title and type slot on the measured fit except the full-art basics", () => {
    for (const template of M15_FAMILY_TEMPLATES) {
      const p = getFrameProfile(template);
      const basic = template === "m15fullartland" || template === "fullartland";
      expect(p.title.fit, template).toBe(basic ? undefined : "measured");
      expect(p.type.fit, template).toBe(basic ? undefined : "measured");
    }
  });
});
