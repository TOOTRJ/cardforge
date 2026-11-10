import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { designModel } from "@/lib/ai/provider";
import { textModelOptions } from "@/lib/ai/sampling";
import { repairStructuredText, retryFitsBudget, structuredCall } from "@/lib/ai/structured-output";
import type { CollectionCard } from "./card-row";
import { aiCandidates, aiCandidateLines, picksFromIds } from "./ai-candidates";
import { ROLE_TARGETS, draftCommanderDeck, type CommanderDraft } from "./builder";

// ---------------------------------------------------------------------------
// "Build with AI" (1 credit): ONE design call reads the user's eligible
// cards (each under an id, "c12" — the answer can only name a card from the
// list) and the commander, and answers with its plan, what the collection
// is thin on, and its picks — each with a role and a one-line reason the
// draft shows. The picks go to the rules builder as `preferred`: the same
// eligibility, singleton and size rules as the free draft, so nothing the
// model writes can put in a card the user doesn't own.
//
// The prompt's shape (owner 2026-11-09, the collection refinements report):
// the long card list FIRST in its own tags and the task LAST (Anthropic's
// long-context guidance), the rules with their reasons, the plan fields
// before the picks (the model plans, then picks), no bounds in the schema
// the structured output can't hold (counts are enforced here, in code).
// Variety between builds comes from the candidates' order (shuffled within
// ranking tiers), not from sampling. A measurable shortfall — too few picks
// from the list, too many ids that aren't on it — is asked for again ONCE,
// and only while the route's time budget holds a second call
// (`retryFitsBudget`, the budget `withAiTimeBudget` sets); anything else
// the rules builder fixes by itself.
// ---------------------------------------------------------------------------

const clamp = (max: number) => z.string().transform((v) => v.trim().slice(0, max));

export const AI_PICK_ROLES = [
  "ramp",
  "draw",
  "removal",
  "wipe",
  "protection",
  "plan",
  "payoff",
  "wincon",
  "land",
  "utility",
] as const;

export const aiBuildSchema = z.object({
  strategy: clamp(600).describe(
    "Two or three sentences: how this deck plays and wins with this commander, in plain words for the deck's owner.",
  ),
  shortfalls: z
    .array(clamp(160))
    .describe(
      "Up to three short notes on what the player's cards are thin on for this plan (e.g. \"only 4 removal spells in these colours\"); an empty list when nothing is missing.",
    ),
  picks: z
    .array(
      z.object({
        id: z.string().describe("The card's id from <cards>, e.g. c12."),
        role: z.enum(AI_PICK_ROLES).describe("The job this card does in the deck."),
        why: clamp(90).describe("Why this card is in the deck, in under 12 words."),
      }),
    )
    .describe("The chosen cards, best first: about 63 non-land cards and the non-basic lands that fit, at most 99 in all."),
});

export type AiBuildAnswer = z.infer<typeof aiBuildSchema>;

/** Fewer valid picks than this, or more than `AI_RETRY_UNKNOWN_SHARE` of
 *  the ids off the list, is asked for again (once). */
export const AI_RETRY_MIN_PICKS = 50;
export const AI_RETRY_UNKNOWN_SHARE = 0.2;

export const AI_BUILD_SYSTEM = [
  "You build a Magic: The Gathering Commander deck from cards a player already owns.",
  "The player's app checks every pick, so a pick that breaks a rule is simply lost:",
  "choose only cards listed in <cards>, by their id (c0, c1, …) — any other card is one the player doesn't own;",
  "each card at most once; basic lands are added afterwards, so don't plan on them.",
  "Build for the commander's plan first: cards that share its creature types or do what its text rewards.",
  `Then make the deck work: about ${ROLE_TARGETS.ramp} ramp so it casts its spells on time,`,
  `about ${ROLE_TARGETS.draw} card draw so it doesn't run out of cards,`,
  `about ${ROLE_TARGETS.removal} removal and two or three board wipes to answer threats,`,
  "on a curve that leans low (most spells at mana value 2 to 4).",
  "Prefer cards that work together over cards that are merely strong.",
  "The role and themes on each line are the app's quick reading of the card; trust the card's text over them.",
  "Write the plan first (strategy, shortfalls), then the picks — each with its role and a short reason.",
].join(" ");

export function aiBuildPrompt(commander: CollectionCard, candidates: readonly CollectionCard[]): string {
  return [
    "<cards>",
    aiCandidateLines(candidates),
    "</cards>",
    "<commander>",
    `${commander.name} — ${commander.manaCost ?? ""} — ${commander.typeLine ?? ""}`,
    commander.oracleText ? commander.oracleText.replace(/\s+/g, " ").trim().slice(0, 800) : null,
    `Colour identity: ${commander.colorIdentity.join("") || "colourless"}.`,
    "</commander>",
    "<targets>",
    `About 63 non-land cards: ramp ~${ROLE_TARGETS.ramp}, card draw ~${ROLE_TARGETS.draw}, removal ~${ROLE_TARGETS.removal}, board wipes 2–3, the rest for the plan. Plus the non-basic lands from <cards> that make the deck's colours (36 lands in all once basics are added).`,
    "</targets>",
    "Choose the deck now. Use only ids from <cards>. If the cards can't fill a role, say so in shortfalls instead of padding it with cards that don't do the job.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function retryNote(valid: number, unknown: number): string {
  return [
    "<previous_answer>",
    `Your last answer had ${valid} usable picks${unknown ? ` and ${unknown} ids that are not in <cards>` : ""}.`,
    "</previous_answer>",
    "Choose the deck again: about 63 non-land cards plus the non-basic lands that fit, each one an id from <cards>.",
  ].join("\n");
}

async function askOnce(prompt: string): Promise<AiBuildAnswer> {
  const { object } = await structuredCall("collection-build", repairStructuredText(aiBuildSchema), (experimental_repairText) =>
    generateObject({
      ...textModelOptions(designModel(), 0.5),
      schema: aiBuildSchema,
      experimental_repairText,
      system: AI_BUILD_SYSTEM,
      prompt,
    }),
  );
  return object;
}

export async function aiBuildCommanderDeck(input: {
  commander: CollectionCard;
  collection: readonly CollectionCard[];
  /** The candidates' shuffle (tests pass a fixed one). */
  random?: () => number;
}): Promise<CommanderDraft> {
  const commander = input.commander;
  const candidates = aiCandidates(commander, input.collection, input.random ?? Math.random);
  const prompt = aiBuildPrompt(commander, candidates);

  const firstStarted = Date.now();
  let answer = await askOnce(prompt);
  const firstMs = Date.now() - firstStarted;
  let picked = picksFromIds(
    answer.picks.map((p) => p.id),
    candidates,
  );
  const tooFew = picked.rowIds.length < AI_RETRY_MIN_PICKS;
  const tooWild = answer.picks.length > 0 && picked.unknown / answer.picks.length > AI_RETRY_UNKNOWN_SHARE;
  if ((tooFew || tooWild) && retryFitsBudget(firstMs)) {
    const again = await askOnce(`${prompt}\n${retryNote(picked.rowIds.length, picked.unknown)}`);
    const pickedAgain = picksFromIds(
      again.picks.map((p) => p.id),
      candidates,
    );
    if (pickedAgain.rowIds.length > picked.rowIds.length) {
      answer = again;
      picked = pickedAgain;
    }
  }

  // The reason per row (the first time an id is named).
  const reasons = new Map<string, string>();
  for (const pick of answer.picks) {
    const rowId = picksFromIds([pick.id], candidates).rowIds[0];
    if (rowId && !reasons.has(rowId) && pick.why) reasons.set(rowId, pick.why);
  }

  return draftCommanderDeck({
    commander,
    collection: input.collection,
    preferred: picked.rowIds,
    reasons,
    shortfalls: answer.shortfalls.slice(0, 3),
    strategy: answer.strategy,
  });
}
