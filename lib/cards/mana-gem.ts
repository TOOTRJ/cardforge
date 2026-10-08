// ---------------------------------------------------------------------------
// One mana pip of a CARD, as data — the ONE description both renderers draw:
//
//   - the bake's ManaGem (lib/render/card-image.tsx, Satori): the stored PNG;
//   - the preview's CardPip (components/cards/mana-cost-glyphs.tsx): the same
//     numbers in em of the disc, so the live card is the stored one.
//
// The BAKE is the truth here (every stored card was drawn by it): this file
// holds what it has always drawn, moved out of card-image.tsx unchanged — a
// change to a number below changes stored bakes and is a layout bump.
//
// mana-font's own `.ms-cost` look (the pickers, deck lists, articles) is NOT
// this: it paints the untap disc black, scales a Phyrexian symbol ×1.2, draws
// the snow symbol white under a second glyph, sets a split disc's halves by
// its own offsets in its own lighter colours, and inks everything #111. A
// card's pip therefore takes no `.ms-cost` class at all.
//
// Client-safe; imports only the symbol style and the rules tokenizer's
// suffix helpers.
// ---------------------------------------------------------------------------

import { hybridHalves, inlineManaTintKey } from "@/lib/cards/rules-text";
import { manaGlyphPx, styledSuffix, type SymbolStyleSpec } from "@/lib/cards/symbol-style";

/** The disc's colour per tint key — mana-font's `.ms-cost` backgrounds. */
export const MANA_GEM_BG: Readonly<Record<string, string>> = {
  w: "#f0f2c0",
  u: "#b5cde3",
  b: "#aca29a",
  r: "#db8664",
  g: "#93b483",
  c: "#beb9b2",
};

/** The symbol's ink on every disc. */
export const MANA_SYMBOL_INK = "#150d08";

/** A split (hybrid / twobrid) disc: a 135° two-colour fill, each half's
 *  symbol at `halfOfDisc` of the diameter, its em box's corner at these
 *  fractions of the diameter from the disc's top-left. */
export const SPLIT_GEM = {
  angleDeg: 135,
  halfOfDisc: 0.42,
  top: { top: 0.07, left: 0.1 },
  bottom: { top: 0.5, left: 0.52 },
} as const;

export type ManaGemHalf = {
  /** The half's own mana-font suffix ("w", "2"). */
  suffix: string;
  bg: string;
  /** Its em box's corner in the disc, whole px. */
  topPx: number;
  leftPx: number;
};

export type ManaGemSpec =
  | {
      kind: "solid";
      /** The mana-font suffix drawn — the style's own {T} already applied. */
      suffix: string;
      bg: string;
      ink: string;
      /** The symbol's font size, whole px. */
      glyphPx: number;
    }
  | {
      kind: "split";
      suffix: string;
      ink: string;
      /** The disc's fill (a CSS gradient both renderers take as written). */
      background: string;
      /** Each half symbol's font size, whole px. */
      halfPx: number;
      top: ManaGemHalf;
      bottom: ManaGemHalf;
    };

/** The pip `symbol` (a mana-font suffix, before the style's own {T}) on a
 *  disc `discPx` wide, in `symbols`' style. Geometry is in the whole px the
 *  bake draws at that disc. Whether the font HAS the symbol is the caller's
 *  to ask (the bake: its codepoint map; the preview: hasManaGlyph) — a solid
 *  pip without one is not drawn at all, a split disc always is. */
export function manaGemSpec(symbol: string, discPx: number, symbols: SymbolStyleSpec): ManaGemSpec {
  const suffix = styledSuffix(symbols, symbol);
  const halves = hybridHalves(suffix);
  if (halves) {
    const topBg = MANA_GEM_BG[halves.top] ?? MANA_GEM_BG.c;
    const bottomBg = MANA_GEM_BG[halves.bottom] ?? MANA_GEM_BG.c;
    return {
      kind: "split",
      suffix,
      ink: MANA_SYMBOL_INK,
      background: `linear-gradient(${SPLIT_GEM.angleDeg}deg, ${topBg} 50%, ${bottomBg} 50%)`,
      halfPx: Math.round(discPx * SPLIT_GEM.halfOfDisc),
      top: {
        suffix: halves.top,
        bg: topBg,
        topPx: Math.round(discPx * SPLIT_GEM.top.top),
        leftPx: Math.round(discPx * SPLIT_GEM.top.left),
      },
      bottom: {
        suffix: halves.bottom,
        bg: bottomBg,
        topPx: Math.round(discPx * SPLIT_GEM.bottom.top),
        leftPx: Math.round(discPx * SPLIT_GEM.bottom.left),
      },
    };
  }
  return {
    kind: "solid",
    suffix,
    bg: MANA_GEM_BG[inlineManaTintKey(suffix)] ?? MANA_GEM_BG.c,
    ink: MANA_SYMBOL_INK,
    glyphPx: manaGlyphPx(discPx),
  };
}

// ---------------------------------------------------------------------------
// Which suffixes mana-font has a glyph for — the browser's copy of the
// bake's codepoint map (lib/render/card-fonts.ts parses mana.css on the
// server; that file is server-only). The bake draws NOTHING for a suffix
// without one — no disc, no room — so the preview must know too, or it
// leaves an empty disc where the stored card has none ({C/P}, {W/U/P},
// {3/W}, {21}…).
//
// Only what a card's text can reach: tokenSuffix
// (components/cards/mana-cost-glyphs.tsx) yields digits, one or two
// characters, "tap" / "untap", and a style swaps "tap" for its own.
// tests/unit/cards/mana-gem.test.ts holds this list to the installed
// mana.css (every reachable suffix with a codepoint, no other).
// ---------------------------------------------------------------------------

// Generic numbers are built, never written out (a written-out numeric mana
// class would be read by Tailwind as a margin utility:
// tests/unit/content/mana-class-collision.test.ts).
const GENERIC_NUMBERS = [...Array.from({ length: 21 }, (_, n) => String(n)), String(100), String(1_000_000)];

const MANA_GLYPH_SUFFIXES: ReadonlySet<string> = new Set([
  ...GENERIC_NUMBERS,
  // colours, colourless, variables, snow, energy and the other one-letter symbols
  ..."w u b r g c x y z s e d h l p".split(" "),
  // hybrid, twobrid, colourless-hybrid and Phyrexian classes
  ..."wu wb ub ur br bg rw rg gw gu".split(" "),
  ...["w", "u", "b", "r", "g"].flatMap((c) => [`2${c}`, `c${c}`, `${c}p`]),
  "tk",
  // tap and untap, every era's
  ..."tap untap tap-alt tap-3ed tap-4ed".split(" "),
]);

/** True when mana-font has a glyph for `suffix` (a class suffix, lower case,
 *  the style's {T} already applied) — the bake's getManaCodepoint ≠ null. */
export function hasManaGlyph(suffix: string): boolean {
  return MANA_GLYPH_SUFFIXES.has(suffix.toLowerCase());
}

/** The reachable suffixes with a glyph (tests). */
export function manaGlyphSuffixes(): string[] {
  return [...MANA_GLYPH_SUFFIXES];
}

/** True when a card draws anything for `symbol` in `symbols`' style: a split
 *  disc always, a one-colour pip only with a glyph. */
export function drawsManaGem(symbol: string, symbols: SymbolStyleSpec): boolean {
  const suffix = styledSuffix(symbols, symbol);
  return hybridHalves(suffix) != null || hasManaGlyph(suffix);
}
