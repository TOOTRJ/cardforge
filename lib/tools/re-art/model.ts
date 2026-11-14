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
// Never touched: another creator's card (it keeps its art — a deck may hold
// it, D3, but it is theirs), an emblem (owner rule for remixes: it prints
// its walker's art), the maybeboard (not the deck).
// ---------------------------------------------------------------------------

import { toolReasonOfCode } from "@/lib/tools/catalog";
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

/** One credit per picture — two for a double-faced card (Bulk Customize's
 *  price, the AI deck remix's). */
export const REART_CREDITS_PER_FACE = BULK_AI_ART_CREDITS_PER_FACE;

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
  })
  .strict();

/** A style as a form or a caller hands it (`mode` and `prompt` may be
 *  absent: the template). */
export type ReartStyle = { preset: string; theme: string; mode?: ReartStyleMode; prompt?: string };

/** A style as it is stored and compared: every field present. */
export type NormalReartStyle = Required<ReartStyle>;

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
  return {
    preset,
    theme: cleanReartTheme(style.theme),
    mode: style.mode === "custom" ? "custom" : "preset",
    prompt: cleanReartPrompt(style.prompt),
  };
}

/** The same look: the same mode, and what that mode paints with (the
 *  maker's prompt, or the preset and the deck's world). What the other mode
 *  holds is kept for a switch back, and changes nothing a run paints. */
export function sameReartStyle(a: ReartStyle | null | undefined, b: ReartStyle | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeReartStyle(a);
  const y = normalizeReartStyle(b);
  if (x.mode !== y.mode) return false;
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
  return x.mode === y.mode && x.prompt === y.prompt && x.preset === y.preset && x.theme === y.theme;
}

const letters = (text: string) => text.replace(/[^\p{L}]/gu, "").length;

/** Why a style can't paint yet, or null. The template needs a preset or the
 *  deck's own words (at least a few letters) — "style first"; the maker's
 *  own prompt needs to be written. */
export function reartStyleProblem(style: ReartStyle): string | null {
  const clean = normalizeReartStyle(style);
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
export function reartStyleBlock(style: ReartStyle): string {
  const clean = normalizeReartStyle(style);
  const preset = stylePresetById(clean.preset);
  return [
    preset
      ? `Rendered strictly in ${preset.label.toLowerCase()} style. Art direction: ${preset.art}.`
      : "Painterly fantasy illustration style.",
    clean.theme ? `The deck's world and look: ${clean.theme}.` : "",
    "Every card of this deck is one cohesive set: the same rendering technique, palette, lighting and level of detail.",
  ]
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
export function reartCardLine(subject: ReartSubject): string {
  const title = subject.title.trim() || "an unnamed card";
  const type = subject.typeLine?.trim() ?? "";
  return `"${title}"${type ? `, ${/^[aeiou]/i.test(type) ? "an" : "a"} ${type}` : ""}`;
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
function fillDeckPrompt(prompt: string, subject: ReartSubject, own: string): string {
  const values: Record<string, string> = {
    card: own ? withoutStop(own) : reartCardLine(subject),
    name: subject.title.trim() || "an unnamed card",
    type: subject.typeLine?.trim() ?? "",
    flavor: braceWords(sceneWords(subject.flavorText, 200)),
    flavour: braceWords(sceneWords(subject.flavorText, 200)),
    rules: braceWords(sceneWords(subject.rulesText, 160)),
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

/** Cut at REART_PROMPT_BODY_MAX — on a word where one ends near the cut;
 *  text with no spaces to cut on (one long token, a script written without
 *  them) is cut where it stands rather than back to its first space. */
function clipBody(text: string): { text: string; cut: boolean } {
  if (text.length <= REART_PROMPT_BODY_MAX) return { text, cut: false };
  const hard = clipAt(text, REART_PROMPT_BODY_MAX);
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
 * Every one ends with the no-frame line: the body before it is held to
 * REART_PROMPT_BODY_MAX (`cut`: it was longer, and its end is left out).
 */
export function buildReartPrompt(
  subject: ReartSubject,
  style: ReartStyle,
  words?: ReartCardWords | null,
): { prompt: string; cut: boolean } {
  const clean = normalizeReartStyle(style);
  const own = flatLine(cleanReartCardWords(words?.text));
  let body: string;
  if (own && words?.only) {
    body = own;
  } else if (clean.mode === "custom") {
    body = fillDeckPrompt(flatLine(clean.prompt), subject, own);
  } else {
    const flavor = sceneWords(subject.flavorText, 200);
    const rules = flavor ? "" : sceneWords(subject.rulesText, 160);
    const title = subject.title.trim() || "an unnamed card";
    body = [
      ...(own
        ? [withStop(own)]
        : [
            `Trading-card illustration of "${title}"${subject.typeLine?.trim() ? `, a ${subject.typeLine.trim()}` : ""}.`,
            flavor ? `Its mood: ${flavor}` : rules ? `As a scene, what it does: ${rules}` : "",
          ]),
      reartStyleBlock(clean),
    ]
      .filter(Boolean)
      .join(" ");
  }
  const { text, cut } = clipBody(body);
  // The template's own block ends as it always did; the maker's words get
  // a stop when they have none.
  const ended = clean.mode === "custom" || own ? withStop(text) : text;
  return { prompt: `${ended} ${REART_NO_FRAME_LINE}`, cut };
}

/** One picture's prompt (buildReartPrompt's). */
export function reartArtPrompt(subject: ReartSubject, style: ReartStyle, words?: ReartCardWords | null): string {
  return buildReartPrompt(subject, style, words).prompt;
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
