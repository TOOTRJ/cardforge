// ---------------------------------------------------------------------------
// A custom mana symbol as the RENDERERS see it (beta tool `custom-symbols`,
// migration 0193; drawn since layout v76) — pure and import-free, so the
// cost tokenizer (components/cards/mana-cost-glyphs.tsx), the rules
// tokenizer, both renderers and the layout's card scope share it.
//
//   - in text:     `{*CODE}` — any case; CODE = a letter, then up to five
//                  letters or digits (0193's CHECK);
//   - a suffix:    `*code`, lower case — the shape every pip carries through
//                  the rules tokenizer, the rules layout and both renderers
//                  (a mana-font suffix never starts with `*`);
//   - a map key:   `*CODE` in the card owner's PipOverrides
//                  (lib/pips/override.ts) beside W U B R G C — the ONE map
//                  that already reaches every renderer of the owner's cards
//                  (lib/pips/queries.ts getPipOverrides reads both tables).
//
// A code with no picture in the owner's map draws as a PLACEHOLDER: a plain
// colourless disc (lib/cards/mana-gem.ts `kind: "blank"`) — a symbol the
// owner has not made, or one a card was saved with in the instant it was
// deleted (0193's in-use check is not a lock).
// ---------------------------------------------------------------------------

/** `{*code}` in a text, any case. Global — use with matchAll / replace. */
export const CUSTOM_SYMBOL_IN_TEXT_RE = /\{\*([A-Za-z][A-Za-z0-9]{0,5})\}/g;

const ONE_IN_TEXT_RE = new RegExp(CUSTOM_SYMBOL_IN_TEXT_RE.source);

/** A token's inside AS TYPED (braces dropped): `*code`, ASCII only — never
 *  upper-cased first: `"ß".toUpperCase()` is "SS" and "ﬁ" is "FI", which the
 *  text pattern above (the layout's scope, the bake's picture filter) would
 *  not see. */
const INNER_RE = /^\*([A-Za-z][A-Za-z0-9]{0,5})$/;

/** A custom symbol's suffix: `*` then the code in lower case. */
const SUFFIX_RE = /^\*([a-z][a-z0-9]{0,5})$/;

/** The code a token's inside, as typed, names (`*abc` → "ABC"), or null. */
export function customSymbolCodeOfInner(inner: string): string | null {
  return INNER_RE.exec(inner)?.[1].toUpperCase() ?? null;
}

/** The suffix a custom symbol carries through the layout and the renderers. */
export function customSymbolSuffix(code: string): string {
  return `*${code.toLowerCase()}`;
}

/** The code a suffix names (`*abc` → "ABC"), or null for any other pip. */
export function customSymbolCodeOfSuffix(suffix: string): string | null {
  const match = SUFFIX_RE.exec(suffix);
  return match ? match[1].toUpperCase() : null;
}

/** True for a custom symbol's suffix. */
export function isCustomSymbolSuffix(suffix: string): boolean {
  return SUFFIX_RE.test(suffix);
}

/** The owner's map key for a code: `*CODE`. */
export function customSymbolKey(code: string): `*${string}` {
  return `*${code.toUpperCase()}`;
}

/** True when a text names a custom symbol (`{*CODE}`, any case). */
export function hasCustomSymbol(text: string | null | undefined): boolean {
  return !!text && ONE_IN_TEXT_RE.test(text);
}

/** Every code a text names, upper case, each once, in first-seen order. */
export function customSymbolCodesIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  for (const match of text.matchAll(CUSTOM_SYMBOL_IN_TEXT_RE)) seen.add(match[1].toUpperCase());
  return [...seen];
}

// ---------------------------------------------------------------------------
// What a symbol MEANS (PR 3): the mana value and base colour its maker
// declared (0193's `mana_value` / `base_color`). A card's cost reads the
// CARD OWNER's meanings — the same owner whose picture it draws — keyed by
// code, removed symbols included (a card that names one keeps drawing it,
// so it keeps counting it). A code with no meaning (unknown, or no map at
// hand) counts 0 and no colour, as an unknown symbol always has.
// ---------------------------------------------------------------------------

/** A base colour as a cost letter (null = colourless). */
export type SymbolColorLetter = "W" | "U" | "B" | "R" | "G";

export type SymbolMeaning = {
  /** A whole number, 0–20. */
  manaValue: number;
  baseColor: SymbolColorLetter | null;
};

/** The card owner's symbols by CODE (upper case). */
export type SymbolMeanings = Readonly<Record<string, SymbolMeaning>>;

/** What `{*code}` means on a card of the owner whose map this is, or null
 *  for a code the map doesn't hold. */
export function symbolMeaningOf(code: string, meanings: SymbolMeanings | null | undefined): SymbolMeaning | null {
  if (!meanings) return null;
  const key = code.toUpperCase();
  return Object.hasOwn(meanings, key) ? meanings[key] : null;
}

/** The codes a text names that the owner's map doesn't hold, upper case,
 *  each once. Every code is unknown without a map. */
export function unknownSymbolCodesIn(
  text: string | null | undefined,
  meanings: SymbolMeanings | null | undefined,
): string[] {
  return customSymbolCodesIn(text).filter((code) => !symbolMeaningOf(code, meanings));
}

// ---------------------------------------------------------------------------
// A card owner's symbols where a LIST shows other people's cards (PR 4: the
// deck page, its breakdown, the exports). Each row carries its card owner's
// symbols — what they mean and their pictures (`*CODE` keys only: a list
// draws the six pips the standard way) — read in ONE batch for every owner
// whose card names a symbol in its cost (lib/pips/queries.ts
// readOwnerSymbolsOf).
// ---------------------------------------------------------------------------

export type OwnerSymbols = {
  meanings: SymbolMeanings;
  /** `*CODE` → the picture (the renderers' PipOverrides keys). */
  pictures: Readonly<Record<`*${string}`, string>>;
};

/** True when a card's cost — or its second face's / half's — names a
 *  symbol: the costs a list draws and counts. */
export function costNamesCustomSymbol(card: { cost?: string | null; back_face?: unknown } | null | undefined): boolean {
  if (!card) return false;
  if (hasCustomSymbol(card.cost)) return true;
  const back = card.back_face;
  if (!back || typeof back !== "object") return false;
  const cost = (back as { cost?: unknown }).cost;
  return typeof cost === "string" && hasCustomSymbol(cost);
}
