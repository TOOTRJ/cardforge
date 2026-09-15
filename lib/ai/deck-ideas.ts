import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { judgeModel } from "@/lib/ai/provider";
import { commanderBracket, type DeckType, describeColors } from "@/lib/decks/deck-types";
import type { DeckFormat } from "@/types/deck";

// ---------------------------------------------------------------------------
// Deck ideas — the deck wizard's "Get theme ideas" flow. ONE text call
// pitches a few clearly different deck concepts (name, theme, art style,
// one-line pitch) for the user to pick from; the pick fills the wizard's
// title, theme and style fields. 1 credit per batch, charged by the route.
// ---------------------------------------------------------------------------

export const DECK_IDEA_COUNT = 3;

const deckIdeasSchema = z
  .object({
    ideas: z
      .array(
        z
          .object({
            title: z.string().max(80).describe("An original deck name."),
            theme: z
              .string()
              .max(300)
              .describe("The theme in one sentence — world, faction, strategy or vibe."),
            style: z.string().max(60).describe("A short art-style phrase, e.g. 'dark fantasy oil painting'."),
            pitch: z.string().max(200).describe("One sentence on how the deck plays and wins."),
          })
          .strict(),
      )
      .length(DECK_IDEA_COUNT),
  })
  .strict();

export type DeckIdea = z.infer<typeof deckIdeasSchema>["ideas"][number];

const SYSTEM = `You pitch ORIGINAL Magic: The Gathering-style deck ideas for a homebrew tool. Each idea must be clearly different from the others — different worlds, moods and game plans. Everything must be original: never Wizards-owned proper nouns, never real-world brands.`;

export async function generateDeckIdeas(input: {
  format: DeckFormat;
  deckType?: DeckType | null;
  bracket?: number | null;
  hint?: string;
}): Promise<DeckIdea[]> {
  const { object } = await generateObject({
    model: judgeModel(),
    schema: deckIdeasSchema,
    system: SYSTEM,
    prompt: [
      `Format: ${input.format}.`,
      input.deckType
        ? `Deck type: ${input.deckType.label} — ${input.deckType.hint}; colour identity ${describeColors(input.deckType.colors)}.`
        : "Any deck type or colours.",
      commanderBracket(input.bracket)?.guidance ?? null,
      input.hint?.trim() ? `The user's starting thought: ${input.hint.trim().slice(0, 300)}` : null,
      `Give ${DECK_IDEA_COUNT} ideas.`,
    ]
      .filter(Boolean)
      .join("\n"),
    temperature: 0.95,
  });
  return object.ideas;
}
