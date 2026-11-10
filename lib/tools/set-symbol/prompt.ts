// ---------------------------------------------------------------------------
// Set Symbol Studio — what FLUX is asked for, and what it is never asked for.
//
// FLUX draws a set symbol best as ONE black shape on white: the cut-out
// then keys the white away exactly (`edges`), and the studio paints the
// rarities itself (paint.ts) — a model never draws the gold. The maker
// writes the SUBJECT ("a cracked moon over a tower") and picks a style; the
// rest of the prompt is ours. The "fully clothed" line is added at the one
// door every picture goes through (generatePlainImage, lib/ai/image-gen.ts).
//
// The guard runs before any credit is reserved: strong language
// (lib/moderation/profanity.ts, the one detector) and the hate symbols an
// image scan can't tell from a shape (omni-moderation reads pictures for
// sexual and violent content, not for a swastika) are refused in words.
// Client-safe: the form says it before a press.
// ---------------------------------------------------------------------------

import { containsProfanity } from "@/lib/moderation/profanity";

export const SYMBOL_STYLES = ["bold", "geometric", "ornate", "runic"] as const;
export type SymbolStyle = (typeof SYMBOL_STYLES)[number];

export const SYMBOL_STYLE_LABELS: Record<SymbolStyle, { label: string; description: string }> = {
  bold: { label: "Bold silhouette", description: "One strong, simple shape" },
  geometric: { label: "Geometric", description: "Clean lines, circles and angles" },
  ornate: { label: "Ornate", description: "Filigree edges, still one shape" },
  runic: { label: "Runic", description: "Carved, glyph-like strokes" },
};

const STYLE_WORDS: Record<SymbolStyle, string> = {
  bold: "Bold iconic silhouette with a strong outer shape and one or two cut-out details",
  geometric: "Geometric construction with crisp straight lines, arcs and precise symmetry",
  ornate: "Ornate filigree edges and flourishes kept as one connected solid shape",
  runic: "Carved runic glyph strokes, angular and chiselled, like an engraved seal",
};

export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 200;

const RULES =
  "One solid flat black shape on a plain pure white background. Flat vector silhouette, " +
  "bold simple forms that stay readable when printed tiny, no gradients, no outline, no shading, " +
  "no texture, no text, no letters, no frame or border, centered with generous white margin.";

/** The prompt FLUX is sent for `subject` in `style`. */
export function buildSymbolPrompt(subject: string, style: SymbolStyle): string {
  const clean = subject.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  return `A set symbol emblem for a fantasy trading card game expansion: ${clean}. ${STYLE_WORDS[style]}. ${RULES}`;
}

/** The second rung when the first prompt is refused or fails: the subject
 *  dropped, a plain emblem in the same style. */
export function fallbackSymbolPrompt(style: SymbolStyle): string {
  return `A simple heraldic set symbol emblem for a fantasy trading card game expansion. ${STYLE_WORDS[style]}. ${RULES}`;
}

/** Hate symbols, named. Words, not shapes: a request for one is refused. */
const HATE_SYMBOL_TERMS = [
  "swastika",
  "swastikas",
  "hakenkreuz",
  "nazi",
  "nazis",
  "third reich",
  "ss rune",
  "ss runes",
  "sig rune",
  "sig runes",
  "sieg rune",
  "totenkopf",
  "kkk",
  "ku klux",
  "klansman",
  "white power",
  "wolfsangel",
  "sonnenrad",
  "fourteen words",
  "iron cross nazi",
  "confederate flag",
  "isis flag",
];

function normalised(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

export type PromptProblem = "too_short" | "too_long" | "language" | "hate_symbol";

export const PROMPT_PROBLEM_MESSAGES: Record<PromptProblem, string> = {
  too_short: `Describe the symbol in at least ${SUBJECT_MIN} characters.`,
  too_long: `Keep the description under ${SUBJECT_MAX} characters.`,
  language: "That description has language we don't send to the image model. Try other words.",
  hate_symbol: "PipGlyph doesn't make hate symbols. Try another idea.",
};

/** True when `text` names a hate symbol (shared with Pip Forge's guard). */
export function namesHateSymbol(text: string): boolean {
  const words = normalised(text);
  return HATE_SYMBOL_TERMS.some((term) => words.includes(` ${term} `));
}

/** Why `subject` can't be sent, or null when it can. */
export function symbolPromptProblem(subject: string): PromptProblem | null {
  const trimmed = subject.trim();
  if (trimmed.length < SUBJECT_MIN) return "too_short";
  if (trimmed.length > SUBJECT_MAX) return "too_long";
  if (containsProfanity(trimmed)) return "language";
  return namesHateSymbol(trimmed) ? "hate_symbol" : null;
}
