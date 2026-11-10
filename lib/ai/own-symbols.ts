import { normalizeManaCostWithSymbols } from "@/lib/cards/mana-order";
import { CUSTOM_SYMBOL_IN_TEXT_RE, customSymbolCodeOfInner, type SymbolMeanings } from "@/lib/symbols/symbol-token";
import { SYMBOL_BASE_COLOR_LABELS, type SymbolBaseColor } from "@/lib/symbols/symbols";

// ---------------------------------------------------------------------------
// The AI designer and the maker's own mana symbols (new pips PR 6).
//
// `{*CODE}` on a card means its OWNER's symbol. The designer is told the
// maker's LIVE symbols — only while the `custom-symbols` tool is open to
// them (lib/symbols/queries.ts designSymbolsFor), never another user's, never
// a removed one — and may use them in the card's cost and rules text (the
// front face / first part: the second part's and back face's lints read no
// symbols). The lint counts them as declared (lintCardDesign's
// symbolMeanings); every OTHER code is an error the judge is asked to fix,
// and what survives is replaced here (withoutUnknownSymbols) so a design
// never reaches a save that would refuse it after its paid picture.
//
// A maker without the tool, or without symbols: no `ownSymbols`, and the
// prompt and every saved payload are main's (job-payloads-pinned.test.ts).
// ---------------------------------------------------------------------------

export type DesignOwnSymbol = {
  code: string;
  name: string;
  manaValue: number;
  baseColor: SymbolBaseColor | null;
};

/** The symbols' meanings for the lint, or null when there are none. */
export function designSymbolMeanings(symbols: readonly DesignOwnSymbol[] | null | undefined): SymbolMeanings | null {
  if (!symbols || symbols.length === 0) return null;
  const meanings: Record<string, SymbolMeanings[string]> = {};
  for (const symbol of symbols) meanings[symbol.code.toUpperCase()] = { manaValue: symbol.manaValue, baseColor: symbol.baseColor };
  return meanings;
}

/** What the designer (and the judge) are told — nothing when there are none. */
export function ownSymbolPromptLines(symbols: readonly DesignOwnSymbol[] | null | undefined): string[] {
  if (!symbols || symbols.length === 0) return [];
  return [
    "The maker's OWN mana symbols — beyond the standard symbols you MAY use these and no other {*…} symbol, written exactly as shown, in a card's cost or rules text (never a back face or second part). Each counts as its mana value and colour; use one only where it suits the design:",
    ...symbols.map(
      (symbol) =>
        `- {*${symbol.code.toUpperCase()}} ${JSON.stringify(symbol.name)}: mana value ${symbol.manaValue}, ${
          symbol.baseColor ? SYMBOL_BASE_COLOR_LABELS[symbol.baseColor].toLowerCase() : "colorless"
        }.`,
    ),
  ];
}

/** The keys of a design's other face / part (lib/ai/dfc-design.ts,
 *  lib/ai/layout-design.ts): symbols are the front's alone. */
const PARTS_WITHOUT_SYMBOLS: ReadonlySet<string> = new Set(["back_face", "second_part"]);

const knownIn = (inner: string, meanings: SymbolMeanings | null | undefined) => {
  const code = customSymbolCodeOfInner(inner.slice(1, -1));
  return code !== null && Boolean(meanings?.[code]);
};

function withoutUnknownIn(text: string, field: string, meanings: SymbolMeanings | null | undefined): string {
  if (!text.includes("{*")) return text;
  let changed = false;
  const out = text.replace(CUSTOM_SYMBOL_IN_TEXT_RE, (token) => {
    if (knownIn(token, meanings)) return token;
    changed = true;
    // A cost keeps its size (one generic); a rules line's mana a colourless
    // one; anywhere else the token goes.
    return field === "cost" ? "{1}" : field === "rules_text" || field === "text" ? "{C}" : "";
  });
  if (!changed) return text;
  return field === "cost" ? normalizeManaCostWithSymbols(out) : out.replace(/ {2,}/g, " ");
}

/**
 * The last resort after the judge: every `{*CODE}` the designer was NOT
 * given, anywhere in the design — a chapter row too, and ANY code on a back
 * face or a second part (never told any) — is replaced (a cost's by `{1}`, a rules text's by
 * `{C}`, elsewhere dropped). A design that names none comes back as it is
 * (the same object).
 */
export function withoutUnknownSymbols<T>(design: T, meanings: SymbolMeanings | null | undefined, field = ""): T {
  if (typeof design === "string") return withoutUnknownIn(design, field, meanings) as T;
  if (Array.isArray(design)) {
    let changed = false;
    const out = design.map((item) => {
      const next = withoutUnknownSymbols(item, meanings, field);
      if (next !== item) changed = true;
      return next;
    });
    return (changed ? out : design) as T;
  }
  if (design && typeof design === "object") {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(design as Record<string, unknown>)) {
      // A back face or a second part is told no symbols (its lint reads
      // none): every code there goes, the maker's own too.
      const next = withoutUnknownSymbols(value, PARTS_WITHOUT_SYMBOLS.has(key) ? null : meanings, key);
      if (next !== value) changed = true;
      out[key] = next;
    }
    return (changed ? out : design) as T;
  }
  return design;
}
