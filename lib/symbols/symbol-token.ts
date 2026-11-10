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

/** The tokenizer's inner text of a custom symbol (upper-cased, braces
 *  dropped): `*CODE`. */
const INNER_RE = /^\*([A-Z][A-Z0-9]{0,5})$/;

/** A custom symbol's suffix: `*` then the code in lower case. */
const SUFFIX_RE = /^\*([a-z][a-z0-9]{0,5})$/;

/** The code an upper-cased token's inside names (`*ABC` → "ABC"), or null. */
export function customSymbolCodeOfInner(inner: string): string | null {
  return INNER_RE.exec(inner)?.[1] ?? null;
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
