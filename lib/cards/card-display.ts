// Pure, framework-free card-display helpers shared by BOTH the live preview
// (components/cards/card-preview.tsx, a client component) and the Satori bake
// (lib/render/card-image.tsx, server-only). No "use client" / "server-only"
// directive so either side can import it without crossing the boundary.
//
// Centralizing the "which stat does this card type show?" logic here is what
// keeps the editor preview and the exported PNG in agreement — previously each
// renderer defined its own copy and they drifted (e.g. the bake gated loyalty
// on rarity instead of card type).

import {
  CARD_FINISH_VALUES,
  DEFAULT_FRAME_TEMPLATE,
  FRAME_TEMPLATE_VALUES,
  RETIRED_CARD_FINISHES,
  type CardFinish,
  type CardType,
  type FrameTemplate,
} from "@/types/card";

// Coerce a persisted frame template to a known one. Older cards may carry the
// retired "regular" placeholder (or an empty/unknown value); those resolve to
// the default frame so the renderers never point at a deleted asset folder.
export function normalizeFrameTemplate(
  template: string | null | undefined,
): FrameTemplate {
  return (FRAME_TEMPLATE_VALUES as readonly string[]).includes(template ?? "")
    ? (template as FrameTemplate)
    : DEFAULT_FRAME_TEMPLATE;
}

// Coerce a persisted finish to a current one: a retired value maps to the
// finish that draws the same pixels (RETIRED_CARD_FINISHES in types/card.ts),
// and a missing or unknown value is "regular", so the creator never shows or
// re-submits a finish the validator would refuse.
export function normalizeCardFinish(finish: unknown): CardFinish {
  if (typeof finish !== "string") return "regular";
  if ((CARD_FINISH_VALUES as readonly string[]).includes(finish)) {
    return finish as CardFinish;
  }
  return RETIRED_CARD_FINISHES.get(finish) ?? "regular";
}

// Subtypes that print P/T without being creatures — Vehicles show their
// crewed stats, Spacecraft their stationed stats. Matched case-insensitively
// so hand-typed subtypes ("vehicle") behave like imported ones ("Vehicle").
const PT_SUBTYPES = new Set(["vehicle", "spacecraft"]);

// ---------------------------------------------------------------------------
// Token type words (TODO 3b.15). A token's card types ride in `supertype`
// ("Token Artifact Creature — Thopter" is card_type token with "Artifact
// Creature" in supertype — the importer's rule, TODO 1.3), so the P/T and
// the frame read them from there. Printed order: Enchantment, Artifact,
// Creature ("Token Enchantment Artifact Creature — Golem", TEOC #13).
// ---------------------------------------------------------------------------

/** The card-type words the token kind's picker toggles, in printed order. */
export const TOKEN_TYPE_WORDS = ["Enchantment", "Artifact", "Creature"] as const;
export type TokenTypeWord = (typeof TOKEN_TYPE_WORDS)[number];

/** The words of a supertype, as typed ("Legendary  Artifact" → two). */
export function supertypeWords(supertype: string | null | undefined): string[] {
  return (supertype ?? "").split(/\s+/).filter(Boolean);
}

/** True when the supertype holds `word` (case-insensitive, whole word). */
export function supertypeHasWord(
  supertype: string | null | undefined,
  word: string,
): boolean {
  const lower = word.toLowerCase();
  return supertypeWords(supertype).some((part) => part.toLowerCase() === lower);
}

/** True when the supertype names a token's card type (Creature, Artifact or
 *  Enchantment). A token with none prints a bare "Token" (a Copy, TFDN #26)
 *  — or is a legacy row from before the picker (see printsPowerToughness). */
export function hasTokenTypeWord(supertype: string | null | undefined): boolean {
  return TOKEN_TYPE_WORDS.some((word) => supertypeHasWord(supertype, word));
}

// Printed order of the words left of a type line's dash: the supertypes
// (Basic, Legendary, Ongoing, Snow, World), then the card types (Kindred,
// Enchantment, Artifact, Land, Planeswalker, Creature) — "Legendary Snow
// Artifact Creature", "Legendary Enchantment Artifact" (Bident of Thassa),
// "Artifact Land", "Land Creature" (Dryad Arbor, TBRO #3).
const TYPE_WORD_RANK: Readonly<Record<string, number>> = {
  basic: 0,
  legendary: 1,
  ongoing: 2,
  snow: 3,
  world: 4,
  kindred: 5,
  tribal: 5,
  enchantment: 6,
  artifact: 7,
  land: 8,
  planeswalker: 9,
  creature: 10,
};

/**
 * The supertype with `word` added in printed order (TYPE_WORD_RANK): before
 * the first word that prints after it, else last; a word the rank doesn't
 * know ("Emblem") goes last. Every other word is kept where it is, and a
 * supertype that already says the word comes back unchanged (its spacing
 * normalised). A token's picker toggles write through this (TODO 3b.15):
 * "Legendary" + Artifact → "Legendary Artifact"; "Artifact" + Enchantment →
 * "Enchantment Artifact"; "Land" + Creature → "Land Creature".
 */
export function withSupertypeWord(
  supertype: string | null | undefined,
  word: string,
): string {
  const words = supertypeWords(supertype);
  if (supertypeHasWord(supertype, word)) return words.join(" ");
  const rank = TYPE_WORD_RANK[word.toLowerCase()];
  const at =
    rank === undefined
      ? -1
      : words.findIndex((part) => (TYPE_WORD_RANK[part.toLowerCase()] ?? -1) > rank);
  return (at < 0 ? [...words, word] : [...words.slice(0, at), word, ...words.slice(at)]).join(" ");
}

/** The supertype without `word` (any case); every other word kept, in
 *  order — undoes withSupertypeWord. */
export function withoutSupertypeWord(
  supertype: string | null | undefined,
  word: string,
): string {
  const lower = word.toLowerCase();
  return supertypeWords(supertype)
    .filter((part) => part.toLowerCase() !== lower)
    .join(" ");
}

/**
 * Whether the card type shows a P/T: a creature; a token whose supertype says
 * "Creature" (a Treasure — "Token Artifact — Treasure" — has none, TODO
 * 3b.15); any card with a Vehicle or Spacecraft subtype. The creator's P/T
 * inputs and the AI's stat rules follow this; the renderers print through
 * printsPowerToughness, which adds the stored tokens from before the picker.
 */
export function showsPowerToughness(
  cardType: CardType | null | undefined,
  subtypes?: readonly string[] | null,
  supertype?: string | null,
): boolean {
  if (cardType === "creature") return true;
  if (cardType === "token" && supertypeHasWord(supertype, "Creature")) return true;
  return (subtypes ?? []).some((s) => PT_SUBTYPES.has(s.trim().toLowerCase()));
}

/** A face as far as its printed P/T goes. */
export type PowerToughnessFace = {
  cardType?: CardType | null;
  subtypes?: readonly string[] | null;
  supertype?: string | null;
  power?: string | null;
  toughness?: string | null;
};

/**
 * Whether a face PRINTS its P/T — both renderers (and the stat-fit scope)
 * gate on this: it has a value and its type shows one (showsPowerToughness).
 * A token with a value and no type word at all also prints it: before the
 * picker (TODO 3b.15) every token was a creature, so a stored one written
 * then keeps its P/T. Migration 0128 gives those rows "Creature"; this keeps
 * one written by an older client after it (or before it ran) printing too.
 */
export function printsPowerToughness(face: PowerToughnessFace): boolean {
  if (!face.power && !face.toughness) return false;
  if (showsPowerToughness(face.cardType, face.subtypes, face.supertype)) return true;
  return face.cardType === "token" && !hasTokenTypeWord(face.supertype);
}

/**
 * Whether a face has text for its rules box: rules or flavour text that isn't
 * blank (String.prototype.trim — its whitespace, no other character). Both
 * renderers draw the box's text (and a translucent box's backdrop) only then,
 * and the token frame's text box follows it (TODO 4.49 (b): the creator, the
 * AI jobs and migration 0129, whose SQL mirrors this trim). The frame still
 * decides whether it prints it: a basic land's, and a textless frame's, never.
 */
export function hasRulesBoxText(face: { rulesText?: string | null; flavorText?: string | null }): boolean {
  return Boolean(face.rulesText?.trim() || face.flavorText?.trim());
}

export function showsLoyalty(cardType: CardType | null | undefined): boolean {
  return cardType === "planeswalker";
}

export function showsDefense(cardType: CardType | null | undefined): boolean {
  return cardType === "battle";
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

// ---------------------------------------------------------------------------
// Saga chapters. The Saga frame has no normal text box — its rules are a
// vertical list of chapters down the left rail. We parse the card's rules text
// into chapters by their Roman-numeral markers ("I — …", "II, III — …",
// "IV: …"). Lines without a marker continue the previous chapter; lines before
// the first marker are dropped (sagas put the lore-counter reminder in the
// frame, not the text). Shared by the preview + bake so both render the same.
// ---------------------------------------------------------------------------

export type SagaChapter = { marker: string; text: string };

const CHAPTER_LINE =
  /^\s*([ivx]+(?:\s*,\s*[ivx]+)*)\s*[—:–-]\s*(.+)$/i;

export function parseChapters(
  rulesText: string | null | undefined,
): SagaChapter[] {
  if (!rulesText?.trim()) return [];
  const out: SagaChapter[] = [];
  for (const raw of rulesText.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = CHAPTER_LINE.exec(line);
    if (match) {
      out.push({
        marker: match[1].toUpperCase().replace(/\s+/g, ""),
        text: match[2].trim(),
      });
    } else if (out.length > 0) {
      out[out.length - 1].text += ` ${line}`;
    }
  }
  return out;
}

/** Lines before the first chapter marker — the saga's intro/reminder text
 *  ("(As this Saga enters …)"), printed above chapter I on real cards. */
export function parseSagaIntro(
  rulesText: string | null | undefined,
): string | null {
  if (!rulesText?.trim()) return null;
  const intro: string[] = [];
  for (const raw of rulesText.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (CHAPTER_LINE.test(line)) break;
    intro.push(line);
  }
  return intro.length > 0 ? intro.join(" ") : null;
}

// ---------------------------------------------------------------------------
// Planeswalker loyalty abilities. Real M15 planeswalkers print each ability as
// its own row with a loyalty-cost badge (+1 / −3 / 0) in a left rail and
// alternating row shading. We parse the card's rules text by leading loyalty
// costs; lines without one (static abilities) render as unbadged rows. Shared
// by the preview + bake so both render the same.
// ---------------------------------------------------------------------------

export type LoyaltyAbility = { cost: string | null; text: string };

const LOYALTY_LINE = /^\s*([+\-−–]?)\s*(\d+|X)\s*:\s*(.+)$/i;

export function parseLoyaltyAbilities(
  rulesText: string | null | undefined,
): LoyaltyAbility[] {
  if (!rulesText?.trim()) return [];
  const out: LoyaltyAbility[] = [];
  for (const raw of rulesText.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const match = LOYALTY_LINE.exec(line);
    if (match) {
      // Normalize the sign to ASCII so the Satori bake (whose fonts lack
      // U+2212) and the browser render the identical glyph.
      const sign = match[1] === "+" ? "+" : match[1] ? "-" : "";
      out.push({
        cost: `${sign}${match[2].toUpperCase()}`,
        text: match[3].trim(),
      });
    } else {
      out.push({ cost: null, text: line });
    }
  }
  return out;
}

// Builds the "Supertype Type — Subtype Subtype" line shown in the type bar.
// A token prints "Token" FIRST, then its words (TODO 3b.15, the M15-on
// wording): "Token Creature — Soldier", "Token Legendary Artifact Creature —
// Construct", a bare "Token" for a Copy (TFDN #26), "Token Basic — Wastes"
// for a basic typed on the token frame.
export function buildTypeLine({
  supertype,
  cardType,
  subtypes,
}: {
  supertype?: string | null;
  cardType?: CardType | null;
  subtypes?: readonly string[];
}): string {
  const left = (
    cardType === "token"
      ? ["Token", supertype?.trim()]
      : [supertype, cardType ? capitalize(cardType) : null]
  )
    .filter(Boolean)
    .join(" ");
  const right = subtypes?.filter(Boolean).join(" ") ?? "";
  if (left && right) return `${left} — ${right}`;
  return left || right || "Type";
}

/** A type line split at its em dash, for a frame that prints it in two boxes
 *  (TextSlot.split, TODO 3.24): "Basic Land — Forest" → ["Basic Land",
 *  "Forest"]. A line with no dash ("Basic Land" on Wastes) prints whole in
 *  the left box. */
export function splitTypeLine(typeLine: string): [string, string] {
  const at = typeLine.indexOf("\u2014");
  if (at < 0) return [typeLine.trim(), ""];
  return [typeLine.slice(0, at).trim(), typeLine.slice(at + 1).trim()];
}

// A single-line display-font (Beleren) text — title, type line, the display
// footer — with every inner run of spaces joined into ONE no-break space.
// Satori places each word after a space at the sum of the preceding
// characters' UNKERNED advances but draws each word kerned, so every word
// started late by the kerning inside the words before it: "Jester's Mask"
// baked a word gap nearly twice the browser's (Beleren kerns ' + s alone by
// −224/2048 em). A no-break space keeps the line one run that Satori
// draws kerned from its first glyph. Both renderers print the same string,
// so both also drop Beleren's space-pair kerns (space + A, comma + space…),
// which the bake never applied. MPlantin has no kerning; body text keeps
// its spaces (it wraps). Satori still SIZES the run unkerned, which only
// shows where the line isn't at its band's start — the bake's centred bands
// correct for it (alignedText, lib/render/card-image.tsx).
export function displayLine(text: string): string {
  return text.replace(/(\S)[ \t\n]+(?=\S)/g, "$1\u00a0");
}

/** displayLine for a slot set in either face (TextSlot.font: the footer is
 *  body text unless its profile says "display"). */
export function slotLine(font: "display" | "body" | undefined, text: string): string {
  return font === "display" ? displayLine(text) : text;
}

// ---------------------------------------------------------------------------
// Mana cost as words — the plain-text twin of the pips a crawler can't read
// from the rendered card. "{2}{U}{U}" → "2 generic, 2 blue"; hybrid,
// Phyrexian, snow, energy and X symbols spelled out. Unknown tokens are
// passed through verbatim rather than dropped.
// ---------------------------------------------------------------------------

const MANA_WORDS: Record<string, string> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
  S: "snow",
  E: "energy",
  X: "X",
  Y: "Y",
  Z: "Z",
};

export function describeManaCost(cost: string | null | undefined): string {
  if (!cost) return "";
  const tokens = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase());
  if (tokens.length === 0) return "";
  const parts: string[] = [];
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const [token, n] of counts) {
    if (/^\d+$/.test(token)) {
      parts.push(`${Number(token) * n} generic`);
      continue;
    }
    const halves = token.split("/");
    let word: string;
    if (halves.length === 2 && halves[1] === "P") {
      word = `${MANA_WORDS[halves[0]] ?? halves[0]} or 2 life`;
    } else if (halves.length === 2 && /^\d+$/.test(halves[0])) {
      word = `${halves[0]} generic or ${MANA_WORDS[halves[1]] ?? halves[1]}`;
    } else if (halves.length === 2) {
      word = `${MANA_WORDS[halves[0]] ?? halves[0]} or ${MANA_WORDS[halves[1]] ?? halves[1]}`;
    } else {
      word = MANA_WORDS[token] ?? token;
    }
    parts.push(n > 1 ? `${n} ${word}` : word);
  }
  return parts.join(", ");
}
