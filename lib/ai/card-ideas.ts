import "server-only";

import { designCards } from "@/lib/ai/card-design";
import { designFreshly, repeatsRecentTitle, type DesignVariety } from "@/lib/ai/design-variety";
import type { CardIdea } from "@/lib/ai/card-ideas-select";
import { retryFitsBudget } from "@/lib/ai/structured-output";
import type { CardType, Rarity } from "@/types/card";

// ---------------------------------------------------------------------------
// Card ideas — the creator's "Get ideas" flow. ONE text call designs a few
// clearly different concepts (title, type line, cost, rarity, rules, flavor,
// stats — never art) for the user to pick fields from. 1 credit per batch,
// charged by the route. A deck brief (Pro) themes every idea to the deck.
//
// Every batch carries a fresh spark and the user's recent AI titles
// (lib/ai/design-variety.ts, 2026-10-28): the same options twice never
// send the same prompt, and a batch whose idea repeats a recent title is
// designed once more before the response (the one credit covers both).
// ---------------------------------------------------------------------------

const IDEA_COUNT = 3;

export type CardIdeasInput = {
  theme?: string;
  cardType?: CardType;
  rarity?: Rarity;
  /** lib/ai/deck-brief.ts context — Pro only, gated by the route. */
  deckContext?: string;
  /** The user's recent AI titles (lib/ai/recent-designs.ts). */
  recentTitles?: readonly string[];
};

async function designIdeas(input: CardIdeasInput, variety: DesignVariety): Promise<CardIdea[]> {
  const steer = input.theme?.trim() || (input.deckContext ? undefined : "an original, memorable card — surprise the user");
  const { cards } = await designCards({
    theme: steer,
    variety,
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

export async function generateCardIdeas(input: CardIdeasInput): Promise<CardIdea[]> {
  const recent = input.recentTitles ?? [];
  return designFreshly(
    recent,
    (variety) => designIdeas(input, variety),
    // The first idea whose title repeats a recent one (none → no redesign).
    (ideas) => ideas.find((idea) => repeatsRecentTitle(idea.title, recent))?.title ?? null,
    // A sync route: the redesign only while its maxDuration still holds it
    // (a kill past it would skip the in-process refund).
    { secondFits: (firstMs) => retryFitsBudget(firstMs) },
  );
}
