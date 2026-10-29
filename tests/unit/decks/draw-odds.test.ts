import { describe, expect, it } from "vitest";
import {
  cardOddsByTurn,
  cardsSeenByTurn,
  formatOdds,
  hypergeometricAtLeast,
  hypergeometricExactly,
  landOddsTable,
} from "@/lib/decks/draw-odds";

// ---------------------------------------------------------------------------
// The draw odds (TODO DK7.2): the hypergeometric distribution against values
// worked by hand from the binomial coefficients, and the cards seen by turn.
// ---------------------------------------------------------------------------

/** C(n, k) as an exact integer (small n). */
function choose(n: number, k: number): number {
  let out = 1;
  for (let i = 1; i <= k; i += 1) out = (out * (n - k + i)) / i;
  return Math.round(out);
}

describe("hypergeometric odds", () => {
  it("a 60-card deck with 24 lands: a landless seven is C(36,7) / C(60,7)", () => {
    // C(36,7) = 8,347,680 and C(60,7) = 386,206,920.
    expect(choose(36, 7)).toBe(8_347_680);
    expect(choose(60, 7)).toBe(386_206_920);
    expect(hypergeometricExactly(60, 24, 7, 0)).toBeCloseTo(8_347_680 / 386_206_920, 12);
    expect(hypergeometricAtLeast(60, 24, 7, 1)).toBeCloseTo(1 - 8_347_680 / 386_206_920, 12); // 97.84 %
  });

  it("four copies in 60: at least one in the opening seven is 39.95 %", () => {
    // 1 − C(56,7) / C(60,7) = 1 − 231,917,400 / 386,206,920.
    expect(choose(56, 7)).toBe(231_917_400);
    expect(hypergeometricAtLeast(60, 4, 7, 1)).toBeCloseTo(1 - 231_917_400 / 386_206_920, 12);
    expect(formatOdds(hypergeometricAtLeast(60, 4, 7, 1))).toBe("40%");
  });

  it("the exact odds of every count sum to 1, and match the coefficients", () => {
    let sum = 0;
    for (let k = 0; k <= 7; k += 1) {
      const p = hypergeometricExactly(99, 37, 7, k);
      expect(p).toBeCloseTo((choose(37, k) * choose(62, 7 - k)) / choose(99, 7), 10);
      sum += p;
    }
    expect(sum).toBeCloseTo(1, 12);
  });

  it("impossible counts are 0; 'at least 0' is certain; a library of lands is certain", () => {
    expect(hypergeometricExactly(60, 4, 7, 5)).toBe(0); // only four copies
    expect(hypergeometricExactly(10, 9, 7, 5)).toBe(0); // only one non-hit: at least six hits
    expect(hypergeometricAtLeast(60, 0, 7, 1)).toBe(0);
    expect(hypergeometricAtLeast(60, 24, 7, 0)).toBe(1);
    expect(hypergeometricAtLeast(40, 40, 7, 7)).toBe(1);
    expect(hypergeometricAtLeast(0, 0, 7, 1)).toBe(0);
  });

  it("stays exact for a big library (no overflow)", () => {
    const p = hypergeometricAtLeast(250, 100, 20, 5);
    expect(p).toBeGreaterThan(0.9);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe("cards seen by turn", () => {
  it("the opening seven plus a draw a turn — the first skipped on the play", () => {
    expect(cardsSeenByTurn(1, true)).toBe(7);
    expect(cardsSeenByTurn(1, false)).toBe(8);
    expect(cardsSeenByTurn(3, true)).toBe(9);
    expect(cardsSeenByTurn(3, false)).toBe(10);
  });

  it("never past the library", () => {
    expect(cardsSeenByTurn(7, false, 10)).toBe(10);
  });
});

describe("the tables", () => {
  it("lands by turn: each row's odds fall as the land count rises, and rise turn by turn", () => {
    const table = landOddsTable(60, 24, { onThePlay: true });
    expect(table).toHaveLength(7);
    expect(table[0]).toMatchObject({ turn: 1, seen: 7 });
    expect(table[0].odds[0]).toBeCloseTo(hypergeometricAtLeast(60, 24, 7, 1), 12);
    for (const row of table) {
      for (let i = 1; i < row.odds.length; i += 1) expect(row.odds[i]).toBeLessThanOrEqual(row.odds[i - 1]);
    }
    for (let t = 1; t < table.length; t += 1) expect(table[t].odds[2]).toBeGreaterThan(table[t - 1].odds[2]);
    // On the draw sees one card more.
    expect(landOddsTable(60, 24, { onThePlay: false })[0].seen).toBe(8);
  });

  it("a card by turn: four copies, on the play", () => {
    const rows = cardOddsByTurn(60, 4, { onThePlay: true, turns: 3 });
    expect(rows.map((row) => row.seen)).toEqual([7, 8, 9]);
    expect(rows[2].odds).toBeCloseTo(1 - choose(56, 9) / choose(60, 9), 12);
  });
});

describe("formatOdds", () => {
  it("never rounds a near-certainty to a certainty", () => {
    expect(formatOdds(0)).toBe("0%");
    expect(formatOdds(0.004)).toBe("<1%");
    expect(formatOdds(0.4)).toBe("40%");
    expect(formatOdds(0.996)).toBe(">99%");
    expect(formatOdds(1)).toBe("100%");
  });
});
