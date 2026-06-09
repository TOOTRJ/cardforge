// ---------------------------------------------------------------------------
// Shared rules-text tokenizer — the single source of truth for how a card's
// rules text is broken into renderable runs, consumed by BOTH the live preview
// (components/cards/card-preview.tsx) and the Satori bake (lib/render/
// card-image.tsx) so the editor and the exported PNG render identical text.
//
// It produces, per line (paragraph), an ordered list of items:
//   • word   — a single whitespace-delimited word, optionally italicized as
//              "reminder" (parenthetical) or "ability" (an ability word).
//   • mana   — an inline mana symbol (a mana-font class suffix like "g", "tap",
//              "2", "wu"), rendered with the Mana font in both renderers.
//
// Items carry a `tight` flag when they abut the previous item with no
// whitespace in the source — "{T}:" or "({G}" — so renderers can keep the
// glyph and its punctuation glued together (real cards never set "⊕ :").
// `groupTightRuns` folds an item stream into those unbreakable runs; both
// renderers lay a paragraph out as a flex-wrap row of runs.
//
// Authentic emphasis (matches real cards):
//   • reminder text in (parentheses) → italic. Mana symbols INSIDE the
//     parentheses still render as real pips ("({T}: Add {G}.)" is the most
//     common reminder on real cards).
//   • ability WORDS (Landfall, Raid…) at the start of an ability, before the
//     em dash → italic. NOT keyword abilities (Flying, Trample…), which are
//     normal weight on real cards.
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
  | { t: "w"; v: string; em?: RulesEmphasis; tight?: boolean }
  | { t: "m"; suffix: string; tight?: boolean };

/** One paragraph (a single source line) as an ordered list of render items. An
 *  empty array represents a blank line — a paragraph break. */
export type RulesParagraph = RulesItem[];

// A mana token `{...}` or a reminder span `(...)`.
const SEGMENT = /(\{[^}]+\})|(\([^)]*\))/g;
// A mana token alone — used to re-scan INSIDE reminder spans.
const MANA_ONLY = /\{[^}]+\}/g;

function pushWords(
  items: RulesItem[],
  text: string,
  em?: RulesEmphasis,
  tightFirst = false,
): void {
  let first = true;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const item: RulesItem = em ? { t: "w", v: word, em } : { t: "w", v: word };
    if (first && tightFirst) item.tight = true;
    items.push(item);
    first = false;
  }
}

function pushMana(items: RulesItem[], token: string, tight: boolean): void {
  let first = true;
  for (const tk of tokenize(token)) {
    const suffix = tokenSuffix(tk);
    if (suffix) {
      const item: RulesItem = { t: "m", suffix };
      // Mark every glyph of a run: the first by source adjacency, the rest
      // because "{G}{G}" has no whitespace between the tokens.
      if (tight || !first) item.tight = true;
      items.push(item);
    } else if (tk.kind === "text") {
      pushWords(items, tk.value, undefined, tight && first);
    }
    first = false;
  }
}

/** True when `source[index - 1]` exists and is not whitespace — the segment
 *  starting at `index` should stay glued to whatever came before it. */
function abutsPrevious(source: string, index: number): boolean {
  return index > 0 && !/\s/.test(source.charAt(index - 1));
}

/** Tokenize a span that may contain mana tokens, pushing word items with the
 *  given emphasis and mana items as real pips. */
function pushSpan(
  items: RulesItem[],
  span: string,
  em: RulesEmphasis | undefined,
  tightFirst: boolean,
): void {
  let cursor = 0;
  let firstSegment = true;
  for (const m of span.matchAll(MANA_ONLY)) {
    const idx = m.index ?? 0;
    if (idx > cursor) {
      pushWords(items, span.slice(cursor, idx), em, firstSegment && tightFirst);
      firstSegment = false;
    }
    pushMana(
      items,
      m[0],
      firstSegment ? tightFirst : abutsPrevious(span, idx),
    );
    firstSegment = false;
    cursor = idx + m[0].length;
  }
  if (cursor < span.length) {
    pushWords(
      items,
      span.slice(cursor),
      em,
      (firstSegment && tightFirst) || abutsPrevious(span, cursor),
    );
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
      if (idx > cursor) {
        pushSpan(
          items,
          rest.slice(cursor, idx),
          undefined,
          abutsPrevious(rest, cursor) && items.length > 0,
        );
      }
      if (m[1]) {
        pushMana(items, m[1], abutsPrevious(rest, idx) && items.length > 0);
      } else if (m[2]) {
        // Reminder span — italic words, but mana tokens inside still render
        // as pips (real cards print "({T}: Add {G}.)" with real symbols).
        pushSpan(
          items,
          m[2],
          "reminder",
          abutsPrevious(rest, idx) && items.length > 0,
        );
      }
      cursor = idx + m[0].length;
    }
    if (cursor < rest.length) {
      pushSpan(
        items,
        rest.slice(cursor),
        undefined,
        abutsPrevious(rest, cursor) && items.length > 0,
      );
    }

    paragraphs.push(items);
  }

  return paragraphs;
}

/** Fold an item stream into unbreakable runs: a run is an item plus every
 *  following item marked `tight`. Renderers wrap between runs, never inside
 *  one — keeping "({T}:" or "{2}{U}" on one line like a printed card. */
export function groupTightRuns(items: RulesItem[]): RulesItem[][] {
  const runs: RulesItem[][] = [];
  for (const item of items) {
    if (item.tight && runs.length > 0) {
      runs[runs.length - 1].push(item);
    } else {
      runs.push([item]);
    }
  }
  return runs;
}

/** Tint key for an inline mana glyph: single-color pips tint to their color,
 *  phyrexian pips to their color's disc; everything else (generic numbers,
 *  tap/snow/energy) renders as a neutral colorless gem — matching the
 *  cost-pip behavior. Hybrid pips are handled separately (split disc). */
export function inlineManaTintKey(suffix: string): string {
  if (/^[wubrgc]$/.test(suffix)) return suffix;
  if (/^[wubrgc]p$/.test(suffix)) return suffix.charAt(0);
  return "c";
}

/** A hybrid/twobrid suffix ("wu", "2g", "wup") split into its two halves for
 *  the divided gem disc, or null when the suffix isn't hybrid. */
export function hybridHalves(
  suffix: string,
): { top: string; bottom: string } | null {
  const m = /^([wubrg2c])([wubrg])p?$/.exec(suffix);
  if (!m || m[1] === m[2]) return null;
  return { top: m[1], bottom: m[2] };
}
