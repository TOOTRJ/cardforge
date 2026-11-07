import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { designModel } from "@/lib/ai/provider";
import { repairStructuredText, structuredCall } from "@/lib/ai/structured-output";
import type { CollectionCard } from "./card-row";
import { aiCandidates, aiCandidateLines, picksFromIndexes } from "./ai-candidates";
import { draftCommanderDeck, type CommanderDraft } from "./builder";

// ---------------------------------------------------------------------------
// "Build with AI" (1 credit): ONE design call reads the commander and a
// list of the user's eligible cards (numbered, so the answer can only name
// a card from the list) and answers with a plan and its picks. The picks go
// to the rules builder as `preferred` — the same eligibility, singleton and
// size rules as the free draft — so nothing the model writes can put in a
// card the user doesn't own.
// ---------------------------------------------------------------------------

const clamp = (max: number) => z.string().transform((v) => v.trim().slice(0, max));

export const aiBuildSchema = z.object({
  strategy: clamp(600).describe(
    "Two or three sentences: how this deck plays and wins with this commander, in plain words for the deck's owner.",
  ),
  picks: z
    .array(z.number().int().min(0))
    .max(120)
    .describe("The numbers of the chosen cards from the list, best first: about 63 spells and up to 36 lands."),
});

const SYSTEM = [
  "You build Magic: The Gathering Commander decks from cards a player already owns.",
  "You may only choose cards from the numbered list you are given, by their numbers; never invent a card.",
  "Choose about 63 non-land cards and the best non-basic lands from the list (basic lands are added later).",
  "Build around the commander's plan: cards that share its creature types or do what its text rewards come first,",
  "then enough ramp (about 10), card draw (about 10), removal (about 8) and two or three board wipes,",
  "on a curve that leans low. Prefer cards that work together over cards that are merely strong.",
].join(" ");

export async function aiBuildCommanderDeck(input: {
  commander: CollectionCard;
  collection: readonly CollectionCard[];
}): Promise<CommanderDraft> {
  const candidates = aiCandidates(input.commander, input.collection);
  const commander = input.commander;
  const { object } = await structuredCall("collection-build", repairStructuredText(aiBuildSchema), (experimental_repairText) =>
    generateObject({
      model: designModel(),
      schema: aiBuildSchema,
      experimental_repairText,
      system: SYSTEM,
      prompt: [
        `Commander: ${commander.name} — ${commander.manaCost ?? ""} — ${commander.typeLine ?? ""}`,
        commander.oracleText ? `Commander text: ${commander.oracleText.replace(/\s+/g, " ").slice(0, 600)}` : null,
        `Colour identity: ${commander.colorIdentity.join("") || "colourless"}.`,
        `The player's eligible cards (number | name | mana value | type | text):`,
        aiCandidateLines(candidates),
      ]
        .filter(Boolean)
        .join("\n"),
      temperature: 0.5,
    }),
  );
  return draftCommanderDeck({
    commander,
    collection: input.collection,
    preferred: picksFromIndexes(object.picks, candidates),
    strategy: object.strategy,
  });
}
