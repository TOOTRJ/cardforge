import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { designModel } from "@/lib/ai/provider";
import { textModelOptions } from "@/lib/ai/sampling";
import { repairStructuredText, structuredCall } from "@/lib/ai/structured-output";
import { stylePresetById } from "@/lib/ai/presets";
import { REART_SCENE_MAX, cleanReartCardWords, normalizeReartStyle, reartWordsSaySomething, type ReartStyle } from "@/lib/tools/re-art/model";

// ---------------------------------------------------------------------------
// The scene one card's picture shows, written by the text model (Re-art
// deck's "Write a scene with AI", migration 0217) — ONE design call a card.
//
// What it writes becomes the card's OWN WORDS (0209), and a card's own
// words REPLACE the card's name and type in its picture's prompt
// (model.ts buildReartPrompt): the scene must say what is seen by itself.
// The deck's look is added to every prompt after it, so the scene names no
// style; "no text, no frame" and "fully clothed" are added at the picture's
// door, and said here too so the writer doesn't work against them. A prompt
// that is the maker's own is never swapped for a safer one when a provider
// refuses it (reartPromptIsMakers) — so the writer is told to keep clear of
// what providers refuse.
// ---------------------------------------------------------------------------

/** The AI call's label: its ledger reason, its rate-limit row, and the
 *  reason the admin's Tools tab counts as this tool's cost (0217). */
export const REART_SCENE_AI_LABEL = "deck_reart_scene" as const;
/** The tool's log: a scene written (a use, with the credit it cost) … */
export const REART_SCENE_EVENT = "write_scene";
/** … and every refusal or failure past the tool's gate. */
export const REART_SCENE_FAILED_EVENT = "write_scene_failed";

const clamp = (max: number) => z.string().transform((value) => value.replace(/\s+/g, " ").trim().slice(0, max * 2));

export const reartSceneSchema = z.object({
  scene: clamp(REART_SCENE_MAX).describe(
    "The scene the card's illustration shows: one or two sentences, at most 50 words, in plain present tense. What the eye sees — who or what, doing what, where, in what light.",
  ),
});

export const REART_SCENE_SYSTEM = [
  "You are the art director of a fantasy trading-card game. For ONE card you write the scene its illustration shows, as a brief for a painter.",
  "Write one or two sentences, at most 50 words, in plain present tense: who or what is in the picture, what is happening at this moment, where, and the light or mood.",
  "Describe only what the eye sees. Do not use the card's name as if the painter knew it: say what the thing looks like. No game words (mana, tap, counter, turn, power, toughness, numbers from the rules).",
  "Name no art style, medium, artist, camera or rendering: the deck's look is added separately.",
  "No text, lettering, logos, borders or card frames in the picture. Everyone is fully clothed. No gore, no real people, no brands, and no characters or places from books, films, games or other franchises unless the deck's world is given as one.",
  "A land is a place: describe the place. An instant or a sorcery is an event: show the spell happening. An artifact or equipment is the object, in use or at rest. A creature or a planeswalker is a figure in a moment of action or stillness that fits what the card does.",
  "Fit the deck's world when one is given. When the maker gives a direction, follow it: it is what they want to see.",
].join(" ");

export type SceneSubject = {
  name: string;
  typeLine: string | null;
  /** A PipGlyph card's own rules and flavour text (a real card's isn't
   *  stored with a deck: its name and type are what the writer gets). */
  rulesText: string | null;
  flavorText: string | null;
};

const flat = (text: string | null | undefined, max: number) => (text ?? "").replace(/\{[^}]*\}/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The brief the writer is given for one card — pure, so a test reads it. */
export function reartSceneBrief(subject: SceneSubject, style: ReartStyle | null, note: string | null): string {
  const clean = style ? normalizeReartStyle(style) : null;
  const preset = clean ? stylePresetById(clean.preset) : undefined;
  const rules = flat(subject.rulesText, 320);
  const flavor = flat(subject.flavorText, 220);
  const direction = flat(cleanReartCardWords(note), 400);
  return [
    `Card: ${flat(subject.name, 160) || "Unnamed card"}`,
    flat(subject.typeLine, 120) ? `Type: ${flat(subject.typeLine, 120)}` : null,
    rules ? `What it does: ${rules}` : null,
    flavor ? `Its flavour text: ${flavor}` : null,
    clean?.ipName ? `The deck's world: ${clean.ipName} (the maker holds the rights to it).` : null,
    clean?.mode === "custom"
      ? flat(clean.prompt, 500)
        ? `The deck's own picture prompt, for context only (do not repeat its style words): ${flat(clean.prompt, 500)}`
        : null
      : flat(clean?.theme, 300)
        ? `The deck's world: ${flat(clean?.theme, 300)}`
        : null,
    clean?.mode !== "custom" && preset ? `It will be painted as: ${preset.label} (context only: do not name it).` : null,
    direction ? `The maker's direction for this card: ${direction}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The writer declining — in a scene's place (how the answer BEGINS). A
 *  scene may begin "Unable to rise, a wounded griffin…": only a refusal's
 *  own verbs follow "unable to" here. */
const DECLINES =
  /^(?:i['’]?m sorry|i am sorry|sorry[,.! ]|my apologies|i apologi[sz]e|unfortunately,? i\b|i['’]?m afraid i\b|i am afraid i\b|i can(?:['’]t|not| not)\b|i['’]?m (?:unable|not able)|i am (?:unable|not able)|i (?:won['’]t|will not|must decline|do not feel|don['’]t feel)\b|as an ai\b|this request (?:goes against|violates|is not)|unable to (?:help|comply|write|assist|provide|create|generate|describe|fulfil+)\b|cannot (?:help|comply|write|assist))/i;
/** …or saying it has nothing (the WHOLE answer: a scene may begin "Nothing
 *  stirs in the drowned chapel…"). */
const SAYS_NOTHING = /^(?:n\s*\/?\s*a|none|nothing|no scene|unknown)[.!…]*$/i;
/** Writing that sets no spaces between words (Japanese, Chinese, Korean…). */
const UNSPACED_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;

/**
 * Whether the text is a SCENE: enough to paint from, and not the writer
 * declining ("I'm sorry, but I can't help with that"), which would be
 * saved, charged for and painted from in a batch nobody reads. Writing
 * that sets no spaces between words counts by its characters.
 */
export function reartSceneSaysSomething(text: string): boolean {
  const scene = text.trim();
  if (!reartWordsSaySomething(scene) || DECLINES.test(scene) || SAYS_NOTHING.test(scene)) return false;
  return scene.split(/\s+/).length >= 4 || (UNSPACED_SCRIPT.test(scene) && [...scene].length >= 8);
}

/** A scene as it is stored: clean, within the scene's limit, ending on a
 *  whole sentence or word. Empty when it is no scene at all. */
export function cleanReartScene(text: string | null | undefined): string {
  const flatText = cleanReartCardWords(text).replace(/\s+/g, " ").trim();
  // A PAIR of quotation marks round the whole scene says nothing; a lone
  // mark at one end — or marks round its first and last words — belong to
  // the text.
  const paired = /^["“‘'](.+)["”’']$/.exec(flatText);
  const bare = (paired && !/["“”‘’']/.test(paired[1]) ? paired[1] : flatText).trim();
  if (bare.length <= REART_SCENE_MAX) return reartSceneSaysSomething(bare) ? bare : "";
  // Past the limit: back to the last sentence end, else the last whole
  // word — and where there is no space to go back to (a language written
  // without them), the limit itself.
  const head = bare.slice(0, REART_SCENE_MAX);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  const space = head.lastIndexOf(" ");
  const cut =
    stop >= REART_SCENE_MAX / 2
      ? head.slice(0, stop + 1)
      : space >= REART_SCENE_MAX / 2
        ? head.slice(0, space).replace(/[,;:—–-]+$/, "").trim()
        : head.trim();
  return reartSceneSaysSomething(cut) ? cut : "";
}

/** Thrown when the writer answered, but with nothing a picture can show. */
export class EmptySceneError extends Error {
  constructor() {
    super("The scene came back empty.");
    this.name = "AiOutputError";
  }
}

/** Writes one card's scene. Throws on a provider failure, an unreadable
 *  answer or an empty scene — the caller refunds. */
export async function writeReartScene(subject: SceneSubject, style: ReartStyle | null, note: string | null): Promise<string> {
  const { object } = await structuredCall("re-art-scene", repairStructuredText(reartSceneSchema), (experimental_repairText) =>
    generateObject({
      ...textModelOptions(designModel(), 0.8),
      schema: reartSceneSchema,
      experimental_repairText,
      system: REART_SCENE_SYSTEM,
      prompt: reartSceneBrief(subject, style, note),
    }),
  );
  const scene = cleanReartScene(object.scene);
  if (!scene) throw new EmptySceneError();
  return scene;
}
