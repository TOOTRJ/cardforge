import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { designModel } from "@/lib/ai/provider";
import { textModelOptions } from "@/lib/ai/sampling";
import { budgetAbortSignal, repairStructuredText, retryFitsBudget, structuredCall } from "@/lib/ai/structured-output";
import type { CollectionCard } from "./card-row";
import { aiCandidates, aiCandidateLines, picksFromIds } from "./ai-candidates";
import { LAND_TARGET, ROLE_TARGETS, draftCommanderDeck, type CommanderDraft, type DraftPlan } from "./builder";
import { COMMANDER_DECK_SIZE } from "./limits";
import { commanderBracket } from "@/lib/decks/deck-types";
import { collectionDeckType, draftPlanFor, tribeLabel, type BracketCardLists, type BuildChoice } from "./archetypes";

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
// from the list, too many ids that aren't on it — is asked for again ONCE:
// only while the route's time budget holds a FULL answer (a short first
// answer was quick; a whole deck is not — `AI_FULL_ANSWER_MS`), cut off by
// `budgetAbortSignal` before the refund's tail, and a retry that fails
// keeps the first answer. Anything else the rules builder fixes by itself.
// Only `id` must be right: a missing reason or shortfall list, or a role
// word off the list, never fails a paid call (the role is the model's own
// note; the draft groups by the rules' reading).
// ---------------------------------------------------------------------------

const clamp = (max: number) => z.string().transform((v) => v.trim().slice(0, max));

/** The role words the model is offered (a hint in the schema's text, not
 *  an enum: an answer is never refused for one). */
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
    .nullish()
    .transform((v) => v ?? [])
    .describe(
      "Up to three short notes on what the player's cards are thin on for this plan (e.g. \"only 4 removal spells in these colours\"); an empty list when nothing is missing.",
    ),
  picks: z
    .array(
      z.object({
        id: z.string().describe("The card's id from <cards>, e.g. c12."),
        role: z
          .string()
          .nullish()
          .transform((v) => (v ?? "").trim().slice(0, 24))
          .describe(`The job this card does in the deck: one of ${AI_PICK_ROLES.join(", ")}.`),
        why: z
          .string()
          .nullish()
          .transform((v) => (v ?? "").trim().slice(0, 90))
          .describe("Why this card is in the deck, in under 12 words."),
      }),
    )
    .describe("The chosen cards, best first: about 63 non-land cards and the non-basic lands that fit, at most 99 in all."),
});

export type AiBuildAnswer = z.infer<typeof aiBuildSchema>;

/** Fewer valid picks than this (or than 80 % of a small list), or more
 *  than `AI_RETRY_UNKNOWN_SHARE` of the ids off the list, is asked for
 *  again (once). */
export const AI_RETRY_MIN_PICKS = 50;
export const AI_RETRY_UNKNOWN_SHARE = 0.2;
/** What a full answer (about 90 picks with their reasons, ~2.5k tokens) is
 *  assumed to take when deciding whether a retry fits the route's budget —
 *  never the first answer's own time when that answer was short. */
export const AI_FULL_ANSWER_MS = 50_000;

const SPELLS = COMMANDER_DECK_SIZE - 1 - LAND_TARGET;

/** The usable picks a retry asks for: 50, or 80 % of a small list. */
export function retryMinPicks(candidates: number): number {
  return Math.min(AI_RETRY_MIN_PICKS, Math.floor(candidates * 0.8));
}

export const AI_BUILD_SYSTEM = [
  "You build a Magic: The Gathering Commander deck from cards a player already owns.",
  "The player's app checks every pick, so a pick that breaks a rule is simply lost:",
  "choose only cards listed in <cards>, by their id (c0, c1, …) — any other card is one the player doesn't own;",
  "each card at most once; basic lands are added afterwards, so don't plan on them.",
  "Build for the plan first: the deck type and creature type when you're given them (<deck_type>, <creature_type>), with the commander's own text;",
  "otherwise the commander's plan — cards that share its creature types or do what its text rewards.",
  "Then make the deck work: enough ramp so it casts its spells on time, enough card draw so it doesn't run out of cards,",
  "and enough removal and board wipes to answer threats (<targets> gives the numbers),",
  "on a curve that leans low (most spells at mana value 2 to 4). Keep to <bracket> when there is one.",
  "Prefer cards that work together over cards that are merely strong.",
  "The role and themes on each line are the app's quick reading of the card; trust the card's text over them.",
  "Write the plan first (strategy, shortfalls), then the picks — each with its role and a short reason.",
].join(" ");

/** The plan blocks: what the deck is built around, and the bracket. */
function planBlocks(choice: BuildChoice, plan: DraftPlan | null): string[] {
  const out: string[] = [];
  const type = collectionDeckType(choice.deckType);
  if (type) {
    out.push(
      "<deck_type>",
      `${type.label}: ${type.summary}`,
      `Build the plan around it: ${type.wants}. Aim for about ${type.target} cards that serve this plan, and say in shortfalls when the player's cards can't reach it.`,
      "</deck_type>",
    );
  }
  const tribe = choice.tribe?.trim();
  if (tribe) {
    out.push(
      "<creature_type>",
      `${tribeLabel(tribe)}: make it a ${tribeLabel(tribe)} deck — about three in four of its creatures ${tribeLabel(tribe)}s (changelings count), plus the cards that reward them.`,
      "</creature_type>",
    );
  }
  const bracket = choice.bracket ? commanderBracket(choice.bracket) : null;
  if (bracket) {
    const checked = !!plan?.bracket?.cards;
    out.push(
      "<bracket>",
      bracket.guidance,
      checked
        ? "The cards that bracket bars are already left out of <cards>; keep to its other rules (combos, extra turns) yourself."
        : "Keep to that bracket's rules yourself: the app couldn't check its card lists this time.",
      "</bracket>",
    );
  }
  return out;
}

export function aiBuildPrompt(
  commander: CollectionCard,
  candidates: readonly CollectionCard[],
  choice: BuildChoice = {},
  plan: DraftPlan | null = null,
): string {
  const roles = { ...ROLE_TARGETS, ...(plan?.roles ?? {}) };
  const lands = plan?.lands ?? LAND_TARGET;
  const spells = COMMANDER_DECK_SIZE - 1 - lands;
  return [
    "<cards>",
    aiCandidateLines(candidates),
    "</cards>",
    "<commander>",
    `${commander.name} — ${commander.manaCost ?? ""} — ${commander.typeLine ?? ""}`,
    commander.oracleText ? commander.oracleText.replace(/\s+/g, " ").trim().slice(0, 800) : null,
    `Colour identity: ${commander.colorIdentity.join("") || "colourless"}.`,
    "</commander>",
    ...planBlocks(choice, plan),
    "<targets>",
    `About ${spells} non-land cards: ramp ~${roles.ramp}, card draw ~${roles.draw}, removal ~${roles.removal}, board wipes ~${roles.wipe}, the rest for the plan. Plus the non-basic lands from <cards> that make the deck's colours (${lands} lands in all once basics are added).`,
    "</targets>",
    "Choose the deck now. Use only ids from <cards>. If the cards can't fill a role, say so in shortfalls instead of padding it with cards that don't do the job.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function retryNote(valid: number, unknown: number, spells: number = SPELLS): string {
  return [
    "<previous_answer>",
    `Your last answer had ${valid} usable picks${unknown ? ` and ${unknown} ids that are not in <cards>` : ""}.`,
    "</previous_answer>",
    `Choose the deck again, each card an id from <cards>: as many fitting cards as the list allows, up to about ${spells} non-land cards plus the non-basic lands that fit — and say in shortfalls what the list can't give, rather than padding.`,
  ].join("\n");
}

async function askOnce(prompt: string, abortSignal?: AbortSignal): Promise<AiBuildAnswer> {
  const { object } = await structuredCall("collection-build", repairStructuredText(aiBuildSchema), (experimental_repairText) =>
    generateObject({
      ...textModelOptions(designModel(), 0.5),
      schema: aiBuildSchema,
      experimental_repairText,
      system: AI_BUILD_SYSTEM,
      prompt,
      ...(abortSignal ? { abortSignal } : {}),
    }),
  );
  return object;
}

export async function aiBuildCommanderDeck(input: {
  commander: CollectionCard;
  collection: readonly CollectionCard[];
  /** A deck type, a creature type, a bracket (all optional). */
  choice?: BuildChoice;
  /** The bracket's card lists (null: picked but unreadable; the build
   *  says so). Read by the route. */
  bracketCards?: BracketCardLists | null;
  /** The candidates' shuffle (tests pass a fixed one). */
  random?: () => number;
}): Promise<CommanderDraft> {
  const commander = input.commander;
  const choice = input.choice ?? {};
  const plan = draftPlanFor(choice, input.bracketCards ?? null);
  const candidates = aiCandidates(commander, input.collection, { random: input.random ?? Math.random, plan });
  const prompt = aiBuildPrompt(commander, candidates, choice, plan);

  const firstStarted = Date.now();
  let answer = await askOnce(prompt);
  const firstMs = Date.now() - firstStarted;
  let picked = picksFromIds(
    answer.picks.map((p) => p.id),
    candidates,
  );
  const tooFew = picked.rowIds.length < retryMinPicks(candidates.length);
  const tooWild = answer.picks.length > 0 && picked.unknown / answer.picks.length > AI_RETRY_UNKNOWN_SHARE;
  if ((tooFew || tooWild) && retryFitsBudget(Math.max(firstMs, AI_FULL_ANSWER_MS))) {
    try {
      const again = await askOnce(`${prompt}\n${retryNote(picked.rowIds.length, picked.unknown, COMMANDER_DECK_SIZE - 1 - (plan?.lands ?? LAND_TARGET))}`, budgetAbortSignal());
      const pickedAgain = picksFromIds(
        again.picks.map((p) => p.id),
        candidates,
      );
      if (pickedAgain.rowIds.length > picked.rowIds.length) {
        answer = again;
        picked = pickedAgain;
      }
    } catch (error) {
      // The first answer is still a deck: keep it.
      console.warn(
        "[ai:design] collection build retry failed, keeping the first answer:",
        error instanceof Error ? error.message.slice(0, 200) : error,
      );
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
    plan,
    strategy: answer.strategy,
  });
}
