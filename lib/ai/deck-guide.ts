import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { judgeModel } from "@/lib/ai/provider";
import { commanderBracket, deckTypeByKey } from "@/lib/decks/deck-types";
import type { DeckAnalytics } from "@/lib/decks/analytics";

// ---------------------------------------------------------------------------
// Deck guide — ONE text call that reads the whole list (names, types, costs,
// rules text) and writes the "how to play" section: overview, game plan,
// mulligan advice, the combos it can find, weaknesses and key cards. Runs
// free at the end of an AI deck generation and for one credit when a Pro
// owner analyzes any deck (lib/decks/guides.ts stores the result).
// ---------------------------------------------------------------------------

const clamp = (max: number) => z.string().transform((v) => v.trim().slice(0, max));

export const deckGuideSchema = z
  .object({
    overview: clamp(1200).describe("Two or three sentences: what the deck is, how it wins, what it feels like to pilot."),
    game_plan: z
      .array(clamp(300))
      .min(3)
      .max(6)
      .describe("The turn-by-turn or phase-by-phase plan, one step per entry (early game, midgame, closing)."),
    mulligan: clamp(600).describe("What a keepable opening hand looks like and what to ship."),
    combos: z
      .array(
        z
          .object({
            cards: z.array(clamp(80)).min(2).max(4).describe("Card names EXACTLY as they appear in the list."),
            description: clamp(400).describe("What the pieces do together and how it ends the game or takes over."),
          })
          .strict(),
      )
      .max(6)
      .describe("Real interactions between cards IN THIS LIST — synergies, engines, infinite or game-ending combos. Empty if none exist; never invent cards."),
    weaknesses: clamp(600).describe("What beats this deck and how to play around it."),
    key_cards: z.array(clamp(80)).max(6).describe("The cards the plan leans on most, names exactly as listed."),
  })
  .strict();

export type DeckGuideContent = z.infer<typeof deckGuideSchema>;

export type DeckGuideCard = {
  quantity: number;
  board: string;
  name: string;
  type_line: string | null;
  mana_cost: string | null;
  rules_text: string | null;
};

export type DeckGuideInput = {
  title: string;
  description: string | null;
  format: string;
  deckType: string | null;
  bracket: number | null;
  cards: DeckGuideCard[];
  analytics: DeckAnalytics;
};

const SYSTEM = `You are an experienced Magic: The Gathering coach writing a primer for a custom deck. Be concrete and useful: name the actual cards in the list, explain sequencing, and only describe combos that genuinely work with the rules text given. Never invent cards that are not in the list. Plain, friendly prose.`;

/** One line per card, rules text trimmed, capped so a 100-card list fits. */
export function deckGuideCardLines(cards: DeckGuideCard[], limit = 130): string {
  return cards
    .slice(0, limit)
    .map((c) => {
      const bits = [`${c.quantity}x ${c.name}`];
      if (c.board !== "main") bits.push(`[${c.board}]`);
      if (c.mana_cost) bits.push(c.mana_cost);
      if (c.type_line) bits.push(c.type_line);
      if (c.rules_text) bits.push(c.rules_text.replace(/\s+/g, " ").slice(0, 220));
      return bits.join(" — ");
    })
    .join("\n");
}

export async function generateDeckGuide(input: DeckGuideInput): Promise<DeckGuideContent> {
  const type = deckTypeByKey(input.deckType);
  const bracket = commanderBracket(input.bracket);
  const a = input.analytics;
  const { object } = await generateObject({
    model: judgeModel(),
    schema: deckGuideSchema,
    system: SYSTEM,
    prompt: [
      `Deck: "${input.title}"${input.description ? ` — ${input.description}` : ""}`,
      `Format: ${input.format}.`,
      type ? `Built as ${type.label} (${type.hint}).` : null,
      bracket ? `Power level: Bracket ${bracket.level} (${bracket.name}) — ${bracket.blurb}` : null,
      `Stats: ${a.total} cards, ${a.lands} lands, average mana value ${a.averageManaValue === null ? "n/a" : a.averageManaValue.toFixed(1)}, curve ${a.curve.join("/")}.`,
      "Cards:",
      deckGuideCardLines(input.cards),
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0.6,
  });
  return object;
}
