// ---------------------------------------------------------------------------
// Shared rules-text tokenizer — the single source of truth for how a card's
// rules text is broken into renderable runs, consumed by BOTH the live preview
// (components/cards/card-preview.tsx) and the Satori bake (lib/render/
// card-image.tsx) so the editor and the exported PNG render identical text.
//
// It produces, per line (paragraph), an ordered list of items:
//   • word   — a single whitespace-delimited word, optionally italicized as
//              "reminder" (parenthetical, dimmed) or "ability" (an ability
//              word, full strength).
//   • mana   — an inline mana symbol (a mana-font class suffix like "g", "tap",
//              "2", "wu"), rendered with the Mana font in both renderers.
//
// Why word-level: Satori has no inline-text-with-inline-glyph flow, so both
// renderers lay each paragraph out as a flex-wrap row of word/glyph items. Using
// the SAME item stream in both keeps wrapping consistent between preview + bake.
//
// Authentic emphasis (matches real cards):
//   • reminder text in (parentheses) → italic, dimmed
//   • ability WORDS (Landfall, Raid…) at the start of an ability, before the em
//     dash → italic. NOT keyword abilities (Flying, Trample…), which are normal.
// ---------------------------------------------------------------------------

import { tokenize, tokenSuffix } from "@/components/cards/mana-cost-glyphs";

// Canonical MTG ability words. Lowercased for matching. Missing one simply means
// it won't be italicized — graceful, never wrong. Deliberately excludes keyword
// abilities (Flying, Trample, …), which render at normal weight on real cards.
const ABILITY_WORDS = new Set<string>([
  "adamant",
  "addendum",
  "alliance",
  "battalion",
  "bloodrush",
  "channel",
  "chroma",
  "cohort",
  "constellation",
  "converge",
  "corrupted",
  "coven",
  "council's dilemma",
  "delirium",
  "descend",
  "domain",
  "eminence",
  "enrage",
  "fateful hour",
  "ferocious",
  "formidable",
  "grandeur",
  "hellbent",
  "heroic",
  "imprint",
  "inspired",
  "join forces",
  "kinship",
  "landfall",
  "lieutenant",
  "magecraft",
  "metalcraft",
  "morbid",
  "pack tactics",
  "parley",
  "radiance",
  "raid",
  "rally",
  "revolt",
  "secret council",
  "spell mastery",
  "strive",
  "sweep",
  "tempting offer",
  "threshold",
  "undergrowth",
  "valiant",
  "will of the council",
]);

export type RulesEmphasis = "ability" | "reminder";

export type RulesItem =
  | { t: "w"; v: string; em?: RulesEmphasis }
  | { t: "m"; suffix: string };

/** One paragraph (a single source line) as an ordered list of render items. An
 *  empty array represents a blank line — a paragraph break. */
export type RulesParagraph = RulesItem[];

// A mana token `{...}` or a reminder span `(...)`.
const SEGMENT = /(\{[^}]+\})|(\([^)]*\))/g;

function pushWords(
  items: RulesItem[],
  text: string,
  em?: RulesEmphasis,
): void {
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    items.push(em ? { t: "w", v: word, em } : { t: "w", v: word });
  }
}

function pushMana(items: RulesItem[], token: string): void {
  for (const tk of tokenize(token)) {
    const suffix = tokenSuffix(tk);
    if (suffix) items.push({ t: "m", suffix });
    else if (tk.kind === "text") pushWords(items, tk.value);
  }
}

/** Tokenize a card's rules text into per-paragraph render items. Pure + shared
 *  by both renderers. */
export function tokenizeRulesText(raw: string): RulesParagraph[] {
  const paragraphs: RulesParagraph[] = [];

  for (const line of raw.split(/\n/)) {
    const items: RulesItem[] = [];
    let rest = line;

    // Ability-word prefix: "<AbilityWord> —" at the very start → italic (the
    // ability word and its em dash). Guarded by the ABILITY_WORDS set so a
    // normal sentence containing an em dash isn't misdetected.
    const dash = rest.indexOf("—");
    if (dash > 0) {
      const prefix = rest.slice(0, dash).trim().toLowerCase();
      if (ABILITY_WORDS.has(prefix)) {
        pushWords(items, rest.slice(0, dash).trimEnd(), "ability");
        items.push({ t: "w", v: "—", em: "ability" });
        rest = rest.slice(dash + 1);
      }
    }

    let cursor = 0;
    for (const m of rest.matchAll(SEGMENT)) {
      const idx = m.index ?? 0;
      if (idx > cursor) pushWords(items, rest.slice(cursor, idx));
      if (m[1]) pushMana(items, m[1]);
      else if (m[2]) pushWords(items, m[2], "reminder");
      cursor = idx + m[0].length;
    }
    if (cursor < rest.length) pushWords(items, rest.slice(cursor));

    paragraphs.push(items);
  }

  return paragraphs;
}

/** Tint key for an inline mana glyph: single-color pips tint to their color;
 *  everything else (generic numbers, hybrid, tap/snow/energy) renders as a
 *  neutral colorless gem — matching the cost-pip behavior. */
export function inlineManaTintKey(suffix: string): string {
  return /^[wubrgc]$/.test(suffix) ? suffix : "c";
}
