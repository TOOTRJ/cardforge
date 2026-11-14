// ---------------------------------------------------------------------------
// Re-art deck (beta tool `re-art-deck`, migration 0191) — the deck's STYLE,
// what each entry of the deck becomes, the cost line and the words the
// studio says. Pure and client-safe: the studio, the server actions, the
// step and the unit tests share it.
//
// Re-art is BUILT ON Bulk Customize (lib/tools/bulk-customize/*): a deck
// entry that stands for a REAL card becomes the maker's own card exactly as
// a Bulk Customize batch makes one ("New AI art, one style", every other
// choice left as the printing has it — the same planner, the same save,
// the entry linked to its new card), and the batch runs on the AI jobs'
// one step door with the same runner. What Re-art adds is the deck's ONE
// style (one style block in every picture's prompt) and the maker's own
// cards: an entry that is already theirs gets its new picture ON its card
// (an edit of the art alone), and its old picture is kept so it can be put
// back.
//
// The maker's OWN prompts (migration 0209): the deck's prompt can be the
// tool's template (a preset and the deck's world — mode "preset") or words
// the maker wrote themselves (mode "custom", up to REART_PROMPT_MAX, with
// {card} / {name} / {type} / {flavor} / {rules} filled in per card), and any
// card can have words of its own (its subject in the deck's look, or — "only
// these words" — its whole prompt). ONE function builds every picture's
// prompt, reartArtPrompt; the studio previews with it and the step paints
// with it.
//
// The model picker (migration 0211): a run may NAME the gateway model that
// paints it (REART_MODELS — for testing; one credit a picture on any of
// them). "Automatic" is what every other tool paints with. A model other
// than FLUX.2 is sent the same prompt in PLAINER words (ReartFraming): the
// template's "Trading-card illustration of “Name”…", a quoted flavour line
// and "NO frame, NO text" are tuned for FLUX.2 and made the others paint a
// card frame with the title and the flavour text in it (tried on the dev
// key, 2026-11-13).
//
// From the card's own art (ReartMethod "restyle"; for testing, like the
// picker): a run may start each picture from a PICTURE instead of from the
// prompt alone — the real card's art on Scryfall for an entry that stands
// for a printing, else (a card of the maker's own with no printing) the art
// it had before Re-art — and repaint it in the deck's style: the same
// subject and pose, the deck's look and world. Same price, same record,
// same "old art back". The method is not part of the deck's style.
//
// A licensed property (migration 0214; owner 2026-11-13: "the user
// self-attests", by a prompt or an uploaded picture, and the pictures may
// be public): a deck's style can NAME a property the maker holds the rights
// to — every prompt of the deck then says so — after the maker confirms it
// in words that are kept (deck_ip_attestations: who, when, which property,
// the sentence itself). And a deck's style can hold a REFERENCE PICTURE the
// maker uploads: each picture painted from the prompt is then painted WITH
// it (its look, its designs, its characters). Both are part of the deck's
// look: changing either starts a new version. Nothing here checks a
// licence, and no provider offers a way to show one: a provider can still
// decline a property's names and characters, and says so in its own words.
//
// Never touched: another creator's card (it keeps its art — a deck may hold
// it, D3, but it is theirs), an emblem (owner rule for remixes: it prints
// its walker's art), the maybeboard (not the deck).
// ---------------------------------------------------------------------------

import { toolReasonOfCode } from "@/lib/tools/catalog";
import { grantIsLive, type ToolAccessPath, type ToolGrant } from "@/lib/tools/access";
import { z } from "zod";
import { STYLE_PRESETS, SURPRISE_PRESET_ID, stylePresetById } from "@/lib/ai/presets";
import { BULK_AI_ART_CREDITS_PER_FACE, BULK_VISIBILITY_VALUES, type BulkVisibility } from "@/lib/tools/bulk-customize/model";
import type { JobStep } from "@/lib/ai/generation-jobs";
import type { DeckBoard } from "@/types/deck";
import type { CardBackFace } from "@/types/card";
import type { Json } from "@/types/supabase";

/** The tool's slug in the catalog (lib/tools/catalog.ts) and in SQL
 *  (`has_tool_access`, 0191's policies). */
export const REART_TOOL_SLUG = "re-art-deck";

/** The most cards one run paints. A Commander deck is about 100 entries
 *  (fewer with its basics on one line); a deck holds at most 500 (0143). */
export const REART_MAX_CARDS = 150;

/** The most cards a SAMPLE paints — enough to judge a style. */
export const REART_SAMPLE_MAX = 3;

/** The longest description of the deck's world (0191's CHECK). */
export const REART_THEME_MAX = 300;

/** The longest prompt the maker writes for the deck themselves (0209's
 *  CHECK on deck_art_styles.prompt). */
export const REART_PROMPT_MAX = 1500;

/** The longest words for one card (0209's CHECK on deck_reart_prompts). */
export const REART_CARD_WORDS_MAX = 600;

/** The longest name of a licensed property (0214's CHECK on
 *  deck_art_styles.ip_name and deck_ip_attestations.ip_name). */
export const REART_IP_NAME_MAX = 120;

/** One credit per picture — two for a double-faced card (Bulk Customize's
 *  price, the AI deck remix's). */
export const REART_CREDITS_PER_FACE = BULK_AI_ART_CREDITS_PER_FACE;

// ---------------------------------------------------------------------------
// The model that paints (for testing)
// ---------------------------------------------------------------------------

/** How a prompt is worded for a model: "flux2" = the wording every tool
 *  sends FLUX.2 (never changed by the picker); "plain" = no quoted title,
 *  no "trading-card", no quoted flavour, and a closing line that says what
 *  the picture IS — for the models that take the first wording literally. */
export type ReartFraming = "flux2" | "plain";

/**
 * The gateway models a run may be painted with. `id` "auto" names none:
 * the image door's own default with its backup (lib/ai/image-gen.ts). Every
 * other id is a Vercel AI Gateway model, painted with alone — no backup, so
 * a card always says who painted it. The SERVER validates a run's model
 * against this list (never a user's free text).
 */
export const REART_MODELS = [
  {
    id: "auto",
    label: "Automatic",
    framing: "flux2",
    hint: "What every other tool paints with: FLUX.2 [flex], with FLUX.2 [pro] as its backup when it is slow.",
  },
  {
    id: "bfl/flux-2-pro",
    label: "FLUX.2 [pro]",
    framing: "flux2",
    hint: "Black Forest Labs' faster FLUX.2, on its own. Paints the art window's exact size.",
  },
  {
    id: "bfl/flux-kontext-pro",
    label: "FLUX.1 Kontext [pro]",
    framing: "plain",
    hint: "Black Forest Labs' editing model. It reads a shorter prompt than the others (512 tokens): a long one is cut sooner.",
    // 512 tokens (BFL's Kontext prompting guide) is about 1,800 characters:
    // the body is held so that the lines always added after it — the
    // closing line, "fully clothed", a softened rung's suffix — are still
    // inside what the model reads. Past it they were sent and never read.
    bodyMax: 1400,
  },
  {
    id: "spacexai/grok-imagine-image",
    label: "Grok Imagine",
    framing: "plain",
    hint: "xAI's first image model.",
  },
  {
    id: "spacexai/grok-imagine-image-2.0",
    label: "Grok Imagine 2.0",
    framing: "plain",
    hint: "xAI's newer image model.",
  },
  {
    id: "google/gemini-3.1-flash-image",
    label: "Gemini 3.1 Flash Image",
    framing: "plain",
    hint: "Google's image model (Nano Banana 2).",
  },
] as const satisfies ReadonlyArray<{ id: string; label: string; framing: ReartFraming; hint: string; bodyMax?: number }>;

export type ReartModelId = (typeof REART_MODELS)[number]["id"];
export const REART_MODEL_IDS = REART_MODELS.map((model) => model.id) as [ReartModelId, ...ReartModelId[]];
export const REART_DEFAULT_MODEL: ReartModelId = "auto";

/** The model of that id, or Automatic (an id the list doesn't know). */
export function reartModelOf(id: string | null | undefined): (typeof REART_MODELS)[number] {
  return REART_MODELS.find((model) => model.id === id) ?? REART_MODELS[0];
}

/** The most of a prompt's body (what comes before the lines that are always
 *  added) a run of that id sends: the model's own, shorter limit where it
 *  has one, else REART_PROMPT_BODY_MAX. */
export function reartBodyMaxOf(id: string | null | undefined): number {
  const model = reartModelOf(id);
  return "bodyMax" in model ? model.bodyMax : REART_PROMPT_BODY_MAX;
}

/** The gateway model a run of that id paints with — undefined for
 *  Automatic (the image door's own default and backup). */
export function reartGatewayModel(id: string | null | undefined): string | undefined {
  const model = reartModelOf(id);
  return model.id === "auto" ? undefined : model.id;
}

/**
 * Who may NAME the model (owner 2026-11-13: the picker is for admins and
 * testers): an admin, or an account that holds a live tester grant for the
 * tool — whatever the tool's release. Someone the tool opens for through
 * their PLAN (once it is released) paints with Automatic. The studio shows
 * the picker by it, and the start and every step refuse a named model
 * without it (a job's plan is its owner's to write).
 */
export function canPickReartModel(
  access: { via: ToolAccessPath | null; grant?: ToolGrant | null } | null | undefined,
  now?: Date,
): boolean {
  if (!access) return false;
  // "grant": the tester rule is what let them in (a beta tool). A tester of
  // a RELEASED tool comes in through their plan, and still holds the grant.
  return access.via === "admin" || access.via === "grant" || grantIsLive(access.grant, now);
}

/** What a run that names a model is told when its maker may not pick one. */
export const REART_MODEL_NOT_YOURS =
  "Choosing the model, or what a picture starts from, is for this tool's testers. Nothing was painted or charged — reload the page and start the run again.";

/** Gateway models a picture may name that are not in the picker (what
 *  Automatic paints with), by their names. */
const OTHER_MODEL_LABELS: Record<string, string> = {
  "bfl/flux-2-flex": "FLUX.2 [flex]",
  "google/gemini-2.5-flash-image": "Gemini 2.5 Flash Image",
};

/** Who painted, in words: a step's `image_model` (one gateway id, or two
 *  joined by " + " for a two-faced card painted by two models). An id
 *  nobody named is shown as it is. */
export function reartModelLabel(painted: string | null | undefined): string | null {
  if (!painted?.trim()) return null;
  return painted
    .split(" + ")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => REART_MODELS.find((model) => model.id === id && id !== "auto")?.label ?? OTHER_MODEL_LABELS[id] ?? id)
    .join(" + ");
}

// ---------------------------------------------------------------------------
// What a picture starts from (for testing)
// ---------------------------------------------------------------------------

/** "paint": the prompt alone (what the tool always did). "restyle": the
 *  card's own art, repainted — its subject and pose kept, its look changed. */
export const REART_METHODS = ["paint", "restyle"] as const;
export type ReartMethod = (typeof REART_METHODS)[number];
export const REART_DEFAULT_METHOD: ReartMethod = "paint";

export const REART_METHOD_LABELS: Record<ReartMethod, string> = {
  paint: "The prompt alone",
  restyle: "The card's own art",
};

export const REART_METHOD_HINTS: Record<ReartMethod, string> = {
  paint: "Each picture is painted new, from the prompt.",
  restyle:
    "Each picture starts from the real card's art on Scryfall — a card of your own with no printing, from the art it had before Re-art — and is repainted in the deck's style: the same subject and pose, a new look.",
};

/** The lines a restyle's prompt opens with, whoever wrote the rest: what to
 *  do with the picture. Tried on the dev key (2026-11-14) on two real
 *  cards' art across six models: a looser opening ("the same scene", "a new
 *  style and setting") let FLUX.1 Kontext paint another character and a
 *  model recompose the picture; with "this exact picture … clearly the same
 *  picture" all that answered kept every figure and pose. Without the
 *  signature line Gemini 2.5 copied the artist's signature into the new
 *  picture (it can still come through: the studio says so). */
export const REART_RESTYLE_LEAD =
  "Repaint this exact picture in a new art style. Keep every character and object, their poses and the composition as they are, so it is clearly the same picture; change the rendering, the palette, the lighting and the look of the surroundings. Remove any signature, watermark or lettering that is in the picture.";

/** What `{card}` stands for in the maker's own deck prompt when the picture
 *  starts from the card's art and the card has no words of its own. */
export const REART_RESTYLE_CARD = "the same subject";

/** The lines a prompt opens with when the picture is painted WITH the
 *  deck's reference picture (0214): the picture is the look — and the
 *  characters, where the words name them — never the composition. Tried on
 *  the dev key (2026-11-14) with a picture of our own as the reference: all
 *  six models painted a NEW picture in its look. "Do not copy its
 *  composition" alone was not enough where the deck's world IS the
 *  reference's scene: the default model kept the reference's room and
 *  swapped its subject — hence "a new scene from a new viewpoint". */
export const REART_REFERENCE_LEAD =
  "Paint a new picture in the visual style of the attached reference picture: its rendering, palette, lighting and designs — and its characters, where the words below name them. The reference shows the look only: compose a new scene from a new viewpoint, and do not reuse its composition or its background.";

/** What a run is told when it asks for both: a restyle hands the model the
 *  card's own art, and one picture is all every model is sure to take. */
export const REART_REFERENCE_WITH_RESTYLE =
  "A reference picture and “the card's own art” can't be used together yet: start each picture from the prompt, or remove the deck's reference picture.";

/** The line every prompt of a deck that names a licensed property carries
 *  (0214), before the closing line. */
export function reartIpLine(ipName: string | null | undefined): string {
  const name = cleanReartIpName(ipName);
  return name ? `Licensed artwork for ${name}: set in its world and painted in its own visual style, with its characters and designs as they are known.` : "";
}

/**
 * What the maker confirms before a deck names a licensed property — kept
 * word for word with the name, the maker and the time
 * (deck_ip_attestations). Nothing checks a licence: this sentence is the
 * maker's own.
 */
export function reartIpStatement(ipName: string | null | undefined): string {
  const name = cleanReartIpName(ipName) || "this property";
  return `I hold the rights to ${name}, or its rights holder's permission, to make art of it with AI and to publish that art on PipGlyph. I am responsible for this, and PipGlyph may ask me for proof and remove the art.`;
}

/** What a save is told when the style names a property the deck doesn't
 *  name yet and the maker's confirmation didn't come with it. */
export const REART_IP_NEEDS_CONFIRMATION =
  "Confirm that you hold the rights to this property before the deck names it. If you see no box to tick, reload the page.";

/** The most new confirmations one maker records in 24 hours: the record is
 *  append-only, so nothing else bounds it (a save that names another
 *  property each time adds a row each time). */
export const REART_IP_CONFIRMATIONS_PER_DAY = 20;
export const REART_IP_TOO_MANY = "You have confirmed a lot of properties today. Try again tomorrow, or keep the property the deck names now.";

/** What a style whose reference picture isn't one of the maker's own
 *  stored pictures is told (the server fetches it for every picture). */
export const REART_REFERENCE_NOT_YOURS = "The reference picture has to be one you uploaded here — upload it again.";

/** What a step is told when the deck's reference picture can't be read:
 *  nothing is painted or charged. */
export const REART_REFERENCE_UNREAD =
  "The deck's reference picture couldn't be read — upload it again in the deck's style, or remove it. Nothing was charged.";

/** What a picture a provider DECLINED is told on a deck that names a
 *  licensed property: providers decline some properties' names and
 *  characters whoever asks. */
export const REART_IP_BLOCKED_COPY =
  "The image service declined this picture. Image services decline some properties' names and characters whatever licence you hold: try another model, describe the look without the names, or add a reference picture.";
/** The same on a picture that had a picture with it already (the deck's
 *  reference, or the card's own art). */
export const REART_IP_BLOCKED_WITH_PICTURE_COPY =
  "The image service declined this picture. Image services decline some properties' names and characters whatever licence you hold: try another model, or describe the look without the names.";
/** A picture painted with the deck's reference picture, declined, on a deck
 *  that names no property. */
export const REART_REFERENCE_BLOCKED_COPY =
  "The image service declined to paint with the deck's reference picture. Try another model, or remove the reference picture.";

/**
 * What a picture the image service DECLINED is told, where the deck's style
 * says more than the image door can know: a deck that names a property, or
 * one painted with a reference picture. Null: the door's own sentence.
 */
export function reartBlockedCopy(style: ReartStyle, method: ReartMethod = "paint"): string | null {
  const clean = normalizeReartStyle(style);
  if (clean.ipName) return clean.referenceUrl || method === "restyle" ? REART_IP_BLOCKED_WITH_PICTURE_COPY : REART_IP_BLOCKED_COPY;
  return clean.referenceUrl && method === "paint" ? REART_REFERENCE_BLOCKED_COPY : null;
}

/** The wording a picture's prompt is in and the most of its body the model
 *  reads: a restyle — and a picture painted with the deck's reference
 *  picture — is always in the plain wording (no quoted name, no
 *  "trading-card"), and its opening lines count against the body. */
export function reartWordingOf(
  modelId: string | null | undefined,
  method: ReartMethod = "paint",
  /** The deck's style holds a reference picture. */
  hasReference = false,
): { framing: ReartFraming; bodyMax: number } {
  const bodyMax = reartBodyMaxOf(modelId);
  if (method === "restyle") return { framing: "plain", bodyMax: Math.max(1, bodyMax - REART_RESTYLE_LEAD.length - 1) };
  if (hasReference) return { framing: "plain", bodyMax: Math.max(1, bodyMax - REART_REFERENCE_LEAD.length - 1) };
  return { framing: reartModelOf(modelId).framing, bodyMax };
}

/**
 * The picture a restyle of the maker's OWN card (one with no printing)
 * starts from: the art it had BEFORE Re-art, so a re-roll doesn't restyle a
 * restyle. While the card shows the picture a row records, that is the
 * row's "art to put back"; otherwise the art on the card now (a Re-art
 * picture no row records any more — its deck was deleted — is the card's
 * own art by then). Null: no art to start from.
 *
 * The PLAN reads this deck's row; the step reads every deck's (a card can
 * be in several): a card another deck's run painted last, with no art
 * before Re-art, is planned and then stopped at its step — before any
 * charge.
 */
export function reartOwnSourceArt(
  cardArtUrl: string | null | undefined,
  painted: { artUrl: string | null; previousArtUrl: string | null } | null | undefined,
): string | null {
  if (painted?.artUrl && cardArtUrl && painted.artUrl === cardArtUrl) return painted.previousArtUrl ?? null;
  return cardArtUrl ?? null;
}

/** How a card's picture was made, in a word: "Painted" / "Restyled". */
export function reartMethodVerb(method: ReartMethod | null | undefined): string {
  return method === "restyle" ? "Restyled" : "Painted";
}

// ---------------------------------------------------------------------------
// The style
// ---------------------------------------------------------------------------

const STYLE_IDS = [SURPRISE_PRESET_ID, ...STYLE_PRESETS.map((preset) => preset.id)] as [string, ...string[]];

/** How the deck's prompt is made: the tool's template with a preset and the
 *  deck's world ("preset"), or the maker's own prompt ("custom"). */
export const REART_STYLE_MODES = ["preset", "custom"] as const;
export type ReartStyleMode = (typeof REART_STYLE_MODES)[number];

export const reartStyleSchema = z
  .object({
    /** A style preset's id, or "surprise" for none. */
    preset: z.enum(STYLE_IDS),
    /** The maker's own words about the deck's world and look. */
    theme: z.string().max(REART_THEME_MAX * 2),
    /** Absent: the template (every style saved before 0209, and a plan a
     *  run started before it). */
    mode: z.enum(REART_STYLE_MODES).default("preset"),
    /** The maker's own prompt (mode "custom"). */
    prompt: z.string().max(REART_PROMPT_MAX * 2).default(""),
    /** The licensed property the deck's pictures are of (0214). Absent: none
     *  — the key is left out of a style that names none, so every style and
     *  plan from before it reads as it did. */
    ipName: z.string().max(REART_IP_NAME_MAX * 2).optional(),
    /** The deck's reference picture: the maker's own stored picture (0214).
     *  Absent: none. */
    referenceUrl: z.string().max(600).optional(),
  })
  .strict();

/** A style as a form or a caller hands it (`mode` and `prompt` may be
 *  absent: the template; `ipName` and `referenceUrl` absent: none). */
export type ReartStyle = {
  preset: string;
  theme: string;
  mode?: ReartStyleMode;
  prompt?: string;
  ipName?: string;
  referenceUrl?: string | null;
};

/** A style as it is stored and compared: the four fields present, and the
 *  licensed property / the reference picture ONLY where the deck has one
 *  (the keys are left out otherwise). */
export type NormalReartStyle = {
  preset: string;
  theme: string;
  mode: ReartStyleMode;
  prompt: string;
  ipName?: string;
  referenceUrl?: string;
};

export const EMPTY_REART_STYLE: NormalReartStyle = { preset: SURPRISE_PRESET_ID, theme: "", mode: "preset", prompt: "" };

/** Starting points for the deck's world: the maker's words, one click
 *  away (they edit them after). Original, generic words only — no
 *  Wizards-owned or real-world proper nouns (lib/ai/presets.ts's rule). */
export const REART_THEME_IDEAS: ReadonlyArray<{ label: string; theme: string }> = [
  { label: "Sunken city", theme: "a drowned clockwork city under a green sea, brass and teal, shafts of light from above" },
  { label: "Frozen north", theme: "a frozen northern frontier, aurora skies, longhouses and rune-carved stone, cold blue light" },
  { label: "Desert dusk", theme: "a vast desert at dusk, sandstone ruins and caravans, long amber shadows and violet skies" },
  { label: "Haunted fen", theme: "a haunted fen at night, will-o'-wisps, crooked trees and drowned bell towers, cold mist" },
  { label: "Sky islands", theme: "floating islands above the clouds, waterfalls into the sky, airships and wind-worn temples" },
  { label: "Neon night", theme: "a rain-soaked neon city at night, glowing signs, chrome and steam, magenta and cyan light" },
];

// Control characters, the zero-width space and the bidi marks (the same
// set lib/ai/presets.ts cleanTwist drops).
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f؜​‎‏‪-‮⁦-⁩]/g;

/** The maker's words as a prompt takes them: unsafe characters out,
 *  whitespace folded, trimmed, clipped to `max`. */
function cleanWords(text: string | null | undefined, max: number): string {
  if (!text) return "";
  return clipAt(text.replace(UNSAFE_CHARACTERS, " ").replace(/\s+/g, " ").trim(), max);
}

/** The first `max` characters — never half of a character: a cut that
 *  lands inside a surrogate pair (an emoji, a rare CJK character) leaves a
 *  lone half the database refuses. */
function clipAt(text: string, max: number): string {
  return text.slice(0, max).replace(/[\uD800-\uDBFF]$/, "").trim();
}

/** The deck's world as the prompt takes it (clipped to REART_THEME_MAX). */
export function cleanReartTheme(text: string | null | undefined): string {
  return cleanWords(text, REART_THEME_MAX);
}

/** The maker's longer writing as it is STORED: unsafe characters out and
 *  spaces folded line by line, the maker's own line breaks kept (at most
 *  one empty line between two), trimmed, clipped to `max`. A prompt is sent
 *  on one line (flatLine). */
function cleanLines(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const folded = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(UNSAFE_CHARACTERS, " ").replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clipAt(folded, max);
}

/** Text as a prompt carries it: one line. */
const flatLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The maker's own deck prompt as it is stored (REART_PROMPT_MAX). */
export function cleanReartPrompt(text: string | null | undefined): string {
  return cleanLines(text, REART_PROMPT_MAX);
}

/** One card's own words as they are stored (REART_CARD_WORDS_MAX). */
export function cleanReartCardWords(text: string | null | undefined): string {
  return cleanLines(text, REART_CARD_WORDS_MAX);
}

/** Words that say something: a letter at least — "ox" and "火山" are
 *  subjects; a lone "." is not, and would be painted and paid for. */
export function reartWordsSaySomething(text: string | null | undefined): boolean {
  return letters(cleanReartCardWords(text)) >= 1;
}

/** A style as it is stored and compared (the preset known, the words clean,
 *  the mode named). */
export function normalizeReartStyle(style: ReartStyle): NormalReartStyle {
  const preset = stylePresetById(style.preset) ? style.preset : SURPRISE_PRESET_ID;
  const ipName = cleanReartIpName(style.ipName);
  const referenceUrl = style.referenceUrl?.trim() ?? "";
  return {
    preset,
    theme: cleanReartTheme(style.theme),
    mode: style.mode === "custom" ? "custom" : "preset",
    prompt: cleanReartPrompt(style.prompt),
    ...(ipName ? { ipName } : {}),
    ...(referenceUrl ? { referenceUrl } : {}),
  };
}

/** A licensed property's name as it is stored and sent: one line, no
 *  quotation marks (a quoted name reads to a model as words to write), no
 *  control characters, REART_IP_NAME_MAX. */
export function cleanReartIpName(name: string | null | undefined): string {
  if (!name) return "";
  const flat = name.replace(UNSAFE_CHARACTERS, " ").replace(/["“”„«»]/g, "").replace(/\s+/g, " ").trim();
  return clipAt(flat, REART_IP_NAME_MAX).trim();
}

/** The two things a deck's look has besides its prompt: the licensed
 *  property it names and the picture it is painted with. */
const sameLicence = (x: NormalReartStyle, y: NormalReartStyle) =>
  (x.ipName ?? "") === (y.ipName ?? "") && (x.referenceUrl ?? "") === (y.referenceUrl ?? "");

/** The same look: the same mode, and what that mode paints with (the
 *  maker's prompt, or the preset and the deck's world). What the other mode
 *  holds is kept for a switch back, and changes nothing a run paints. */
export function sameReartStyle(a: ReartStyle | null | undefined, b: ReartStyle | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeReartStyle(a);
  const y = normalizeReartStyle(b);
  if (x.mode !== y.mode || !sameLicence(x, y)) return false;
  return x.mode === "custom" ? x.prompt === y.prompt : x.preset === y.preset && x.theme === y.theme;
}

/** The same ROW: every field the same — the mode's own words and the other
 *  mode's draft. A form that differs only in the draft is the same look (no
 *  new version, nothing repainted) but still has something to save: the
 *  draft used to be dropped on a reload. */
export function sameReartStyleFields(a: ReartStyle | null | undefined, b: ReartStyle | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeReartStyle(a);
  const y = normalizeReartStyle(b);
  return x.mode === y.mode && x.prompt === y.prompt && x.preset === y.preset && x.theme === y.theme && sameLicence(x, y);
}

const letters = (text: string) => text.replace(/[^\p{L}]/gu, "").length;

/** Why a style can't paint yet, or null. The template needs a preset or the
 *  deck's own words (at least a few letters) — "style first"; the maker's
 *  own prompt needs to be written. */
export function reartStyleProblem(style: ReartStyle): string | null {
  const clean = normalizeReartStyle(style);
  // A property that is named is named in letters or digits ("1984", "300"
  // — but "X" or "?" is no name).
  if (style.ipName?.trim() && (clean.ipName ?? "").replace(/[^\p{L}\p{N}]/gu, "").length < 2) return "Name the licensed property.";
  if (clean.mode === "custom") {
    // The braces' names are not words of the maker's.
    return letters(clean.prompt.replace(PLACEHOLDER, " ")) < 10 ? "Write the deck's prompt first." : null;
  }
  if (clean.preset === SURPRISE_PRESET_ID && letters(clean.theme) < 3) {
    return "Pick a style or describe the deck's world first.";
  }
  return null;
}

/**
 * The ONE style block every picture of the deck shares — what keeps a run
 * consistent. The studio shows it to the maker word for word.
 */
export function reartStyleBlock(style: ReartStyle, framing: ReartFraming = "flux2"): string {
  const clean = normalizeReartStyle(style);
  const preset = stylePresetById(clean.preset);
  const look = preset
    ? `Rendered strictly in ${preset.label.toLowerCase()} style. Art direction: ${preset.art}.`
    : "Painterly fantasy illustration style.";
  return (
    framing === "plain"
      ? // No "deck", no "card": the words alone made some models paint one.
        [
          look,
          clean.theme ? `The world and look: ${clean.theme}.` : "",
          "One of a cohesive series of paintings: the same rendering technique, palette, lighting and level of detail.",
        ]
      : [
          look,
          clean.theme ? `The deck's world and look: ${clean.theme}.` : "",
          "Every card of this deck is one cohesive set: the same rendering technique, palette, lighting and level of detail.",
        ]
  )
    .filter(Boolean)
    .join(" ");
}

/** The short style the safety ladder's plain prompt keeps
 *  (lib/ai/art-prompt-safety.ts fallbackArtPrompt "Rendered strictly in …"). */
export function reartLadderStyle(style: ReartStyle): string {
  const clean = normalizeReartStyle(style);
  const label = stylePresetById(clean.preset)?.label.toLowerCase();
  const words = clean.theme.length > 90 ? `${clean.theme.slice(0, 90).replace(/\s+\S*$/, "")}` : clean.theme;
  return [label, words].filter(Boolean).join(", ") || "painterly fantasy";
}

// ---------------------------------------------------------------------------
// One card's prompt
// ---------------------------------------------------------------------------

export type ReartSubject = {
  title: string;
  typeLine: string | null;
  rulesText?: string | null;
  flavorText?: string | null;
};

/** One card's own words (0209 deck_reart_prompts): its subject, painted in
 *  the deck's look — or, `only`, its whole prompt. */
export type ReartCardWords = { text: string; only: boolean };

/** Reminder text, symbols and markup out of a card text, clipped on a word. */
function sceneWords(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const plain = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/[*_~]/g, "")
    .replace(UNSAFE_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** The line every prompt ends with, whoever wrote the rest: the picture is
 *  ART for a card, never a card. (The "fully clothed" line is added at the
 *  gateway's door, lib/ai/image-gen.ts.) */
export const REART_NO_FRAME_LINE = "NO frame, NO borders, NO card layout, NO text or lettering anywhere in the image.";

/** The same line in the PLAIN wording (ReartFraming): it says what the
 *  picture is before what it isn't. With the first line, FLUX.1 Kontext and
 *  Grok Imagine painted a card frame with a title, and Gemini a page with a
 *  white margin; with this one all three paint the art alone. */
export const REART_PLAIN_CLOSING_LINE =
  "The painting covers the entire image from edge to edge: no white margin, paper edge, border or frame, and no text, letters, signature, title or caption anywhere.";

/** The line a prompt of that wording ends with. */
export function reartClosingLine(framing: ReartFraming = "flux2"): string {
  return framing === "plain" ? REART_PLAIN_CLOSING_LINE : REART_NO_FRAME_LINE;
}

/** A card's text without its quotation marks: a quoted line reads to some
 *  models as words to WRITE in the picture. */
const unquoted = (text: string) => text.replace(/["“”„«»]/g, "").replace(/\s+/g, " ").trim();

/** The names the maker's own deck prompt may put in braces, filled in for
 *  each card. `{card}` is the card's subject: its own words when it has
 *  some, else its name and type. */
export const REART_PLACEHOLDERS: ReadonlyArray<{ token: string; label: string; hint: string }> = [
  { token: "{card}", label: "Card", hint: "The card's subject: the words you wrote for it, else its name and type." },
  { token: "{name}", label: "Name", hint: "The card's name." },
  { token: "{type}", label: "Type", hint: "The card's type line." },
  { token: "{flavor}", label: "Flavour", hint: "The card's flavour text, shortened." },
  { token: "{rules}", label: "Rules", hint: "What the card does, shortened." },
];

const PLACEHOLDER = /\{(card|name|type|flavou?r|rules)\}/gi;

/** Whether the maker's own prompt names the card at all: one that doesn't
 *  paints every card from the same words. */
export function reartPromptNamesCard(prompt: string | null | undefined): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(prompt ?? "");
}

/** Ends as a sentence (a closing quote or bracket after the stop counts). */
const withStop = (text: string) => (/[.!?…]["'”’)\]]*$/.test(text) ? text : `${text}.`);
const withoutStop = (text: string) => text.replace(/[.\s]+$/, "");
/** A card's own text as a brace's value: no stop at its end, and none of
 *  the punctuation a removed symbol leaves at its start ("{T}: Add …"). */
const braceWords = (text: string) => withoutStop(text.replace(/^[\s:;,.—–-]+/, ""));

/** `"Name", a Type line` — what `{card}` stands for on a card with no words
 *  of its own. */
export function reartCardLine(subject: ReartSubject, framing: ReartFraming = "flux2"): string {
  const title = subject.title.trim() || "an unnamed card";
  const type = subject.typeLine?.trim() ?? "";
  const name = framing === "plain" ? unquoted(title) || "an unnamed card" : `"${title}"`;
  return `${name}${type ? `, ${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}` : ""}`;
}

/** Where a brace's value came up empty, until the text around it is tidied. */
const EMPTY_SLOT = "\u0001";

/**
 * The maker's own deck prompt with its braces filled in for one card. A
 * card with words of its own puts them where `{card}` stands — or first,
 * when the prompt has no `{card}`. A name the card has nothing for takes
 * the comma, colon or semicolon before it away with it — and nothing else
 * of the maker's punctuation is touched.
 */
function fillDeckPrompt(
  prompt: string,
  subject: ReartSubject,
  own: string,
  framing: ReartFraming,
  /** What `{card}` stands for on a card with no words of its own (default:
   *  its name and type). A restyle says "the same subject": the picture is
   *  the subject, and a famous name made a model redraw the character from
   *  memory. */
  cardLine: string = reartCardLine(subject, framing),
): string {
  const text = (value: string) => (framing === "plain" ? unquoted(value) : value);
  const values: Record<string, string> = {
    card: own ? withoutStop(own) : cardLine,
    name: text(subject.title.trim()) || "an unnamed card",
    type: subject.typeLine?.trim() ?? "",
    flavor: text(braceWords(sceneWords(subject.flavorText, 200))),
    flavour: text(braceWords(sceneWords(subject.flavorText, 200))),
    rules: text(braceWords(sceneWords(subject.rulesText, 160))),
  };
  let namesCard = false;
  const filled = prompt
    .replace(PLACEHOLDER, (_whole, name: string) => {
      const key = name.toLowerCase();
      if (key === "card") namesCard = true;
      return values[key] || EMPTY_SLOT;
    })
    // An empty value that was a whole sentence goes with its stop
    // ("{flavor}. A knight" is "A knight", never ". A knight")…
    .replace(/(^|[.!?…]\s*)\u0001\s*[.!?…]+/g, "$1")
    // …any other takes the comma, colon or semicolon before it.
    .replace(/\s*[,;:]?\s*\u0001/g, "")
    .replace(/^[\s,;:]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return own && !namesCard ? `${withStop(own)} ${filled}` : filled;
}

/** The most of a prompt that is the card's and the maker's (what comes
 *  before the no-frame line). The gateway's door clips a prompt at 4,000
 *  characters from its END (lib/ai/image-gen.ts withFullyClothedLine), and a
 *  brace can be written many times — `{card}` a hundred times over is far
 *  past it — so the body is held here, and the lines that are always added
 *  (no frame, fully clothed, the softened rung's suffix) always fit. */
export const REART_PROMPT_BODY_MAX = 3000;

/** Cut at `max` (REART_PROMPT_BODY_MAX, or the picked model's own shorter
 *  limit) — on a word where one ends near the cut;
 *  text with no spaces to cut on (one long token, a script written without
 *  them) is cut where it stands rather than back to its first space. */
function clipBody(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const hard = clipAt(text, max);
  const onWord = hard.replace(/\s+\S*$/, "");
  const kept = hard.length - onWord.length > 200 ? hard : onWord;
  return { text: kept.replace(/[\s,;:]+$/, ""), cut: true };
}

/**
 * One picture's prompt — the ONE builder the studio previews with and the
 * step paints with:
 *
 *   * the card's OWN words alone, when the maker asked for only those;
 *   * the maker's own deck prompt (mode "custom") with its braces filled in
 *     for the card;
 *   * else the template: the card's subject (its own words, or its name,
 *     type line and a hint of its flavour or what it does), then the deck's
 *     shared style block. The template names no real artist and never the
 *     source's art; the maker's own words are theirs.
 *
 * Every one ends with the closing line of its wording (`framing`: FLUX.2's,
 * or the plain one a named model other than FLUX.2 is sent): the body
 * before it is held to REART_PROMPT_BODY_MAX (`cut`: it was longer, and its
 * end is left out). In FLUX.2's wording a card with no words of its own in
 * the template is, character for character, what it always was.
 */
export function buildReartPrompt(
  subject: ReartSubject,
  style: ReartStyle,
  words?: ReartCardWords | null,
  framing: ReartFraming = "flux2",
  /** The picked model's own body limit (reartBodyMaxOf), never more than
   *  the tool's. */
  bodyMax: number = REART_PROMPT_BODY_MAX,
  /** "restyle": the prompt goes with the card's own art (reartWordingOf
   *  gives its framing and body limit). */
  method: ReartMethod = "paint",
): { prompt: string; cut: boolean } {
  const clean = normalizeReartStyle(style);
  const own = flatLine(cleanReartCardWords(words?.text));
  // A deck that names a licensed property says so in every prompt, before
  // the closing line; the line's room comes out of the body's.
  const ipLine = reartIpLine(clean.ipName);
  const ipRoom = ipLine ? ipLine.length + 1 : 0;
  if (method === "restyle") {
    // The picture IS the subject: the card's name, type and text are left
    // out (a famous name made a model redraw the character from memory).
    // What is said: the opening line, the maker's words for the card (what
    // changes in it), the deck's look — or the maker's own prompt — and the
    // closing line. Always the plain wording. In the maker's own prompt
    // {card} is "the same subject"; {name}, {type}, {flavor} and {rules}
    // are still filled in where the maker wrote them — their choice.
    const said =
      own && words?.only
        ? own
        : clean.mode === "custom"
          ? fillDeckPrompt(flatLine(clean.prompt), subject, own, "plain", REART_RESTYLE_CARD)
          : [own ? withStop(own) : "", reartStyleBlock(clean, "plain")].filter(Boolean).join(" ");
    const { text, cut } = clipBody(said, Math.max(1, Math.min(bodyMax, REART_PROMPT_BODY_MAX) - ipRoom));
    const ended = clean.mode === "custom" || own ? withStop(text) : text;
    return { prompt: [REART_RESTYLE_LEAD, ended, ipLine, REART_PLAIN_CLOSING_LINE].filter(Boolean).join(" "), cut };
  }
  // Painted WITH the deck's reference picture: the plain wording, whatever
  // the model (reartWordingOf says the same to every caller), and the
  // opening lines that say what the picture is for.
  const withReference = Boolean(clean.referenceUrl);
  const wording: ReartFraming = withReference ? "plain" : framing;
  let body: string;
  if (own && words?.only) {
    body = own;
  } else if (clean.mode === "custom") {
    body = fillDeckPrompt(flatLine(clean.prompt), subject, own, wording);
  } else {
    const flavor = sceneWords(subject.flavorText, 200);
    const rules = flavor ? "" : sceneWords(subject.rulesText, 160);
    const title = subject.title.trim() || "an unnamed card";
    const subjectLines =
      wording === "plain"
        ? [
            `Fantasy illustration of ${reartCardLine(subject, "plain")}.`,
            // No quotation marks, and no stray colon a removed symbol left;
            // a line that was nothing but marks says nothing.
            flavor
              ? braceWords(unquoted(flavor))
                ? withStop(`Its mood: ${braceWords(unquoted(flavor))}`)
                : ""
              : braceWords(unquoted(rules))
                ? withStop(`As a scene, what it does: ${braceWords(unquoted(rules))}`)
                : "",
          ]
        : [
            `Trading-card illustration of "${title}"${subject.typeLine?.trim() ? `, a ${subject.typeLine.trim()}` : ""}.`,
            flavor ? `Its mood: ${flavor}` : rules ? `As a scene, what it does: ${rules}` : "",
          ];
    body = [...(own ? [withStop(own)] : subjectLines), reartStyleBlock(clean, wording)].filter(Boolean).join(" ");
  }
  const { text, cut } = clipBody(body, Math.max(1, Math.min(bodyMax, REART_PROMPT_BODY_MAX) - ipRoom));
  // The template's own block ends as it always did; the maker's words get
  // a stop when they have none.
  const ended = clean.mode === "custom" || own ? withStop(text) : text;
  return {
    prompt: [withReference ? REART_REFERENCE_LEAD : "", ended, ipLine, reartClosingLine(wording)].filter(Boolean).join(" "),
    cut,
  };
}

/** One picture's prompt (buildReartPrompt's). */
export function reartArtPrompt(
  subject: ReartSubject,
  style: ReartStyle,
  words?: ReartCardWords | null,
  framing: ReartFraming = "flux2",
  bodyMax: number = REART_PROMPT_BODY_MAX,
  method: ReartMethod = "paint",
): string {
  return buildReartPrompt(subject, style, words, framing, bodyMax, method).prompt;
}

/**
 * The prompt is the MAKER's (their own deck prompt, or the card's own
 * words): the safety ladder then never swaps it for a picture built from
 * the card's name (lib/ai/art-prompt-safety.ts exactArtPromptLadder) — a
 * prompt the provider refuses fails, with its credit back, and the maker
 * rewords it.
 */
export function reartPromptIsMakers(style: ReartStyle, words?: ReartCardWords | null): boolean {
  return normalizeReartStyle(style).mode === "custom" || Boolean(cleanReartCardWords(words?.text));
}

// ---------------------------------------------------------------------------
// What each entry becomes
// ---------------------------------------------------------------------------

/** "printing" = a real card the run makes the maker's own; "own" = the
 *  maker's own card, which gets new art on it; "skip" = left as it is. */
export type ReartEntryKind = "printing" | "own" | "skip";

export type ReartClassified =
  | { kind: "printing" }
  | { kind: "own" }
  | { kind: "skip"; reason: "maybeboard" | "other_creator" | "emblem" | "gone" | "not_real"; message: string };

export const REART_SKIP_COPY = {
  maybeboard: "On the maybeboard — not part of the deck.",
  other_creator: "Another creator's card keeps its own art.",
  emblem: "Emblems keep their art.",
  gone: "No longer available.",
  not_real: "Not a real card yet — pick its printing or make it first.",
} as const;

/** A restyle only: a card of the maker's own with no printing and no art of
 *  its own to start from is left as it is (nothing is charged). */
export const REART_NO_ART_COPY = "No art of its own to restyle — paint it from the prompt instead.";

/** What one entry of the deck becomes in a run. Pure: the server's plan
 *  and the studio's list read the same answer. */
export function classifyReartEntry(input: {
  board: DeckBoard | string;
  cardId: string | null;
  scryfallId: string | null;
  typeLine?: string | null;
  /** The linked card as the owner reads it (null: gone or unreadable). */
  card: { owner_id: string; card_type?: string | null } | null;
  ownerId: string;
}): ReartClassified {
  const skip = (reason: keyof typeof REART_SKIP_COPY): ReartClassified => ({ kind: "skip", reason, message: REART_SKIP_COPY[reason] });
  if (input.board === "maybe") return skip("maybeboard");
  if (input.cardId) {
    if (!input.card) return skip("gone");
    if (input.card.owner_id !== input.ownerId) return skip("other_creator");
    if (input.card.card_type === "emblem") return skip("emblem");
    return { kind: "own" };
  }
  if (!input.scryfallId || !/^[0-9a-f-]{8,64}$/i.test(input.scryfallId)) return skip("not_real");
  if (/\bemblem\b/i.test(input.typeLine ?? "")) return skip("emblem");
  return { kind: "printing" };
}

/** Which entries a run takes. */
export const REART_SCOPE_VALUES = ["all", "own", "printings"] as const;
export type ReartScope = (typeof REART_SCOPE_VALUES)[number];

export const REART_SCOPE_LABELS: Record<ReartScope, string> = {
  all: "Every card",
  own: "Only my own cards",
  printings: "Only the real cards",
};

export const REART_SCOPE_HINTS: Record<ReartScope, string> = {
  all: "Real cards become your own cards with the new art; your own cards get new art on them.",
  own: "New art on the cards you made. Real cards are left as they are and take no card slots.",
  printings: "Real cards become your own cards with the new art. Your own cards keep theirs.",
};

export function scopeTakes(scope: ReartScope, kind: ReartEntryKind): boolean {
  if (kind === "skip") return false;
  if (scope === "own") return kind === "own";
  if (scope === "printings") return kind === "printing";
  return true;
}

export { BULK_VISIBILITY_VALUES as REART_VISIBILITY_VALUES };
export type ReartVisibility = BulkVisibility;

/**
 * How the real cards a run turns into the maker's own are shown unless the
 * maker picks otherwise: PRIVATE (owner 2026-11-10). A run makes up to 150
 * near-copies of real cards with new art; public by default put every one
 * of them — samples included — in the gallery, the hubs and the sitemap
 * without anyone choosing that. The ONE default: the studio's picker opens
 * on it, the start action falls back to it, and the schema defaults to it.
 */
export const REART_DEFAULT_VISIBILITY: ReartVisibility = "private";

// ---------------------------------------------------------------------------
// The cost line
// ---------------------------------------------------------------------------

export type ReartCost = {
  /** Cards the run paints. */
  cards: number;
  /** Of those, the real cards it makes the maker's own (each a slot). */
  makes: number;
  credits: number;
  /** Saved-card slots left AFTER the run, or null = no limit. */
  slotsLeftAfter: number | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** "Re-arts 64 cards · 64 credits · 12 slots left" — before anything is
 *  charged. A plan with no card limit says nothing about slots. */
export function reartCostLine(cost: ReartCost): string {
  const parts = [`Re-arts ${plural(cost.cards, "card")}`, plural(cost.credits, "credit")];
  if (cost.slotsLeftAfter !== null) parts.push(`${plural(Math.max(0, cost.slotsLeftAfter), "slot")} left`);
  return parts.join(" · ");
}

/** The line under it: what happens to which cards. */
export function reartCostDetail(cost: ReartCost): string {
  const own = cost.cards - cost.makes;
  const parts: string[] = [];
  if (cost.makes > 0) parts.push(`${plural(cost.makes, "real card")} become${cost.makes === 1 ? "s" : ""} your own (${plural(cost.makes, "slot")})`);
  if (own > 0) parts.push(`${plural(own, "card")} of yours get${own === 1 ? "s" : ""} new art`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// The sample
// ---------------------------------------------------------------------------

/** A broad kind of card for picking a varied sample. */
export function typeBucketOf(typeLine: string | null | undefined, cardType?: string | null): string {
  const words = `${cardType ?? ""} ${typeLine ?? ""}`.toLowerCase();
  if (/\bcreature\b/.test(words)) return "creature";
  if (/\bplaneswalker\b/.test(words)) return "planeswalker";
  if (/\bland\b/.test(words)) return "land";
  if (/\b(instant|sorcery)\b/.test(words)) return "spell";
  if (/\b(artifact|enchantment|battle)\b/.test(words)) return "permanent";
  return "other";
}

/**
 * Up to REART_SAMPLE_MAX entries to try a style on: the commander first
 * (the face of the deck), then one of each kind of card — a creature, a
 * spell, a land… — so a style is judged on what it must paint. Cards
 * already in the style come last. Pure; ties keep the deck's order.
 */
export function suggestReartSample(
  entries: ReadonlyArray<{ id: string; board: string; bucket: string; inStyle: boolean }>,
  max = REART_SAMPLE_MAX,
): string[] {
  const ordered = [...entries].sort((a, b) => Number(a.inStyle) - Number(b.inStyle));
  const picked: string[] = [];
  const buckets = new Set<string>();
  for (const entry of ordered) {
    if (picked.length >= max) break;
    if (entry.board === "commander" && !entry.inStyle) {
      picked.push(entry.id);
      buckets.add(entry.bucket);
    }
  }
  for (const bucket of ["creature", "spell", "land", "permanent", "planeswalker", "other"]) {
    if (picked.length >= max) break;
    if (buckets.has(bucket)) continue;
    const next = ordered.find((entry) => entry.bucket === bucket && !picked.includes(entry.id));
    if (next) {
      picked.push(next.id);
      buckets.add(bucket);
    }
  }
  for (const entry of ordered) {
    if (picked.length >= max) break;
    if (!picked.includes(entry.id)) picked.push(entry.id);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// The run's request (start / plan)
// ---------------------------------------------------------------------------

const UUID = z.string().uuid();

export const reartRunSchema = z
  .object({
    deckId: UUID,
    /** The style to paint in — saved as the deck's on start. Absent: the
     *  deck's stored style (a re-roll paints in it). */
    style: reartStyleSchema.optional(),
    scope: z.enum(REART_SCOPE_VALUES).default("all"),
    visibility: z.enum(BULK_VISIBILITY_VALUES).default(REART_DEFAULT_VISIBILITY),
    /** Paint exactly these entries (a sample, a re-roll), whether or not
     *  they are in the style already. Absent: every entry of the scope not
     *  yet in the style. */
    entryIds: z.array(UUID).min(1).max(REART_MAX_CARDS).optional(),
    /** The run is a sample (said in the run's history). */
    sample: z.boolean().optional(),
    /** The model that paints the run (REART_MODELS; for testing). */
    model: z.enum(REART_MODEL_IDS).default(REART_DEFAULT_MODEL),
    /** What each picture starts from (REART_METHODS; for testing). */
    method: z.enum(REART_METHODS).default(REART_DEFAULT_METHOD),
    /** The maker confirmed, in this request, the sentence about the
     *  licensed property the style names (reartIpStatement) — needed, and
     *  recorded, only when the deck doesn't name that property yet. */
    attested: z.boolean().optional(),
  })
  .strict()
  .refine((run) => !run.sample || (run.entryIds !== undefined && run.entryIds.length <= REART_SAMPLE_MAX), {
    message: `A sample is up to ${REART_SAMPLE_MAX} named cards.`,
  });

export type ReartRunInput = z.input<typeof reartRunSchema>;

/** The step key of entry `index`. */
export function reartStepKey(index: number): string {
  return `reart:${index}`;
}

// ---------------------------------------------------------------------------
// The studio's view of one entry (the page builds it; client-safe data)
// ---------------------------------------------------------------------------

/** Where an entry stands against the deck's saved style: painted in it,
 *  painted and then given its own art back ("kept"), painted in it but
 *  showing OTHER art now ("changed": the maker's editor, a run of another
 *  deck that holds the card, or that deck's "old art back"), painted in an
 *  earlier style, or never painted (null). */
export type ReartEntryState = "in_style" | "kept" | "changed" | "earlier" | null;

/** The picture Re-art painted is the one the card shows now (its front).
 *  A record of a paint is not the paint: the card's art can be changed in
 *  the editor, or by a run of another deck that holds the card. */
export function reartArtIsOnCard(
  painted: { artUrl: string | null } | null | undefined,
  cardArtUrl: string | null | undefined,
): boolean {
  return Boolean(painted?.artUrl && cardArtUrl && painted.artUrl === cardArtUrl);
}

/**
 * An own card's state against the style version a run paints in — the ONE
 * answer the studio's list, the plan and the step read. "In this style" is
 * said only while Re-art's picture is still on the card; a card painted in
 * this version that shows other art now is "changed": it is never called
 * in the style, and a run over the deck leaves it as it is (the art on it
 * is someone's later choice — a re-roll paints it).
 */
export function reartEntryState(input: {
  painted: { styleVersion: number; artUrl: string | null } | null | undefined;
  /** The deck's style version (null: no style saved). */
  styleVersion: number | null;
  /** The art the card shows now. */
  cardArtUrl: string | null | undefined;
}): ReartEntryState {
  const { painted } = input;
  if (!painted) return null;
  if (input.styleVersion === null || painted.styleVersion !== input.styleVersion) return "earlier";
  if (!painted.artUrl) return "kept";
  return reartArtIsOnCard(painted, input.cardArtUrl) ? "in_style" : "changed";
}

/** A run over the deck leaves the card as it is — and charges nothing for
 *  it: painted in this style and still showing it, given its own art back
 *  from the tool ("kept"), or painted in this style and given other art
 *  since ("changed"). Only a NAMED paint (a sample, a re-roll) paints one. */
export function reartStateIsSettled(state: ReartEntryState): boolean {
  return state === "in_style" || state === "kept" || state === "changed";
}

/** Counted as in the deck's style (the studio's header and its "In this
 *  style" filter): never a card that shows other art now. */
export function reartStateCountsInStyle(state: ReartEntryState): boolean {
  return state === "in_style" || state === "kept";
}

/** Why a run over the deck leaves a "changed" card (the confirm's list). */
export const REART_CHANGED_COPY = "Has other art now — re-roll it to paint it in this style.";

/** What the card shows now, for the one-card confirm's words: a picture
 *  Re-art painted — from ANY of the maker's decks: painting it again
 *  replaces that picture for good — the maker's own art (it can be put
 *  back), none, or "unknown" (the other decks couldn't be asked: the
 *  confirm promises nothing either way). */
export type ReartArtNow = "reart" | "own" | "none" | "unknown";

/**
 * What the studio says about one of the maker's own cards — pure, so the
 * page's reading is tested: its state against the style, whether "Put the
 * old art back" can work (the action refuses a card Re-art made, one with
 * no earlier art, and one that shows other art now), and what it shows now.
 */
export function reartCardFacts(input: {
  /** THIS deck's row for the card. */
  painted:
    | { styleVersion: number; artUrl: string | null; made: boolean; previousArtUrl: string | null }
    | null
    | undefined;
  /** The deck's style version (null: no style saved). */
  styleVersion: number | null;
  cardArtUrl: string | null | undefined;
  /** Every picture Re-art has on record for the card, from any of the
   *  maker's decks (a card can be in several). */
  reartPictures: ReadonlyArray<string>;
  /** False when that read failed (default: it is known). */
  reartPicturesKnown?: boolean;
}): { state: ReartEntryState; canRestore: boolean; artNow: ReartArtNow } {
  const { painted, cardArtUrl } = input;
  const onCard = reartArtIsOnCard(painted, cardArtUrl);
  return {
    state: reartEntryState({ painted, styleVersion: input.styleVersion, cardArtUrl }),
    canRestore: Boolean(painted && !painted.made && painted.previousArtUrl && onCard),
    artNow: !cardArtUrl
      ? "none"
      : // This deck's own row is enough to know (never the other read alone).
        onCard || input.reartPictures.includes(cardArtUrl)
        ? "reart"
        : input.reartPicturesKnown === false
          ? "unknown"
          : "own",
  };
}

export type ReartStudioEntry = {
  id: string;
  name: string;
  quantity: number;
  board: DeckBoard;
  typeLine: string | null;
  /** The printing's picture (Scryfall), for a real card's tile. */
  imageUrl: string | null;
  kind: ReartEntryKind;
  skipMessage: string | null;
  /** The maker's own card (kind "own"), as the deck page reads it. */
  card: import("@/lib/decks/queries").DeckPageCard | null;
  bucket: string;
  state: ReartEntryState;
  /** "Put the old art back" is offered. */
  canRestore: boolean;
  /** What the card shows now (the one-card confirm's words). */
  artNow: ReartArtNow;
  /** The card's own words (0209), or null. */
  words: ReartCardWords | null;
  /** Who painted the picture Re-art put on the card (0211), in words —
   *  null: not painted by Re-art, or painted before it was recorded. */
  paintedBy: string | null;
  /** That picture was repainted from the card's own art (0212), not painted
   *  from the prompt alone. */
  restyled: boolean;
  /** The card's own text, for the prompt's preview — the maker's own card;
   *  a real card's is read from its printing when it is painted (null). */
  rulesText: string | null;
  flavorText: string | null;
  /** What painting it costs (a real card's is confirmed at plan time). */
  credits: number;
};

/** Words for an entry's state. */
export function reartStateLabel(entry: Pick<ReartStudioEntry, "kind" | "state" | "skipMessage">): string {
  if (entry.kind === "skip") return entry.skipMessage ?? "Left as it is";
  if (entry.state === "in_style") return "In this style";
  if (entry.state === "kept") return "Kept its own art";
  if (entry.state === "changed") return "Has other art now";
  if (entry.state === "earlier") return "Painted in an earlier style";
  return entry.kind === "printing" ? "Real card — becomes yours" : "Your card — not painted yet";
}

// ---------------------------------------------------------------------------
// A run's outcome, for the tool's log (the studio's `run_finished` event)
// ---------------------------------------------------------------------------

/** Why the runner stopped: every card settled, the maker's Stop, a plan
 *  limit (the card limit, an empty balance), or a door it couldn't pass. */
export type ReartRunStop = "done" | "cancelled" | "capacity" | "credits" | "error";

/** A run as the log names it: a sample, named cards (paint one, a re-roll)
 *  or the deck — from the job's own request. */
export function reartRunMode(request: { sample?: unknown; reroll?: unknown } | null | undefined): "sample" | "cards" | "deck" {
  return request?.sample === true ? "sample" : request?.reroll === true ? "cards" : "deck";
}

type OutcomeStep = Pick<JobStep, "key" | "status" | "credits" | "spend_ref" | "failure" | "error_code">;

const stepsDone = (steps: ReadonlyArray<OutcomeStep>) => steps.filter((step) => step.status === "done").length;
/** The credits really taken: a done step carries its charge's ref only when
 *  the ledger was debited (lib/ai/credited-step.ts) — never an admin's, a
 *  billing-off run's or a card found in the style already. */
const stepsCharged = (steps: ReadonlyArray<OutcomeStep>) =>
  steps.reduce((sum, step) => sum + (step.status === "done" && step.spend_ref ? (step.credits ?? 1) : 0), 0);

/**
 * What ONE pass of the runner did — from the job's steps as the pass began
 * and as it ended — as the props of `run_finished`: numbers and codes only,
 * never a card's name. `painted`, `credits` and `failed` are this pass's
 * own (a run that is continued reports each pass, and the passes add up);
 * `waiting` is the cards still to paint when it ended.
 */
export function reartRunOutcome(input: {
  before: ReadonlyArray<OutcomeStep>;
  after: ReadonlyArray<OutcomeStep>;
  /** The pass ran the failed cards again (Continue / Try the failed ones
   *  again): every card failed now failed in it. A first pass runs only the
   *  cards still waiting, so a card that had failed before it is not its. */
  retried: boolean;
  stoppedBy: "CARD_CAPACITY" | "INSUFFICIENT_CREDITS" | null;
  /** The runner ended on a door error. */
  error: boolean;
}): {
  cards: number;
  painted: number;
  failed: number;
  waiting: number;
  credits: number;
  stopped: ReartRunStop;
  top_failure?: string;
} {
  const { before, after } = input;
  const failedBefore = new Set(before.filter((step) => step.status === "failed").map((step) => step.key));
  const failedInPass = after.filter((step) => step.status === "failed" && (input.retried || !failedBefore.has(step.key)));
  const waiting = after.filter((step) => step.status === "pending" || step.status === "running").length;
  const stopped: ReartRunStop =
    input.stoppedBy === "CARD_CAPACITY"
      ? "capacity"
      : input.stoppedBy === "INSUFFICIENT_CREDITS"
        ? "credits"
        : input.error
          ? "error"
          : waiting > 0
            ? "cancelled"
            : "done";
  // Why the failed cards failed, as the commonest code: the failure kind
  // (lib/ai/failure.ts), a plan limit's code, or "refused" (stopped before
  // any charge: the style changed, the card left the deck).
  const reasons = new Map<string, number>();
  for (const step of failedInPass) {
    const reason = step.failure ?? (step.error_code ? toolReasonOfCode(step.error_code) : "refused");
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const top = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    cards: after.length,
    painted: Math.max(0, stepsDone(after) - stepsDone(before)),
    failed: failedInPass.length,
    waiting,
    credits: Math.max(0, stepsCharged(after) - stepsCharged(before)),
    stopped,
    ...(top ? { top_failure: top } : {}),
  };
}

/**
 * A stored back face resent with new art: the picture, its fit and its
 * credit replaced, every other key as stored. A null keeps the key OUT (the
 * back's schema takes a text or nothing, never null).
 */
export function withBackArt(
  back: CardBackFace,
  artUrl: string | null,
  artPosition: Json | null,
  artistCredit: string | null,
): CardBackFace {
  const { art_url: _url, art_position: _position, artist_credit: _credit, ...rest } = back as CardBackFace & {
    art_url?: unknown;
    art_position?: unknown;
    artist_credit?: unknown;
  };
  void _url;
  void _position;
  void _credit;
  return {
    ...rest,
    ...(artUrl ? { art_url: artUrl } : {}),
    ...(artUrl && artPosition ? { art_position: artPosition } : {}),
    ...(artistCredit ? { artist_credit: artistCredit } : {}),
  } as CardBackFace;
}
