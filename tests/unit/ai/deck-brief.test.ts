import { describe, expect, it } from "vitest";
import { buildDeckBrief, deckCardLines, dominantColors } from "@/lib/ai/deck-brief";
import type { DeckAnalytics } from "@/lib/decks/analytics";

function analytics(over: Partial<DeckAnalytics> = {}): DeckAnalytics {
  return {
    byBoard: { main: 60, side: 0, maybe: 0, commander: 0, companion: 0 },
    total: 60,
    remixed: 0,
    curve: [2, 8, 10, 9, 5, 2, 1, 0],
    byColor: { W: 0, U: 30, B: 0, R: 4, G: 0, C: 0 },
    byType: { Battle: 0, Planeswalker: 1, Creature: 26, Instant: 6, Sorcery: 4, Artifact: 0, Enchantment: 0, Land: 23, Other: 0 },
    lands: 23,
    averageManaValue: 2.7,
    ...over,
  };
}

describe("deck brief — what the deck-aware designer is told", () => {
  it("finds the deck's main colors and ignores a splash", () => {
    expect(dominantColors({ W: 0, U: 30, B: 0, R: 4, G: 0, C: 0 })).toEqual(["U"]);
    expect(dominantColors({ W: 12, U: 0, B: 0, R: 0, G: 11, C: 0 })).toEqual(["W", "G"]);
    expect(dominantColors({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 5 })).toEqual([]);
  });

  it("hints the frame color only for a mono-colored deck", () => {
    expect(buildDeckBrief({ title: "Tempo", description: null, format: "modern", cards: [], analytics: analytics() }).colorHint).toBe("blue");
    expect(
      buildDeckBrief({
        title: "Selesnya", description: null, format: "commander", cards: [],
        analytics: analytics({ byColor: { W: 20, U: 0, B: 0, R: 0, G: 18, C: 0 } }),
      }).colorHint,
    ).toBeUndefined();
  });

  it("briefs identity, curve, type mix, singleton rule and the card list", () => {
    const brief = buildDeckBrief({
      title: "Mono Blue Tempo",
      description: "counter and swing",
      format: "commander",
      cards: [
        { name: "Sky Prowler", type_line: "Creature — Bird", rules_text: "Flying" },
        { name: "Refuse", type_line: "Instant", rules_text: "Counter target spell." },
      ],
      analytics: analytics({ total: 100, byBoard: { main: 99, side: 0, maybe: 0, commander: 1, companion: 0 } }),
    });
    expect(brief.context).toContain('FOR the deck "Mono Blue Tempo" — counter and swing (commander format, 100 cards)');
    expect(brief.context).toContain("Color identity: blue. The new card MUST stay inside this identity.");
    expect(brief.context).toContain("The curve is thinnest at 4 mana.");
    expect(brief.context).toContain("Type mix: Planeswalker 1, Creature 26, Instant 6, Sorcery 4, Land 23; lands 23.");
    expect(brief.context).toContain("creature-heavy");
    expect(brief.context).toContain("Singleton format");
    expect(brief.context).toContain("- Sky Prowler (Creature — Bird) — Flying");
    expect(brief.context).toContain("NEVER reuse one of the deck's card names");
  });

  it("caps the card list and flattens rules text", () => {
    const cards = Array.from({ length: 130 }, (_, i) => ({ name: `Card ${i}`, type_line: null, rules_text: "a\nb" }));
    const lines = deckCardLines(cards).split("\n");
    expect(lines).toHaveLength(120);
    expect(lines[0]).toBe("- Card 0 — a / b");
  });
});
