import type { Token } from "@/components/cards/mana-cost-glyphs";
import { customSymbolCodeOfSuffix, customSymbolCodesIn, customSymbolKey } from "@/lib/symbols/symbol-token";

// ---------------------------------------------------------------------------
// Custom pip overrides — shared pure helpers (client + server safe).
//
// A PipOverrides map is keyed by core symbol and holds the owner's uploaded
// icon URL. Wherever a COST pip renders (live preview, Satori bake, the
// ManaCostPicker), the renderer asks `pipOverrideForToken` whether the token
// should draw the owner's image instead of the standard mana-font glyph.
//
// Scope: the six core symbols W/U/B/R/G/C, in mana costs AND inline
// rules-text pips. Generic numbers, X, hybrids, phyrexians, and the
// utility symbols keep the standard glyphs — extend CUSTOM_PIP_SYMBOLS +
// the matches below to grow the set.
//
// The owner's own symbols (beta tool `custom-symbols`, layout v76) ride the
// same map under `*CODE` keys (lib/symbols/symbol-token.ts): `{*CODE}` draws
// that entry's picture, and a placeholder disc where there is none
// (lib/cards/mana-gem.ts `kind: "blank"`).
// ---------------------------------------------------------------------------

export const CUSTOM_PIP_SYMBOLS = ["W", "U", "B", "R", "G", "C"] as const;

export type CustomPipSymbol = (typeof CUSTOM_PIP_SYMBOLS)[number];

export type PipOverrides = Partial<Record<CustomPipSymbol, string>> & {
  /** An owner's own symbol's picture, keyed `*CODE`. */
  [symbol: `*${string}`]: string | undefined;
};

export const CUSTOM_PIP_SYMBOL_LABELS: Record<CustomPipSymbol, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

export function isCustomPipSymbol(value: string): value is CustomPipSymbol {
  return (CUSTOM_PIP_SYMBOLS as readonly string[]).includes(value);
}

/**
 * The override URL for a cost token, or null when the token renders the
 * standard glyph. Only pure color pips match — `{3}`, `{X}`, etc. tokenize
 * as solid with color "C" but carry a non-color label, so requiring
 * `label === color` keeps them (and the unknown-token fallback) standard.
 */
export function pipOverrideForToken(
  token: Token,
  overrides: PipOverrides | null | undefined,
): string | null {
  if (!overrides) return null;
  if (token.kind === "custom") return overrides[customSymbolKey(token.code)] ?? null;
  if (token.kind !== "solid") return null;
  if (token.label !== token.color) return null;
  if (!isCustomPipSymbol(token.color)) return null;
  return overrides[token.color] ?? null;
}

// Mana-font class suffixes for the core solids ("w"…"c") — the shape the
// rules-text tokenizer carries (lib/cards/rules-text.ts RulesItem). Hybrids
// ("wu"), twobrids ("2w"), phyrexians ("wp"), generic digits, and utility
// suffixes ("tap"…) are longer than one core letter and never match.
const SUFFIX_TO_SYMBOL: Record<string, CustomPipSymbol> = {
  w: "W",
  u: "U",
  b: "B",
  r: "R",
  g: "G",
  c: "C",
};

/** Suffix-keyed twin of pipOverrideForToken, for inline rules-text pips. */
export function pipOverrideForSuffix(
  suffix: string,
  overrides: PipOverrides | null | undefined,
): string | null {
  if (!overrides) return null;
  const code = customSymbolCodeOfSuffix(suffix);
  if (code) return overrides[customSymbolKey(code)] ?? null;
  const symbol = SUFFIX_TO_SYMBOL[suffix];
  return symbol ? overrides[symbol] ?? null : null;
}

/**
 * The entries of an owner's map a card can draw: the six pips, and only the
 * `*CODE` symbols `text` (the card's data, serialized — every face, row and
 * part) names. The bake fetches every picture it is handed
 * (lib/render/card-image.tsx withRenderableImages): an owner with twenty
 * symbols would otherwise fetch twenty for a card that names none. A code
 * not in the map is left out (it draws its placeholder).
 */
export function pipOverridesNamedIn(
  overrides: PipOverrides | null | undefined,
  text: string,
): PipOverrides | null | undefined {
  if (!overrides) return overrides;
  const named = new Set(customSymbolCodesIn(text).map(customSymbolKey));
  const kept: PipOverrides = {};
  for (const [key, url] of Object.entries(overrides) as [keyof PipOverrides, string | undefined][]) {
    if (url === undefined) continue;
    if (key.startsWith("*") && !named.has(key as `*${string}`)) continue;
    kept[key] = url;
  }
  return kept;
}
