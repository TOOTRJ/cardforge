import { describe, expect, it } from "vitest";
import { buildDeckReportPdf, pdfSafe } from "@/lib/decks/deck-report-pdf";
import type { DeckAnalytics } from "@/lib/decks/analytics";

const analytics: DeckAnalytics = {
  byBoard: { commander: 1, companion: 0, main: 59, side: 0, maybe: 0 },
  total: 60,
  remixed: 3,
  curve: [0, 8, 12, 10, 6, 3, 1, 1],
  byColor: { W: 0, U: 0, B: 30, R: 0, G: 25, C: 5 },
  byType: { Battle: 0, Planeswalker: 0, Creature: 24, Instant: 4, Sorcery: 6, Artifact: 2, Enchantment: 3, Land: 21, Other: 0 },
  lands: 21,
  averageManaValue: 2.9,
};

describe("pdfSafe", () => {
  it("keeps WinAnsi punctuation and strips glyphs Helvetica can't draw", () => {
    expect(pdfSafe("Gorgon’s Gaze — 3/3 🐍 “stone”")).toBe("Gorgon’s Gaze — 3/3 “stone”");
    expect(pdfSafe("a‑b")).toBe("a-b");
  });
});

describe("buildDeckReportPdf", () => {
  it("builds a multi-section PDF with stats, guide, combos and the decklist", async () => {
    const bytes = await buildDeckReportPdf({
      title: "Gorgon Gaze",
      description: "Petrify everything, then swing.",
      formatLabel: "Commander",
      deckTypeLabel: "Gorgons deck",
      bracketLabel: "Bracket 2 · Core",
      ownerName: "e2e",
      url: "https://pipglyph.com/deck/gorgon-gaze",
      analytics,
      entries: [
        { name: "Stone Matriarch", quantity: 1, board: "commander", type_line: "Legendary Creature — Gorgon", mana_cost: "{2}{B}{G}", proxyTitle: null },
        { name: "Forest", quantity: 10, board: "main", type_line: "Basic Land — Forest", mana_cost: null },
        { name: "Swamp", quantity: 11, board: "main", type_line: "Basic Land — Swamp", mana_cost: null },
        ...Array.from({ length: 38 }, (_, i) => ({
          name: `Petrifying Glance ${i + 1}`,
          quantity: 1,
          board: "main" as const,
          type_line: "Instant",
          mana_cost: "{1}{B}",
          proxyTitle: i < 3 ? `Custom ${i + 1}` : null,
        })),
      ],
      guide: {
        overview: "A midrange deck that grinds with deathtouch and reanimation.",
        game_plan: ["Ramp on turns one to three.", "Deploy Gorgons and hold up removal.", "Close with an overrun or the Matriarch."],
        mulligan: "Keep two lands and a ramp spell.",
        combos: [{ cards: ["Stone Matriarch", "Petrifying Glance 1"], description: "Deathtouch plus fight removes any blocker." }],
        weaknesses: "Board wipes and graveyard hate.",
        key_cards: ["Stone Matriarch"],
      },
    });
    expect(bytes.byteLength).toBeGreaterThan(2000);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("works without a guide or description", async () => {
    const bytes = await buildDeckReportPdf({
      title: "Bare bones",
      description: null,
      formatLabel: "Casual",
      deckTypeLabel: null,
      bracketLabel: null,
      ownerName: null,
      url: null,
      analytics: { ...analytics, averageManaValue: null },
      entries: [{ name: "Island", quantity: 4, board: "main", type_line: null, mana_cost: null }],
      guide: null,
    });
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });
});
