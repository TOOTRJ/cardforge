import { describe, expect, it } from "vitest";
import {
  BAND_GAP_PCT,
  COST_PIP_GAP,
  LINE_FIT_SAFETY,
  MEASURED_LINE_FIT_SAFETY,
  NAME_COST_GAP_PCT,
  TYPE_SYMBOL_GAP_PCT,
  costRowWidthPct,
  fitSingleLineSizePct,
  fitTypeLine,
  fitTypeLineBand,
  inlineSymbolPullPct,
  measuredLinePreviewPct,
  measuredLinePx,
  secondFaceLineSizes,
  slotLineEm,
  typeLineRoomPct,
} from "@/lib/cards/render-tiers";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { displayTextEm } from "@/lib/cards/display-metrics";
import { getFrameProfile, type FrameProfile } from "@/lib/cards/template-layout";
import { RULES_TEXT, TYPE_SIZE_PCT, pctToPt, ptToPct } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

describe("fitSingleLineSizePct", () => {
  const M15_TYPE_RECT = { topPct: 56.5, leftPct: 7.9, widthPct: 86.1, heightPct: 5.2 };
  const fitLine = (text: string) =>
    fitSingleLineSizePct({
      text,
      rect: M15_TYPE_RECT,
      baseSizePct: 0.0435,
      reservedPct: 0.0435 * 1.1 * 1.3,
    });

  it("keeps the base size for a normal type line", () => {
    expect(fitLine("Creature — Angel")).toBe(0.0435);
  });

  it("shrinks a long type line instead of ellipsizing", () => {
    const long = fitLine("Legendary Snow Artifact Creature — Phyrexian Golem Warrior");
    expect(long).toBeLessThan(0.0435);
    expect(long).toBeGreaterThanOrEqual(ptToPct(RULES_TEXT.hardFloorPt));
  });

  it("longer text never gets a larger size", () => {
    expect(fitLine("Legendary Creature — Dragon Wizard Noble")).toBeLessThanOrEqual(
      fitLine("Creature — Dragon"),
    );
  });

  it("takes a measured width in place of the average-advance estimate", () => {
    const rect = { ...M15_TYPE_RECT, widthPct: 60 };
    const text = "Miner the Miner, Damned Delver"; // 30 characters
    // Measured narrower than 30 × 0.56 em: it shrinks less (0.6 / 15 em).
    expect(fitSingleLineSizePct({ text, rect, baseSizePct: 0.05, textWidthEm: 15 })).toBeCloseTo(0.04, 12);
    expect(fitSingleLineSizePct({ text, rect, baseSizePct: 0.05 })).toBeCloseTo(0.6 / (30 * 0.56), 12);
    // Still never above the base, never below the floor.
    expect(fitSingleLineSizePct({ text, rect, baseSizePct: 0.05, textWidthEm: 5 })).toBe(0.05);
    expect(fitSingleLineSizePct({ text, rect, baseSizePct: 0.05, textWidthEm: 500 })).toBe(ptToPct(RULES_TEXT.hardFloorPt));
  });

  it("passes empty text through at base size", () => {
    expect(fitLine("")).toBe(0.0435);
    expect(
      fitSingleLineSizePct({ text: null, rect: M15_TYPE_RECT, baseSizePct: 0.03 }),
    ).toBe(0.03);
  });
});

describe("secondFaceLineSizes", () => {
  const aftermath = getFrameProfile("aftermath").secondFace!;
  const LONG_NAME = "Glorious Retribution of the Scorched Sky";
  const LONG_TYPE = "Legendary Sorcery — Arcane Lesson";
  const sizes = (slot: typeof aftermath, name: string, typeLine: string, cost: string | null) =>
    secondFaceLineSizes({ slot, name, typeLine, cost });

  const bar = aftermath.title.rect.widthPct / 100;
  const ratio = aftermath.costSizePct! / aftermath.title.sizePct;
  /** The name bar's length as the renderers lay it out: the name in
   *  Beleren's widths, the gap, and the cost row as the bake draws it. */
  const bandLength = (name: string, cost: string, s: ReturnType<typeof sizes>) =>
    displayTextEm(name) * s.titleSizePct +
    (cost ? NAME_COST_GAP_PCT + costRowWidthPct(cost, s.costSizePct) : 0);

  it("keeps the profile's sizes for a face that doesn't opt in (split, until TODO 4.21)", () => {
    for (const template of ["split"] as const) {
      const slot = getFrameProfile(template).secondFace!;
      expect(slot.fitLines).toBeFalsy();
      for (const cost of ["{3}{R}{R}", "{X}{X}{10}{W/U}{2/B}{B/P}{R}{G}{C}{S}"]) {
        expect(sizes(slot, LONG_NAME, LONG_TYPE, cost)).toEqual({
          titleSizePct: slot.title.sizePct,
          typeSizePct: slot.type.sizePct,
          costSizePct: slot.costSizePct ?? slot.title.sizePct,
          // Whole: its renderers' CSS ellipsis, as before.
          titleText: LONG_NAME,
          typeText: LONG_TYPE,
        });
      }
    }
  });

  it("flip: the upside-down creature fits its bars at the top half's M15 sizes (layout v32)", () => {
    const flip = getFrameProfile("flip");
    const slot = flip.secondFace!;
    expect(slot.fitLines).toBe(true);
    // The printed flip names keep full size; there is no second cost.
    expect(slot.costSizePct).toBeUndefined();
    expect(sizes(slot, "Kenzo the Hardhearted", "Legendary Creature — Samurai", null)).toEqual({
      titleSizePct: flip.title.sizePct,
      typeSizePct: flip.type.sizePct,
      costSizePct: slot.title.sizePct,
      titleText: "Kenzo the Hardhearted",
      typeText: "Legendary Creature — Samurai",
    });
    // A long name and type line shrink only as far as their bars need,
    // never below the 5 pt floor (they only ellipsized before v32).
    const s = sizes(slot, LONG_NAME + " of the Endless Night", LONG_TYPE + " Shaman Warrior", null);
    expect(s.titleSizePct).toBeLessThan(slot.title.sizePct);
    expect(s.typeSizePct).toBeLessThan(slot.type.sizePct);
    expect(Math.min(s.titleSizePct, s.typeSizePct)).toBeGreaterThanOrEqual(ptToPct(RULES_TEXT.hardFloorPt));
  });

  it("aftermath: the printed cards keep the top half's sizes — name, type line and cost", () => {
    expect(aftermath.fitLines).toBe(true);
    for (const [name, cost] of [
      ["Ribbons", "{X}{B}{B}"],
      ["Memory", "{4}{U}{U}"],
    ]) {
      expect(sizes(aftermath, name, "Sorcery", cost)).toEqual({
        titleSizePct: aftermath.title.sizePct,
        typeSizePct: aftermath.type.sizePct,
        costSizePct: aftermath.costSizePct,
        titleText: name,
        typeText: "Sorcery",
      });
    }
  });

  it("aftermath: a long name and type line shrink to fit their bars (floor: 5 pt)", () => {
    const { titleSizePct, typeSizePct } = sizes(aftermath, LONG_NAME, LONG_TYPE, "{3}{R}{R}");
    expect(titleSizePct).toBeLessThan(aftermath.title.sizePct);
    expect(typeSizePct).toBeLessThan(aftermath.type.sizePct);
    expect(Math.min(titleSizePct, typeSizePct)).toBeGreaterThanOrEqual(ptToPct(RULES_TEXT.hardFloorPt));
    // The type line shrinks only as far as Beleren's widths need.
    expect(displayTextEm(LONG_TYPE) * typeSizePct).toBeLessThanOrEqual(aftermath.type.rect.widthPct / 100);
    expect(displayTextEm(LONG_TYPE) * typeSizePct * 1.1).toBeGreaterThan(aftermath.type.rect.widthPct / 100);
  });

  it("aftermath: a name bar that doesn't fit shrinks as one — name and pips together", () => {
    // Fits alone at full size, not next to five pips: both shrink, by the
    // same factor, only as far as the bar needs.
    const name = "Second Half";
    expect(sizes(aftermath, name, "Sorcery", null).titleSizePct).toBe(aftermath.title.sizePct);
    const s = sizes(aftermath, name, "Sorcery", "{X}{X}{2}{B}{B}");
    expect(s.titleSizePct).toBeLessThan(aftermath.title.sizePct);
    expect(s.costSizePct / s.titleSizePct).toBeCloseTo(ratio, 10);
    expect(bandLength(name, "{X}{X}{2}{B}{B}", s)).toBeLessThanOrEqual(bar);
    expect(bandLength(name, "{X}{X}{2}{B}{B}", s) * 1.1).toBeGreaterThan(bar);
    // …with headroom on the name for the bake's whole-pixel font sizes (a
    // 5 pt name is 20.8 px at 750 and drawn at 21) and browser kerning.
    expect(bandLength(name, "{X}{X}{2}{B}{B}", s) + 0.04 * displayTextEm(name) * s.titleSizePct).toBeLessThanOrEqual(bar);
    expect(sizes(aftermath, name, "Sorcery", "{B}").titleSizePct).toBeGreaterThan(s.titleSizePct);
    // Measured in Beleren's own widths, not a flat guess per letter: of two
    // 11-letter names, the narrow one keeps full size, wide capitals shrink.
    const narrow = sizes(aftermath, "Illimitable", "Sorcery", "{2}{W}").titleSizePct;
    const wide = sizes(aftermath, "WMWMWMWMWMW", "Sorcery", "{2}{W}").titleSizePct;
    expect(narrow).toBe(aftermath.title.sizePct);
    expect(wide).toBeLessThan(narrow * 0.8);
  });

  it("aftermath: any cost stays on its bar, beside the name (up to the 64-character cap)", () => {
    const floor = ptToPct(RULES_TEXT.hardFloorPt);
    const names = ["Ox", "Many", "Ribbons", "Overgrown Tomb", "WRATH OF AGES", "WWWWWWWWWWWW", LONG_NAME, ""];
    for (let pips = 1; pips <= 21; pips += 1) {
      for (const cost of ["{R}".repeat(pips), "{2/B}".repeat(Math.min(pips, 12))]) {
        for (const name of names) {
          const s = sizes(aftermath, name, "Sorcery", cost);
          expect(s.titleSizePct).toBeGreaterThanOrEqual(floor);
          expect(s.costSizePct).toBeGreaterThan(0);
          if (s.titleSizePct > floor) {
            // Above the floor the whole bar — name, gap, pips — fits.
            expect(bandLength(name, cost, s)).toBeLessThanOrEqual(bar + 1e-12);
            expect(s.costSizePct / s.titleSizePct).toBeCloseTo(ratio, 10);
          } else {
            // At the floor the name ellipsizes, but the pips never leave
            // the bar and leave it a few letters (or all of a short name).
            const room = bar - NAME_COST_GAP_PCT - costRowWidthPct(cost, s.costSizePct);
            expect(room).toBeGreaterThanOrEqual(Math.min(displayTextEm(name), 1.9) * floor - 1e-12);
          }
        }
      }
    }
  });

  it("flip (layout v32): the upside-down name and type line fit their bars like aftermath's", () => {
    const flip = getFrameProfile("flip").secondFace!;
    expect(flip.fitLines).toBe(true);
    expect(flip.costSizePct).toBeUndefined(); // the flipped creature prints no cost
    // A printed flip name keeps the face's size; its type line, in the
    // MSE master's short bar beside the P/T (68 %W), shrinks only as far as
    // that bar needs at the M15 type size (until the CC re-source, 4.21).
    const ichiga = sizes(flip, "Ichiga, Who Topples Oaks", "Legendary Creature — Spirit Monk", null);
    expect(ichiga.titleSizePct).toBe(flip.title.sizePct);
    expect(ichiga.costSizePct).toBe(flip.title.sizePct);
    expect(ichiga.typeSizePct).toBeLessThan(flip.type.sizePct);
    expect(ichiga.typeSizePct).toBeGreaterThan(flip.type.sizePct * 0.9);
    expect(displayTextEm("Legendary Creature — Spirit Monk") * 1.05 * ichiga.typeSizePct).toBeCloseTo(
      flip.type.rect.widthPct / 100,
      10,
    );
    // …a name too long for its bar shrinks to it (measured, with the same
    // headroom as aftermath's), and never below the floor.
    const long = `${LONG_NAME} Rises`;
    const s = sizes(flip, long, LONG_TYPE, null);
    expect(s.titleSizePct).toBeLessThan(flip.title.sizePct);
    expect(s.titleSizePct).toBeGreaterThanOrEqual(ptToPct(RULES_TEXT.hardFloorPt));
    expect(displayTextEm(long) * 1.05 * s.titleSizePct).toBeCloseTo(flip.title.rect.widthPct / 100, 10);
  });

  it("floors at 5 pt of the CARD's orientation: a landscape face is not held at the portrait 5 pt (≈ 7 pt)", () => {
    const face = {
      title: { rect: { topPct: 7.4, leftPct: 53.5, widthPct: 41.4, heightPct: 5.5 }, sizePct: 0.0381 },
      type: { rect: { topPct: 56.3, leftPct: 53.5, widthPct: 40, heightPct: 4.2 }, sizePct: 0.0286 },
      costSizePct: 0.0344,
      fitLines: true,
    };
    const huge = "W".repeat(60);
    const portrait = secondFaceLineSizes({ slot: face, name: huge, typeLine: huge, cost: null });
    const landscape = secondFaceLineSizes({ slot: face, name: huge, typeLine: huge, cost: null, orientation: "landscape" });
    expect(portrait.titleSizePct).toBe(ptToPct(RULES_TEXT.hardFloorPt));
    expect(portrait.typeSizePct).toBe(ptToPct(RULES_TEXT.hardFloorPt));
    expect(landscape.titleSizePct).toBe(ptToPct(RULES_TEXT.hardFloorPt, "landscape"));
    expect(landscape.typeSizePct).toBe(ptToPct(RULES_TEXT.hardFloorPt, "landscape"));
    // The same absolute 5 pt on the physical card.
    expect(pctToPt(landscape.titleSizePct, "landscape")).toBeCloseTo(5, 10);
    // A line that fits is unaffected by the floor's orientation.
    expect(secondFaceLineSizes({ slot: face, name: "Fire", typeLine: "Instant", cost: "{1}{R}", orientation: "landscape" })).toEqual(
      secondFaceLineSizes({ slot: face, name: "Fire", typeLine: "Instant", cost: "{1}{R}" }),
    );
  });

  it("past the floor, cuts the name and the type line with ONE \"…\" that fits its bar at the bake's floor px", () => {
    const floor = ptToPct(RULES_TEXT.hardFloorPt);
    for (const [slot, cost] of [
      [aftermath, "{X}{X}{2}{B}{B}"],
      [getFrameProfile("flip").secondFace!, null],
    ] as const) {
      const name = "Unworthy Indignation of the Forsaken Hollow Cathedral Choir Eternal";
      const type = "Legendary Enchantment Creature — Phyrexian Human Cleric Warrior Rogue";
      const s = secondFaceLineSizes({ slot, name, typeLine: type, cost });
      expect(s.titleSizePct).toBe(floor);
      expect(s.typeSizePct).toBe(floor);
      for (const [text, whole] of [
        [s.titleText, name],
        [s.typeText, type],
      ] as const) {
        expect(text.endsWith("\u2026")).toBe(true);
        expect(whole.startsWith(text.slice(0, -1).trimEnd())).toBe(true);
      }
      const nameRoom = slot.title.rect.widthPct / 100 - (cost ? NAME_COST_GAP_PCT + costRowWidthPct(cost, s.costSizePct) : 0);
      for (const W of [750, 1500]) {
        const px = measuredLinePx(floor, slot.title.sizePct, W);
        expect(displayTextEm(s.titleText) * LINE_FIT_SAFETY * px).toBeLessThanOrEqual(nameRoom * W + 1e-9);
        expect(displayTextEm(s.typeText) * LINE_FIT_SAFETY * px).toBeLessThanOrEqual((slot.type.rect.widthPct / 100) * W);
      }
    }
  });

  it("costRowWidthPct measures a cost as the bake draws it", () => {
    expect(costRowWidthPct("", 0.05)).toBe(0);
    expect(costRowWidthPct(null, 0.05)).toBe(0);
    // n discs + (n − 1) pip gaps + the shadow, plus half a pixel (of the
    // 750 px bake) for every disc and gap the bake rounds.
    const d = 0.04;
    for (const n of [1, 3, 10]) {
      expect(costRowWidthPct("{R}".repeat(n), d)).toBeCloseTo(
        (n + (n - 1) * COST_PIP_GAP + 0.1) * d + ((2 * n - 1) * 0.5) / 750,
        10,
      );
    }
    // A cost typed without braces is drawn as small caps text, still measured.
    expect(costRowWidthPct("2BB", d)).toBeGreaterThan(0.8 * d);
    expect(costRowWidthPct("2BB", d)).toBeLessThan(costRowWidthPct("{2}{B}{B}", d));
  });
});

describe("fitTypeLine (TODO 4.20, layout v32)", () => {
  const FLOOR = ptToPct(RULES_TEXT.hardFloorPt);
  const LINES = [
    "",
    "Creature — Angel",
    "Legendary Creature — Human Shaman",
    "Legendary Artifact Creature — Phyrexian Golem",
    "Legendary Snow Artifact Creature — Phyrexian Golem Warrior",
  ];
  /** A profile's type slot on the measured fit, at the family's size. */
  const measured = (p: FrameProfile, over: Partial<FrameProfile> = {}): FrameProfile => ({
    ...p,
    ...over,
    type: { ...p.type, sizePct: TYPE_SIZE_PCT, fit: "measured" },
  });
  const M15 = measured(getFrameProfile("m15"), { symbolSizePct: 0.0574 });

  it("keeps the old estimate, byte for byte, on every slot without the flag", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(template);
      if (p.type.fit === "measured") continue;
      for (const text of LINES) {
        for (const symbolWidthPct of [null, 0, 0.05, 0.2]) {
          expect(fitTypeLine({ layout: p, text, symbolWidthPct }), `${template} ${text}`).toBe(
            fitSingleLineSizePct({
              text,
              rect: p.type.rect,
              baseSizePct: p.type.sizePct,
              reservedPct: p.symbolRect ? 0 : (p.symbolSizePct ?? p.type.sizePct * 1.1) * 1.3,
            }),
          );
        }
      }
    }
  });

  it("measures the line against the room before the set symbol's ink as drawn, a print's gap clear", () => {
    const symbol = 0.0574;
    // Up to TYPE_SYMBOL_GAP_PCT before the symbol's ink: its drawn width
    // less its side bearing (an icon or the mark: none).
    expect(typeLineRoomPct(M15, symbol)).toBeCloseTo(M15.type.rect.widthPct / 100 - TYPE_SYMBOL_GAP_PCT - symbol, 12);
    expect(typeLineRoomPct(M15, symbol, 0.003)).toBeCloseTo(
      M15.type.rect.widthPct / 100 - TYPE_SYMBOL_GAP_PCT - (symbol - 0.003),
      12,
    );
    // Both renderers pull the inline symbol over the band gap by the
    // difference, so the band's flex room is exactly that.
    expect(inlineSymbolPullPct(M15, { drawnWidthPct: symbol, inkLeftPct: 0.003 })).toBeCloseTo(
      BAND_GAP_PCT - TYPE_SYMBOL_GAP_PCT + 0.003,
      12,
    );
    // A line that fits keeps the family's size…
    expect(fitTypeLine({ layout: M15, text: "Legendary Creature — Elf Warrior", symbolWidthPct: symbol })).toBe(TYPE_SIZE_PCT);
    // …a long one shrinks only as far as its measured width needs.
    const long = LINES[3];
    const size = fitTypeLine({ layout: M15, text: long, symbolWidthPct: symbol });
    expect(size).toBeLessThan(TYPE_SIZE_PCT);
    expect(slotLineEm(long, M15.type) * MEASURED_LINE_FIT_SAFETY * size).toBeCloseTo(typeLineRoomPct(M15, symbol), 12);
    // A wider symbol leaves less room.
    expect(fitTypeLine({ layout: M15, text: long, symbolWidthPct: 0.1 })).toBeLessThan(size);
    // Longer text never prints larger; never below the floor.
    expect(fitTypeLine({ layout: M15, text: LINES[4], symbolWidthPct: symbol })).toBeLessThan(size);
    expect(fitTypeLine({ layout: M15, text: "W".repeat(200), symbolWidthPct: symbol })).toBe(FLOOR);
    expect(fitTypeLine({ layout: M15, text: "", symbolWidthPct: symbol })).toBe(TYPE_SIZE_PCT);
  });

  it("cuts a line too long even at the floor with ONE \"…\" that ends before the symbol at the bake's floor px", () => {
    const symbol = 0.0574;
    const line = "Legendary Snow Artifact Enchantment Creature — Phyrexian Human Elf Wizard Warrior Rogue Advisor";
    const fit = fitTypeLineBand({ layout: M15, text: line, symbolWidthPct: symbol });
    expect(fit.sizePct).toBe(FLOOR);
    expect(fit.text.endsWith("\u2026")).toBe(true);
    expect(line.startsWith(fit.text.slice(0, -1))).toBe(true);
    expect(fit.widthPct).toBeCloseTo(typeLineRoomPct(M15, symbol), 12);
    // At the floor's whole px in either bake (measuredLinePx: never below it)
    // the cut line still fits the room, so neither renderer's ellipsis moves.
    for (const W of [750, 1500]) {
      const px = measuredLinePx(fit.sizePct, TYPE_SIZE_PCT, W);
      expect(px, String(W)).toBe(Math.round(FLOOR * W));
      expect(px / W, String(W)).toBeGreaterThanOrEqual(ptToPct(4.95));
      expect(slotLineEm(fit.text, M15.type) * MEASURED_LINE_FIT_SAFETY * px, String(W)).toBeLessThanOrEqual(fit.widthPct! * W);
    }
    // A line that fits is never cut; the old path never is either.
    expect(fitTypeLineBand({ layout: M15, text: LINES[3], symbolWidthPct: symbol }).text).toBe(LINES[3]);
    const old = getFrameProfile("modern");
    expect(fitTypeLineBand({ layout: old, text: line, symbolWidthPct: symbol })).toEqual({
      sizePct: fitTypeLine({ layout: old, text: line, symbolWidthPct: symbol }),
      text: line,
      widthPct: null,
    });
  });

  it("sets a measured line's bake px at the whole px below its fit, never below the floor's, and rounds a line that fits", () => {
    for (const W of [750, 1500]) {
      expect(measuredLinePx(TYPE_SIZE_PCT, TYPE_SIZE_PCT, W)).toBe(Math.round(TYPE_SIZE_PCT * W));
      expect(measuredLinePx(0.04, TYPE_SIZE_PCT, W)).toBe(Math.floor(0.04 * W));
      expect(measuredLinePx(FLOOR, TYPE_SIZE_PCT, W)).toBe(Math.round(FLOOR * W));
      // Landscape floors at its own 5 pt.
      const lf = ptToPct(RULES_TEXT.hardFloorPt, "landscape");
      expect(measuredLinePx(lf, 0.0381, W, "landscape")).toBe(Math.round(lf * W));
    }
  });

  it("shows a shrunk measured line in the preview at the stored HD bake's whole px", async () => {
    const { RENDER_PRESETS } = await import("@/lib/render/card-image");
    const hd = RENDER_PRESETS.hd.width;
    // Full size: the slot's own size, untouched.
    expect(measuredLinePreviewPct(TYPE_SIZE_PCT, TYPE_SIZE_PCT)).toBe(TYPE_SIZE_PCT);
    for (const fit of [0.0421, 0.03, FLOOR]) {
      const shown = measuredLinePreviewPct(fit, TYPE_SIZE_PCT);
      expect(shown * hd).toBeCloseTo(measuredLinePx(fit, TYPE_SIZE_PCT, hd), 9);
      expect(Math.round(shown * hd)).toBe(measuredLinePx(fit, TYPE_SIZE_PCT, hd));
    }
    // A landscape card's stored bake is 2100 wide (the swapped preset).
    const lf = ptToPct(RULES_TEXT.hardFloorPt, "landscape");
    expect(measuredLinePreviewPct(lf, 0.0381, "landscape") * RENDER_PRESETS.hd.height).toBeCloseTo(
      measuredLinePx(lf, 0.0381, RENDER_PRESETS.hd.height, "landscape"),
      9,
    );
  });

  it("shrinks less than the old estimate where the line really fits (no 0.56 em guess, no box × 1.3)", () => {
    const line = "Legendary Creature — Elf Warrior";
    const old = fitSingleLineSizePct({
      text: line,
      rect: M15.type.rect,
      baseSizePct: TYPE_SIZE_PCT,
      reservedPct: 0.0574 * 1.3,
    });
    expect(old).toBeLessThan(TYPE_SIZE_PCT);
    expect(fitTypeLine({ layout: M15, text: line, symbolWidthPct: 0.0574 })).toBe(TYPE_SIZE_PCT);
  });

  it("stops before a symbolRect that overlaps the band (the planeswalker's), which the old fit ignored", () => {
    const pw = measured(getFrameProfile("m15pw"), {
      type: getFrameProfile("m15").type,
      symbolSizePct: 0.0533,
    });
    const box = pw.symbolRect!;
    const symbol = 0.0533;
    const symbolLeft = (box.leftPct + box.widthPct) / 100 - symbol;
    expect(typeLineRoomPct(pw, symbol)).toBeCloseTo(symbolLeft - TYPE_SYMBOL_GAP_PCT - pw.type.rect.leftPct / 100, 12);
    const line = "Legendary Planeswalker — Reformed Agent Explorer";
    const size = fitTypeLine({ layout: pw, text: line, symbolWidthPct: symbol });
    expect(size).toBeLessThan(TYPE_SIZE_PCT);
    // Its measured end sits the print's gap before the symbol's drawn ink.
    expect(pw.type.rect.leftPct / 100 + slotLineEm(line, pw.type) * MEASURED_LINE_FIT_SAFETY * size + TYPE_SYMBOL_GAP_PCT).toBeCloseTo(
      symbolLeft,
      12,
    );
    // No pull: the symbol is not in the band.
    expect(inlineSymbolPullPct(pw, { drawnWidthPct: symbol, inkLeftPct: 0 })).toBe(0);
    // A symbolRect clear of the band reserves nothing but the bake's filler gap.
    const clear = { ...pw, symbolRect: { ...box, topPct: 90 } };
    expect(typeLineRoomPct(clear, symbol)).toBeCloseTo(pw.type.rect.widthPct / 100 - BAND_GAP_PCT, 12);
  });

  it("gives a centred line with no symbol its whole band, and a start-aligned one the band less the filler's gap", () => {
    // A centred measured band with the symbol inline (the tokens' through
    // layout v33, before TODO 4.49 (d)): the symbol and the gap beside it.
    const centred = { type: { ...M15.type, align: "center" as const, rect: { topPct: 82.14, leftPct: 11, widthPct: 78, heightPct: 4.2 } } };
    expect(typeLineRoomPct(centred, 0.05)).toBeCloseTo(0.78 - BAND_GAP_PCT - 0.05, 12);
    // No symbol drawn (the adventure panel): the bake's filler takes a gap
    // on a start-aligned band, nothing on a centred one.
    expect(typeLineRoomPct({ type: M15.type }, null)).toBeCloseTo(M15.type.rect.widthPct / 100 - BAND_GAP_PCT, 12);
    expect(typeLineRoomPct(centred, null)).toBeCloseTo(0.78, 12);
  });

  it("runs the 2014–19 token's left-aligned line up to its right-anchored symbol's ink (TODO 4.49 (d))", () => {
    for (const template of ["m15token", "m15tokenartifact"] as const) {
      const token = getFrameProfile(template);
      expect(token.type.align, template).toBeUndefined();
      expect(token.type.rect.leftPct).toBe(8.54);
      const box = token.symbolRect!;
      expect(box.leftPct + box.widthPct).toBeCloseTo(92.13, 9);
      expect(box.topPct + box.heightPct / 2).toBeCloseTo(84.78, 9);
      // The band reaches the box's right edge; the line stops the print's
      // gap before the symbol's drawn ink (an 86 px box's worth here).
      expect(token.type.rect.leftPct + token.type.rect.widthPct).toBeCloseTo(92.13, 9);
      const symbol = 0.0574;
      expect(typeLineRoomPct(token, symbol)).toBeCloseTo(0.9213 - symbol - TYPE_SYMBOL_GAP_PCT - 0.0854, 12);
      expect(inlineSymbolPullPct(token, { drawnWidthPct: symbol, inkLeftPct: 0 })).toBe(0);
    }
  });

  it("floors at 5 pt of the card's orientation, and never grows a slot set below it", () => {
    const land = measured(getFrameProfile("m15"));
    const landscapeFloor = ptToPct(RULES_TEXT.hardFloorPt, "landscape");
    expect(fitTypeLine({ layout: land, text: "W".repeat(200), symbolWidthPct: 0.05, orientation: "landscape" })).toBe(landscapeFloor);
    // The old fit clamps a small landscape slot UP to the portrait floor
    // (battle's and split's type lines print at 58 px today); the measured
    // one keeps the slot's size.
    const small = { ...land, type: { ...land.type, sizePct: 0.02 } };
    expect(fitSingleLineSizePct({ text: "Instant", rect: small.type.rect, baseSizePct: 0.02 })).toBe(FLOOR);
    expect(fitTypeLine({ layout: small, text: "Instant", symbolWidthPct: 0.05, orientation: "landscape" })).toBe(0.02);
  });

  it("reserves the symbol as the set-symbol helper draws it — per source, per glyph", () => {
    // Both renderers pass setSymbolSize(layout, source).drawnWidthPct: the
    // mark and an icon are the box wide; a Keyrune glyph its advance at its
    // fitted font size, so a wide glyph (M20) leaves the line less room.
    const m15 = getFrameProfile("m15");
    const mark = setSymbolSize(m15, setSymbolSource(null, null)).drawnWidthPct;
    const icon = setSymbolSize(m15, setSymbolSource("https://x.test/i.png", "dom")).drawnWidthPct;
    const m20 = setSymbolSize(m15, setSymbolSource(null, "m20")).drawnWidthPct;
    expect(mark).toBe(m15.symbolSizePct);
    expect(icon).toBe(mark);
    expect(m20).toBeGreaterThan(mark);
    expect(typeLineRoomPct(m15, m20)).toBeCloseTo(typeLineRoomPct(m15, mark) - (m20 - mark), 12);
    const long = LINES[3];
    expect(fitTypeLine({ layout: m15, text: long, symbolWidthPct: m20 })).toBeLessThan(
      fitTypeLine({ layout: m15, text: long, symbolWidthPct: mark }),
    );
  });
});

describe("displayTextEm", () => {
  it("sums Beleren's advance widths (em)", () => {
    expect(displayTextEm("")).toBe(0);
    expect(displayTextEm(null)).toBe(0);
    expect(displayTextEm("W")).toBeCloseTo(0.9, 10);
    expect(displayTextEm("i")).toBeCloseTo(0.295, 10);
    expect(displayTextEm("Wi")).toBeCloseTo(displayTextEm("W") + displayTextEm("i"), 10);
    // Accents take the base letter's width; the type line's dash is listed.
    expect(displayTextEm("é")).toBe(displayTextEm("e"));
    expect(displayTextEm("—")).toBeCloseTo(0.831, 10);
  });
});
