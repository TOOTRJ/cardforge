import "server-only";

import { designCards } from "@/lib/ai/card-design";
import type { CardIdea } from "@/lib/ai/card-ideas-select";
import type { CardType, Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// Card ideas — the creator's "Get ideas" flow. ONE text call designs a few
// clearly different concepts (title, type line, cost, rarity, rules, flavor,
// stats — never art) for the user to pick fields from. 1 credit per batch,
// charged by the route. A deck brief (Pro) themes every idea to the deck.
// ---------------------------------------------------------------------------

export const IDEA_COUNT = 3;

export type CardIdeasInput = {
  theme?: string;
  cardType?: CardType;
  rarity?: Rarity;
  /** lib/ai/deck-brief.ts context — Pro only, gated by the route. */
  deckContext?: string;
};

export async function generateCardIdeas(input: CardIdeasInput): Promise<CardIdea[]> {
  const steer = input.theme?.trim() || (input.deckContext ? undefined : "an original, memorable card — surprise the user");
  const { cards } = await designCards({
    theme: steer,
    context: [
      input.deckContext ?? null,
      `These ${IDEA_COUNT} cards are IDEAS for the user to choose between, not a set: make them clearly different from each other — different angles on the theme${
        input.cardType ? "" : ", different card types"
      }${input.rarity ? "" : ", a spread of rarities and costs"} — so the choice is meaningful. Each must stand alone as a complete, balanced card.`,
    ]
      .filter(Boolean)
      .join("\n"),
    slots: Array.from({ length: IDEA_COUNT }, (_, i) => ({
      cardType: input.cardType,
      rarity: input.rarity,
      note: `Idea ${i + 1} of ${IDEA_COUNT}.`,
    })),
  });
  return cards.map((card) => ({
    title: card.title,
    cost: card.cost,
    card_type: card.card_type,
    supertype: card.supertype,
    subtypes: card.subtypes,
    rarity: card.rarity,
    color_identity: card.color_identity,
    rules_text: card.rules_text,
    flavor_text: card.flavor_text,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
  }));
}
