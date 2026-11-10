// ---------------------------------------------------------------------------
// Pip Forge — what FLUX is asked for, and what it is never asked for.
//
// FLUX draws ONLY the glyph, black on white (owner 2026-11-08, the approved
// research: "the AI draws only the glyph"): the forge keys the white away,
// cleans the shape for card size and puts it on our own disc
// (lib/tools/pip-forge/glyph.ts). A model never draws the disc.
//
// The guard runs before any credit is reserved, and the form says it before
// a press:
//   * Set Symbol Studio's guard, shared (lib/tools/set-symbol/prompt.ts):
//     length, strong language (the one detector) and hate symbols named.
//   * Look-alikes of Magic's own mana symbols — the five glyphs ARE a sun, a
//     water drop, a skull, a fireball and a tree; a pip of one of those
//     alone, or a description that names a mana symbol, Wizards or the
//     game, is the trademark's drawing on another disc. A motif with
//     something of the maker's own ("a skull wreathed in vines") is theirs.
// ---------------------------------------------------------------------------

import { containsProfanity } from "@/lib/moderation/profanity";
import {
  namesHateSymbol,
  PROMPT_PROBLEM_MESSAGES,
  symbolPromptProblem,
  type PromptProblem,
} from "@/lib/tools/set-symbol/prompt";
import { IDEA_MAX } from "./model";

export type PipPromptProblem = PromptProblem | "mana_lookalike";

export const PIP_PROMPT_PROBLEM_MESSAGES: Record<PipPromptProblem, string> = {
  ...PROMPT_PROBLEM_MESSAGES,
  hate_symbol: "PipGlyph doesn't make hate symbols. Try another idea.",
  mana_lookalike:
    "That's one of Magic's own mana symbols (a sun, a water drop, a skull, a fireball, a tree). Make it yours — “a skull wreathed in vines”, “a sun with a keyhole” — or try another idea.",
};

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Naming the game, its maker or a mana symbol outright. */
const NAMED = [
  ["mana", "symbol"],
  ["mana", "symbols"],
  ["mana", "pip"],
  ["magic", "the", "gathering"],
  ["wizards", "of", "the", "coast"],
  ["mtg"],
  ["wotc"],
  ["phyrexian"],
  ["planeswalker", "symbol"],
  ["tap", "symbol"],
];

/** The five mana glyphs' own motifs (and the words a description of one
 *  alone uses). */
const MOTIFS = new Set([
  "sun",
  "suns",
  "drop",
  "droplet",
  "raindrop",
  "waterdrop",
  "teardrop",
  "skull",
  "skulls",
  "fireball",
  "flame",
  "flames",
  "fire",
  "tree",
  "trees",
]);

/** Words that add nothing of the maker's own to a motif. */
const FILLER = new Set([
  "a",
  "an",
  "the",
  "one",
  "single",
  "simple",
  "plain",
  "basic",
  "classic",
  "bold",
  "round",
  "small",
  "big",
  "of",
  "water",
  "white",
  "blue",
  "black",
  "red",
  "green",
  "mana",
  "icon",
  "symbol",
  "pip",
  "glyph",
  "sign",
  "shape",
  "silhouette",
  "logo",
  "emblem",
  "style",
  "like",
  "in",
  "on",
  "circle",
  "disc",
  "disk",
]);

function containsRun(list: string[], run: string[]): boolean {
  for (let i = 0; i + run.length <= list.length; i += 1) {
    if (run.every((w, k) => list[i + k] === w)) return true;
  }
  return false;
}

/** True when `subject` asks for one of Magic's mana symbols: by name, or a
 *  motif with nothing of the maker's own beside it. */
export function isManaLookalike(subject: string): boolean {
  const list = words(subject);
  if (NAMED.some((run) => containsRun(list, run))) return true;
  const rest = list.filter((w) => !FILLER.has(w));
  return rest.length > 0 && rest.every((w) => MOTIFS.has(w));
}

/** Why the glyph's description can't be sent, or null when it can. */
export function pipPromptProblem(subject: string): PipPromptProblem | null {
  const shared = symbolPromptProblem(subject);
  if (shared) return shared;
  return isManaLookalike(subject) ? "mana_lookalike" : null;
}

export type IdeaProblem = "too_long" | "language" | "hate_symbol";

export const IDEA_PROBLEM_MESSAGES: Record<IdeaProblem, string> = {
  too_long: `Keep the colour's idea under ${IDEA_MAX} characters.`,
  language: "That idea has language we don't send to the AI. Try other words.",
  hate_symbol: "PipGlyph doesn't make colours about hate symbols. Try another idea.",
};

/** Why the optional colour idea can't be sent, or null (empty is fine). */
export function ideaProblem(idea: string): IdeaProblem | null {
  const trimmed = idea.trim();
  if (!trimmed) return null;
  if (trimmed.length > IDEA_MAX) return "too_long";
  if (containsProfanity(trimmed)) return "language";
  return namesHateSymbol(trimmed) ? "hate_symbol" : null;
}

const RULES =
  "Solid flat black on a plain pure white background. One bold pictogram with thick strokes and chunky shapes " +
  "that stay readable when printed very small, like a road-sign icon. Flat vector silhouette, no gradients, no shading, " +
  "no outline, no circle, badge, coin or disc around it, no border, no text or letters, centered with generous white margin.";

function clean(subject: string): string {
  return subject.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
}

/** The prompt FLUX is sent for the glyph of `subject`. */
export function buildGlyphPrompt(subject: string): string {
  return `A pictogram glyph for the colour symbol of an original fantasy card game: ${clean(subject)}. ${RULES}`;
}

/** The second rung when the first prompt is refused: the subject dropped,
 *  a plain sigil. */
export function fallbackGlyphPrompt(): string {
  return `A simple abstract sigil glyph for the colour symbol of an original fantasy card game. ${RULES}`;
}

/** The prompt for a second drawing when the first one's detail would not
 *  survive at card size: the same subject, far simpler. */
export function simplerGlyphPrompt(subject: string): string {
  return `An extremely simple, chunky icon of ${clean(subject)} made of one or two big solid shapes and no fine details or thin lines. ${RULES}`;
}
