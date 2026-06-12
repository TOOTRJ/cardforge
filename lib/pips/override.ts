import type { Token } from "@/components/cards/mana-cost-glyphs";

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
// ---------------------------------------------------------------------------

export const CUSTOM_PIP_SYMBOLS = ["W", "U", "B", "R", "G", "C"] as const;

export type CustomPipSymbol = (typeof CUSTOM_PIP_SYMBOLS)[number];

export type PipOverrides = Partial<Record<CustomPipSymbol, string>>;

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
  const symbol = SUFFIX_TO_SYMBOL[suffix];
  return symbol ? overrides[symbol] ?? null : null;
}
