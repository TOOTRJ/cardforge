import type { DeckAnalytics } from "@/lib/decks/analytics";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// Deck brief — what the single-card designer is told when a card is being
// made FOR a deck (the Pro "design a card for this deck" option in the
// creator's AI dialog). Pure: takes the deck's header, its card lines and
// computeDeckAnalytics() output and returns prose for the design prompt plus
// a color hint. Unit-tested; the prompt wording lives here, not in the job.
// ---------------------------------------------------------------------------

export type DeckBriefCard = {
  name: string;
  type_line: string | null;
  rules_text: string | null;
};

export type DeckBriefInput = {
  title: string;
  description: string | null;
  format: string;
  cards: DeckBriefCard[];
  analytics: DeckAnalytics;
};

export type DeckBrief = {
  /** Prose for the design call's `context`. */
  context: string;
  /** The deck's single dominant color when it has one, else undefined —
   *  steers the frame color the way a locked frame would. */
  colorHint: ColorIdentity | undefined;
  /** WUBRG letters that carry the deck, strongest first. */
  colors: string[];
};

const COLOR_NAME: Record<string, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
};

const COLOR_WORD: Record<string, string> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
};

/** One line per card, capped so a 100-card deck fits the prompt budget. */
export function deckCardLines(cards: DeckBriefCard[], limit = 120): string {
  return cards
    .slice(0, limit)
    .map((card) => {
      const parts = [card.name];
      if (card.type_line) parts.push(`(${card.type_line})`);
      if (card.rules_text) {
        parts.push(`— ${card.rules_text.replace(/\n/g, " / ").slice(0, 220)}`);
      }
      return `- ${parts.join(" ")}`;
    })
    .join("\n");
}

/** Colors that carry the deck: any color with at least a quarter of the
 *  strongest color's count (so a splash doesn't read as a main color). */
export function dominantColors(byColor: DeckAnalytics["byColor"]): string[] {
  const ranked = (["W", "U", "B", "R", "G"] as const)
    .map((c) => [c, byColor[c]] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];
  const top = ranked[0][1];
  return ranked.filter(([, n]) => n >= top * 0.25).map(([c]) => c);
}

export function buildDeckBrief(input: DeckBriefInput): DeckBrief {
  const { analytics } = input;
  const colors = dominantColors(analytics.byColor);
  const colorHint = colors.length === 1 ? COLOR_NAME[colors[0]] : undefined;
  const nonLand = analytics.curve.reduce((a, b) => a + b, 0);

  const lines: string[] = [];
  lines.push(
    `This card is being designed FOR the deck "${input.title}"${
      input.description ? ` — ${input.description}` : ""
    } (${input.format} format, ${analytics.total} cards).`,
  );

  if (colors.length > 0) {
    lines.push(
      `Color identity: ${colors.map((c) => COLOR_WORD[c]).join(" and ")}${
        colors.length > 1 ? " (multicolor)" : ""
      }. The new card MUST stay inside this identity.`,
    );
  } else {
    lines.push("The deck is colorless so far; a colorless card fits best.");
  }

  if (nonLand > 0) {
    const curve = analytics.curve
      .map((n, mv) => `${mv === 7 ? "7+" : mv}:${n}`)
      .join(" ");
    const thin = analytics.curve
      .slice(1, 5)
      .map((n, i) => ({ mv: i + 1, n }))
      .sort((a, b) => a.n - b.n)[0];
    lines.push(
      `Mana curve (mana value:count) ${curve}; average ${
        analytics.averageManaValue?.toFixed(1) ?? "n/a"
      }.${thin ? ` The curve is thinnest at ${thin.mv} mana.` : ""}`,
    );
  }

  const typeParts = Object.entries(analytics.byType)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `${type} ${n}`);
  if (typeParts.length > 0) {
    lines.push(`Type mix: ${typeParts.join(", ")}; lands ${analytics.lands}.`);
  }
  const creatures = analytics.byType.Creature;
  const spells = analytics.byType.Instant + analytics.byType.Sorcery;
  if (nonLand > 0 && creatures / Math.max(1, nonLand) > 0.7) {
    lines.push("The deck is creature-heavy — interaction, removal or a payoff that rewards the creatures would add the most.");
  } else if (nonLand > 0 && spells / Math.max(1, nonLand) > 0.5) {
    lines.push("The deck is spell-heavy — a resilient threat or a spells-matter payoff would add the most.");
  }

  lines.push(
    "Design ONE card that fills a gap in this deck and synergizes with what is already there (shared mechanics, tribal/keyword overlap, curve gaps). NEVER reuse one of the deck's card names or design a near-duplicate of an existing card.",
  );
  if (input.format === "commander" || input.format === "brawl" || input.format === "standard_brawl") {
    lines.push("Singleton format: the card must be a unique, single-copy design.");
  }
  lines.push("The deck currently contains:");
  lines.push(deckCardLines(input.cards));

  return { context: lines.join("\n"), colorHint, colors };
}
