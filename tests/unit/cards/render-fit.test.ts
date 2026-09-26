import { describe, expect, it } from "vitest";
import {
  COST_PIP_GAP,
  NAME_COST_GAP_PCT,
  costRowWidthPct,
  fitRulesSizePct,
  fitSingleLineSizePct,
  rulesSizeLadder,
  secondFaceLineSizes,
} from "@/lib/cards/render-tiers";
import { displayTextEm } from "@/lib/cards/display-metrics";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RULES_TEXT, pctToPt, ptToPct } from "@/lib/cards/typography";

// The m15 rules slot — the most common case.
const M15_RULES = {
  rect: { topPct: 63.4, leftPct: 8.5, widthPct: 83, heightPct: 28.0 },
  baseSizePct: ptToPct(RULES_TEXT.standardPt),
  aspect: 7 / 5,
};
const HARD_FLOOR = ptToPct(RULES_TEXT.hardFloorPt);

const fit = (rulesText: string, flavorText: string | null = null) =>
  fitRulesSizePct({ rulesText, flavorText, ...M15_RULES });

describe("fitRulesSizePct", () => {
  it("returns the authentic base size for short text (no premature shrink)", () => {
    expect(fit("Trample")).toBe(M15_RULES.baseSizePct);
    expect(fit("")).toBe(M15_RULES.baseSizePct);
  });

  it("shrinks as text grows, never below the floor", () => {
    const sentence =
      "Whenever this creature attacks, draw a card and gain 1 life. ";
    let last = Number.POSITIVE_INFINITY;
    for (const repeats of [1, 4, 8, 16, 40]) {
      const size = fit(sentence.repeat(repeats));
      expect(size).toBeLessThanOrEqual(last);
      expect(size).toBeGreaterThanOrEqual(HARD_FLOOR - 1e-9);
      last = size;
    }
    expect(last).toBeLessThan(M15_RULES.baseSizePct);
  });

  it("is deterministic (preview and bake must agree)", () => {
    const text = "Flying, vigilance\n{T}: Add {G}{G}.\nLandfall — draw a card.";
    expect(fit(text, "A coil of fire.")).toBe(fit(text, "A coil of fire."));
  });

  it("counts flavor text against the box", () => {
    const rules = "Whenever this creature attacks, draw a card. ".repeat(6);
    const withFlavor = fit(rules, "The mountain answered with fire. ".repeat(4));
    expect(withFlavor).toBeLessThanOrEqual(fit(rules));
  });

  it("treats explicit line breaks as separate paragraphs", () => {
    const oneLine = fit("Flying. Haste. Trample. Vigilance. Reach. Menace.");
    const manyLines = fit("Flying\nHaste\nTrample\nVigilance\nReach\nMenace");
    expect(manyLines).toBeLessThanOrEqual(oneLine);
  });

  it("respects landscape aspect (battle frames)", () => {
    const battle = fitRulesSizePct({
      rulesText: "When this Siege enters, search your library. ".repeat(6),
      flavorText: null,
      rect: { topPct: 67.5, leftPct: 13, widthPct: 80, heightPct: 25 },
      baseSizePct: ptToPct(8, "landscape"),
      aspect: 5 / 7,
    });
    expect(battle).toBeGreaterThanOrEqual(ptToPct(RULES_TEXT.hardFloorPt, "landscape") - 1e-9);
    expect(battle).toBeLessThanOrEqual(ptToPct(8, "landscape"));
  });
});

describe("rulesSizeLadder", () => {
  it("steps down from 9 pt in half points through the 7.5 pt floor to the hard floor", () => {
    const ladder = rulesSizeLadder(ptToPct(9), 7 / 5).map((pct) => Math.round(pctToPt(pct) * 10) / 10);
    expect(ladder.slice(0, 4)).toEqual([9, 8.5, 8, 7.5]);
    expect(ladder[ladder.length - 1]).toBe(RULES_TEXT.hardFloorPt);
    expect(ladder).toContain(7);
  });

  it("measures the step against the landscape width for landscape frames", () => {
    const [base, next] = rulesSizeLadder(ptToPct(8, "landscape"), 5 / 7);
    expect(pctToPt(base - next, "landscape")).toBeCloseTo(RULES_TEXT.stepPt, 6);
  });

  it("uses the standard as the M15 base size", () => {
    expect(fit("Trample")).toBeCloseTo(0.05, 6); // 9 pt on a 2.5 in card
  });
});

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

  it("keeps the profile's sizes for a face that doesn't opt in (flip, split)", () => {
    for (const template of ["flip", "split"] as const) {
      const slot = getFrameProfile(template).secondFace!;
      expect(slot.fitLines).toBeFalsy();
      for (const cost of ["{3}{R}{R}", "{X}{X}{10}{W/U}{2/B}{B/P}{R}{G}{C}{S}"]) {
        expect(sizes(slot, LONG_NAME, LONG_TYPE, cost)).toEqual({
          titleSizePct: slot.title.sizePct,
          typeSizePct: slot.type.sizePct,
          costSizePct: slot.costSizePct ?? slot.title.sizePct,
        });
      }
    }
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
