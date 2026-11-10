import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { designModel } from "@/lib/ai/provider";
import { textModelOptions } from "@/lib/ai/sampling";
import { AiOutputError, budgetAbortSignal, repairStructuredText, structuredCall } from "@/lib/ai/structured-output";
import { commanderBracket } from "@/lib/decks/deck-types";
import { COLLECTION_DECK_TYPES, collectionDeckType } from "./archetypes";
import type { ScoringCard } from "./commander-scores";
import type { CommanderSuggestion, SuggestResult } from "./suggestions";
import {
  collectionSummary,
  supportLine,
  type ShortlistEntry,
  type SuggestPreferences,
} from "./suggest-shortlist";

// ---------------------------------------------------------------------------
// "Suggest a commander" (1 credit) — the AI call (owner decision 2026-11-09,
// the report's change 4). The code has shortlisted and scored the user's
// commanders (suggest-shortlist.ts); ONE design call ranks up to eight of
// them, says what each deck would be about and why the user's own cards
// support it, citing cards ONLY from that commander's own support list.
//
// The prompt's shape follows the AI build's: the long material first in
// tags, the task last, the rules with their reasons. Only ids must be right
// — a missing field or an odd deck-type word never fails the paid call —
// and every answer is checked here: unknown or repeated commanders dropped,
// key cards kept only from that commander's list. Fewer than three usable
// suggestions is a failed call (the route refunds). The page shows the
// CODE's numbers beside each suggestion, never the model's.
// ---------------------------------------------------------------------------

export const SUGGEST_MAX = 8;
/** Fewer usable suggestions than this is a failed call. */
export const SUGGEST_MIN_USABLE = 3;
export const SUGGEST_KEY_CARDS_MAX = 8;

const text = (max: number) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ?? "").trim().slice(0, max));

export const suggestSchema = z.object({
  overview: text(300).describe("One or two sentences on what the player's collection is best at, in plain words."),
  suggestions: z
    .array(
      z.object({
        commander: z.string().describe("The commander's id from <commanders>, e.g. k3."),
        deckType: text(30).describe(
          `The deck type it would be, one of: ${COLLECTION_DECK_TYPES.map((t) => t.id).join(", ")} — or "any" when none fits.`,
        ),
        pitch: text(180).describe("One sentence: what this deck does."),
        why: text(300).describe("One or two sentences: why the player's own cards support it, naming a few of them."),
        keyCards: z
          .array(z.string())
          .nullish()
          .transform((v) => v ?? [])
          .describe("3 to 8 ids of key cards from THIS commander's <support> list (c12, …)."),
        gaps: text(180).describe("What the player's cards are short of for this deck, or an empty string."),
      }),
    )
    .describe("The commanders to build, best first: at least three and at most eight."),
});

export type SuggestAnswer = z.infer<typeof suggestSchema>;

export const AI_SUGGEST_SYSTEM = [
  "You help a Magic: The Gathering player choose which of the commanders they OWN to build a Commander deck around next,",
  "judged by how well THEIR OWN cards support each one.",
  "The player's app checks every answer, so anything that breaks these rules is simply dropped:",
  "answer only with commander ids from <commanders> (k0, k1, …), each at most once;",
  "cite key cards only from that same commander's <support> list, by id (c12, …) — never a card the player doesn't own.",
  "Rank by, in this order: a coherent plan the player's cards really support; the player's stated preferences (<preferences>);",
  "role coverage (the ramp, card draw and removal numbers given); variety across colours and deck types; popularity only to break a tie.",
  "Give at least three suggestions (the list holds at least three commanders) and at most eight — don't pad past what the cards support.",
  "Write the overview first, then the suggestions, best first.",
].join(" ");

function preferencesBlock(prefs: SuggestPreferences): string[] {
  const lines: string[] = [];
  const type = collectionDeckType(prefs.deckType);
  if (type) lines.push(`Deck type wanted: ${type.label} — ${type.summary}`);
  const bracket = prefs.bracket ? commanderBracket(prefs.bracket) : null;
  if (bracket) lines.push(bracket.guidance);
  if (prefs.colours && prefs.colours.length) lines.push(`Colours wanted: ${prefs.colours.join(", ")} (the list is already narrowed to them).`);
  return lines.length ? ["<preferences>", ...lines, "</preferences>"] : [];
}

export function suggestPrompt(shortlist: readonly ShortlistEntry[], cards: readonly ScoringCard[], prefs: SuggestPreferences): string {
  const commanders = shortlist.flatMap((entry) => [
    `<commander id="${entry.ref}">`,
    `${entry.commander.name} — ${entry.commander.manaCost ?? ""} — ${entry.commander.typeLine ?? ""} — colours ${entry.commander.colorIdentity.join("") || "colourless"}`,
    (entry.commander.oracleText ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    `The player's cards: ${supportLine(entry.support)}`,
    "<support>",
    ...(entry.cards.length ? entry.cards.map((c) => `${c.ref} | ${c.line}`) : ["(no owned card plays into its own text)"]),
    "</support>",
    "</commander>",
  ]);
  return [
    "<collection>",
    collectionSummary(cards),
    "</collection>",
    "<commanders>",
    ...commanders,
    "</commanders>",
    ...preferencesBlock(prefs),
    `Rank ${Math.min(SUGGEST_MIN_USABLE, shortlist.length)} to ${SUGGEST_MAX} of these commanders now, best first. Use only ids from <commanders>, and key cards only from each commander's own <support>.`,
  ].join("\n");
}

export type { CommanderSuggestion, SuggestResult };

/** The answer checked against the shortlist: unknown or repeated commanders
 *  dropped, key cards only from that commander's own list. */
export function checkSuggestions(answer: SuggestAnswer, shortlist: readonly ShortlistEntry[]): SuggestResult {
  const byRef = new Map(shortlist.map((entry) => [entry.ref, entry]));
  const seen = new Set<string>();
  const suggestions: CommanderSuggestion[] = [];
  for (const s of answer.suggestions) {
    if (suggestions.length >= SUGGEST_MAX) break;
    const entry = byRef.get(s.commander.trim().toLowerCase());
    if (!entry || seen.has(entry.ref)) continue;
    seen.add(entry.ref);
    const cardsByRef = new Map(entry.cards.map((c) => [c.ref, c]));
    const keyCards: { id: string; name: string }[] = [];
    for (const ref of s.keyCards) {
      const card = cardsByRef.get(ref.trim().toLowerCase());
      if (card && !keyCards.some((k) => k.id === card.id)) keyCards.push({ id: card.id, name: card.name });
      if (keyCards.length >= SUGGEST_KEY_CARDS_MAX) break;
    }
    suggestions.push({
      commanderId: entry.commander.id,
      name: entry.commander.name,
      imageUrl: entry.commander.imageUrl,
      colorIdentity: entry.commander.colorIdentity,
      deckType: collectionDeckType(s.deckType.toLowerCase())?.id ?? null,
      pitch: s.pitch,
      why: s.why,
      gaps: s.gaps,
      keyCards,
      support: entry.support,
    });
  }
  return { overview: answer.overview, suggestions };
}

export async function suggestCommanders(input: {
  shortlist: readonly ShortlistEntry[];
  cards: readonly ScoringCard[];
  preferences: SuggestPreferences;
}): Promise<SuggestResult> {
  const abortSignal = budgetAbortSignal();
  const { object } = await structuredCall("collection-suggest", repairStructuredText(suggestSchema), (experimental_repairText) =>
    generateObject({
      ...textModelOptions(designModel(), 0.5),
      schema: suggestSchema,
      experimental_repairText,
      system: AI_SUGGEST_SYSTEM,
      prompt: suggestPrompt(input.shortlist, input.cards, input.preferences),
      // Cut off before the refund's tail: a slow answer must never outrun
      // the route and leave a charge behind (the AI build's rule).
      ...(abortSignal ? { abortSignal } : {}),
    }),
  );
  const result = checkSuggestions(object, input.shortlist);
  if (result.suggestions.length < Math.min(SUGGEST_MIN_USABLE, input.shortlist.length)) {
    // Too few usable: an unreadable answer (the route refunds the credit).
    throw new AiOutputError("collection-suggest");
  }
  return result;
}
