import { describe, expect, it } from "vitest";
import { fitRulesSizePct, fitSingleLineSizePct } from "@/lib/cards/render-tiers";

// The m15 rules slot — the most common case.
const M15_RULES = {
  rect: { topPct: 63.4, leftPct: 8.5, widthPct: 83, heightPct: 28.0 },
  baseSizePct: 0.0373,
  lineHeight: 1.32,
  aspect: 7 / 5,
};

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
      expect(size).toBeGreaterThanOrEqual(0.015);
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
      baseSizePct: 0.028,
      lineHeight: 1.3,
      aspect: 5 / 7,
    });
    expect(battle).toBeGreaterThanOrEqual(0.015);
    expect(battle).toBeLessThanOrEqual(0.028);
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
    expect(long).toBeGreaterThanOrEqual(0.015);
  });

  it("longer text never gets a larger size", () => {
    expect(fitLine("Legendary Creature — Dragon Wizard Noble")).toBeLessThanOrEqual(
      fitLine("Creature — Dragon"),
    );
  });

  it("passes empty text through at base size", () => {
    expect(fitLine("")).toBe(0.0435);
    expect(
      fitSingleLineSizePct({ text: null, rect: M15_TYPE_RECT, baseSizePct: 0.03 }),
    ).toBe(0.03);
  });
});
