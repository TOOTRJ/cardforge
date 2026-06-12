import type { Token } from "@/components/cards/mana-cost-glyphs";

// ---------------------------------------------------------------------------
// Custom pip overrides — shared pure helpers (client + server safe).
//
// A PipOverrides map is keyed by core symbol and holds the owner's uploaded
// icon URL. Wherever a COST pip renders (live preview, Satori bake, the
// ManaCostPicker), the renderer asks `pipOverrideForToken` whether the token
// should draw the owner's image instead of the standard mana-font glyph.
//
// Scope (v1): the six core symbols W/U/B/R/G/C, mana costs only. Generic
// numbers, X, hybrids, phyrexians, and rules-text pips keep the standard
// glyphs — extend CUSTOM_PIP_SYMBOLS + the match below to grow the set.
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
