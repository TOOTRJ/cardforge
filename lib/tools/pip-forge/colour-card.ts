import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { judgeModel } from "@/lib/ai/provider";
import { textModelOptions } from "@/lib/ai/sampling";
import { repairStructuredText, structuredCall } from "@/lib/ai/structured-output";
import { isKeywordName } from "@/lib/cards/keyword-reminders";
import { containsProfanity } from "@/lib/moderation/profanity";
import { colourCardSchema, normaliseHex, WHEEL_GAPS, type ColourCard } from "./model";

// ---------------------------------------------------------------------------
// Pip Forge — the colour card: ONE text call through the existing structured
// path (structuredCall + the repair, judgeModel — the deck ideas' model)
// names the colour the pip stands for: its philosophy, values, 3–5
// mechanics with ONE new keyword, what it can't do, its basic land type and
// the gap it takes on a six-colour wheel (allies and enemies are DERIVED
// from that gap, lib/tools/pip-forge/model.ts wheelPlace — never listed by
// the model, so the card and its wheel always agree).
//
// Every word is read by the one strong-language detector
// (lib/moderation/profanity.ts) — a card with a flagged word is never kept.
// A keyword that is already a Comprehensive Rules keyword, or a basic land
// type Magic prints, is asked for once more. Either still wrong → the
// call fails (the route refunds the credit).
// ---------------------------------------------------------------------------

/** What the model answers (the hard limits are cut by the repair). */
const answerSchema = z
  .object({
    name: z.string().max(24).describe("The colour's name, one or two words (e.g. 'Amber', 'Ash')."),
    epithet: z.string().max(80).describe("One short line: 'the colour of …'."),
    philosophy: z
      .string()
      .max(500)
      .describe("Two or three sentences: what the colour believes, wants and fears."),
    values: z.array(z.string().max(32)).max(5).describe("Three to five values, one or two words each."),
    keyword: z
      .object({
        name: z.string().max(32).describe("An ORIGINAL keyword ability name, one or two words."),
        reminder: z.string().max(240).describe("Its reminder text, in Magic rules wording, without brackets."),
      })
      .strict(),
    mechanics: z
      .array(
        z
          .object({
            name: z.string().max(48).describe("A short name for the mechanic or effect family."),
            text: z.string().max(200).describe("One sentence on what cards of the colour do with it."),
          })
          .strict(),
      )
      .max(4)
      .describe("Two to four of the colour's other mechanics (not the keyword)."),
    cannot: z
      .array(z.string().max(160))
      .max(4)
      .describe("Two to four things the colour can't (or won't) do, each one sentence."),
    basicLand: z.string().max(24).describe("Its basic land type, one word, not an existing basic land type."),
    sitsBetween: z.enum(WHEEL_GAPS).describe("The two neighbouring colours it sits between on the wheel."),
    alliesWhy: z.string().max(260).describe("One or two sentences: what it shares with its two neighbours."),
    enemiesWhy: z
      .string()
      .max(260)
      .describe("One or two sentences: why it clashes with the colours two steps away and across the wheel."),
    discColor: z
      .string()
      .max(7)
      .describe("A #rrggbb colour for the pip's disc: a pale or mid tone, like the mana symbols' discs."),
  })
  .strict();

const SYSTEM = `You design ORIGINAL sixth colours for a homebrew Magic: The Gathering-style colour pie. The five colours are White, Blue, Black, Red and Green on a wheel (W U B R G, in that order); the new colour takes ONE gap between two neighbours, which become its allies; the colours two steps away are its enemies, and the one straight across is its opposite.

Make the colour coherent and distinct from all five: a clear philosophy, values that follow from it, mechanics that express it, and real limits (what it can't do) that keep it fair. The keyword must be NEW — never an existing Magic keyword ability or action. The basic land type must be new too (never Plains, Island, Swamp, Mountain, Forest or Wastes). Never use Wizards-owned proper nouns. Keep every sentence short and plain.`;

const EXISTING_BASIC_TYPES = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes", "desert", "gate"]);

export class ColourCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ColourCardError";
  }
}

function strings(card: ColourCard): string[] {
  return [
    card.name,
    card.epithet,
    card.philosophy,
    ...card.values,
    card.keyword.name,
    card.keyword.reminder,
    ...card.mechanics.flatMap((m) => [m.name, m.text]),
    ...card.cannot,
    card.basicLand,
    card.alliesWhy,
    card.enemiesWhy,
  ];
}

/** Why a card can't be kept as answered, or null. */
export function colourCardProblem(card: ColourCard): string | null {
  if (strings(card).some((text) => containsProfanity(text))) return "language";
  if (isKeywordName(card.keyword.name)) return `"${card.keyword.name}" is already a Magic keyword`;
  if (EXISTING_BASIC_TYPES.has(card.basicLand.trim().toLowerCase())) return `"${card.basicLand}" is already a land type`;
  return null;
}

const titleCase = (text: string) =>
  text
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");

/** The model's answer as a stored card (trimmed, the lists held to 3–5
 *  mechanics in all), or null when it doesn't hold one. */
export function cardFromAnswer(answer: z.infer<typeof answerSchema>): { card: ColourCard; disc: string | null } | null {
  const card = {
    name: titleCase(answer.name),
    epithet: answer.epithet.trim(),
    philosophy: answer.philosophy.trim(),
    values: answer.values.map((v) => v.trim()).filter(Boolean).slice(0, 5),
    keyword: { name: titleCase(answer.keyword.name), reminder: answer.keyword.reminder.trim().replace(/^\(|\)$/g, "") },
    mechanics: answer.mechanics
      .map((m) => ({ name: m.name.trim(), text: m.text.trim() }))
      .filter((m) => m.name && m.text)
      .slice(0, 4),
    cannot: answer.cannot.map((c) => c.trim()).filter(Boolean).slice(0, 4),
    basicLand: titleCase(answer.basicLand.replace(/\s+/g, "")),
    sitsBetween: answer.sitsBetween,
    alliesWhy: answer.alliesWhy.trim(),
    enemiesWhy: answer.enemiesWhy.trim(),
  };
  if (card.mechanics.length < 2 || card.values.length < 3 || card.cannot.length < 2) return null;
  const parsed = colourCardSchema.safeParse(card);
  if (!parsed.success) return null;
  return { card: parsed.data, disc: normaliseHex(answer.discColor) };
}

/**
 * The colour card for a pip of `subject`, steered by the maker's `idea`
 * (what the colour stands for; may be empty). The caller runs it inside
 * `withAiTimeBudget` (structuredCall's second call only where the route can
 * still finish) and passes a signal. Throws ColourCardError when
 * no keepable card came back in two tries, AiOutputError when the answer
 * couldn't be read, or the provider's error.
 */
export async function designColourCard(input: {
  subject: string;
  idea: string;
  disc: string | null;
  /** Ends every call (the route's time limit, or the drawing failing). */
  signal?: AbortSignal;
}): Promise<{ card: ColourCard; disc: string | null }> {
  let avoid: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    input.signal?.throwIfAborted();
    const { object } = await structuredCall("pip-forge-colour", repairStructuredText(answerSchema), (experimental_repairText) =>
      generateObject({
        ...textModelOptions(judgeModel(), 0.9),
        schema: answerSchema,
        experimental_repairText,
        abortSignal: input.signal,
        system: SYSTEM,
        prompt: [
          `The colour's pip shows: ${input.subject.trim().slice(0, 200)}.`,
          input.idea.trim()
            ? `What the maker says the colour stands for: ${input.idea.trim().slice(0, 300)}`
            : "Infer what the colour stands for from its symbol.",
          input.disc ? `Its pip's disc is ${input.disc}; let the colour's mood suit it.` : null,
          avoid ? `Your last answer was refused: ${avoid}. Choose differently.` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    );
    const result = cardFromAnswer(object);
    if (!result) {
      avoid = "it left out values, mechanics or limits";
      continue;
    }
    const problem = colourCardProblem(result.card);
    if (!problem) return result;
    avoid = problem === "language" ? "it used language we don't keep" : problem;
  }
  throw new ColourCardError("The colour card couldn't be written. Try again.");
}
