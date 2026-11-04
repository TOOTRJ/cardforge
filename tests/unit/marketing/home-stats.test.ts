import { describe, expect, it } from "vitest";

import {
  DECKS_BADGE_MIN,
  formatStatCount,
  formatStatNumber,
  homeStatBadges,
  type HomeCounts,
} from "@/lib/marketing/home-stats";

// ---------------------------------------------------------------------------
// The home page's numbers (owner 2026-11-03: all time, not this week). The
// badges are real counts only — no "∞ Possibilities" — and a short form's
// "+" is always true.
// ---------------------------------------------------------------------------

const counts = (overrides: Partial<HomeCounts> = {}): HomeCounts => ({
  cards: 1308,
  creators: 76,
  decks: 37,
  frameStyles: 24,
  cardsThisWeek: 63,
  ...overrides,
});

describe("formatStatCount", () => {
  it("keeps numbers under 1,000 as they are", () => {
    expect(formatStatCount(0)).toBe("0");
    expect(formatStatCount(76)).toBe("76");
    expect(formatStatCount(999)).toBe("999");
  });

  it("rounds DOWN past 1,000, so the + is never a lie", () => {
    expect(formatStatCount(1000)).toBe("1K+");
    expect(formatStatCount(1308)).toBe("1.3K+");
    expect(formatStatCount(1950)).toBe("1.9K+");
    expect(formatStatCount(1999)).toBe("1.9K+");
    expect(formatStatCount(25_049)).toBe("25K+");
    expect(formatStatCount(1_250_000)).toBe("1.2M+");
  });

  it("never prints a negative or a NaN", () => {
    expect(formatStatCount(-4)).toBe("0");
    expect(formatStatCount(Number.NaN)).toBe("0");
  });
});

describe("formatStatNumber", () => {
  it("groups thousands for running text", () => {
    expect(formatStatNumber(1308)).toBe("1,308");
    expect(formatStatNumber(63)).toBe("63");
  });
});

describe("homeStatBadges", () => {
  it("shows the four real numbers, best first", () => {
    expect(homeStatBadges(counts())).toEqual([
      { value: "1.3K+", label: "Cards forged" },
      { value: "76", label: "Creators" },
      { value: "37", label: "Decks built" },
      { value: "24", label: "Frame styles" },
    ]);
  });

  it("holds the decks badge back until there are enough decks", () => {
    const labels = homeStatBadges(counts({ decks: DECKS_BADGE_MIN - 1 })).map((b) => b.label);
    expect(labels).toEqual(["Cards forged", "Creators", "Frame styles", "Every frame"]);
    expect(homeStatBadges(counts({ decks: DECKS_BADGE_MIN })).map((b) => b.label)).toContain("Decks built");
  });

  it("never shows a zero or filler beyond the one fallback", () => {
    const badges = homeStatBadges(counts({ cards: 0, creators: 0, decks: 0, frameStyles: 0 }));
    expect(badges).toEqual([{ value: "Free", label: "Every frame" }]);
    for (const badge of homeStatBadges(counts())) {
      expect(badge.value).not.toBe("∞");
      expect(badge.label).not.toMatch(/possibilit|mana identit/i);
    }
  });

  it("says Creator for one", () => {
    expect(homeStatBadges(counts({ creators: 1 }))[1]).toEqual({ value: "1", label: "Creator" });
  });
});
