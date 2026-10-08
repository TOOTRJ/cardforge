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

// ---------------------------------------------------------------------------
// PROTOTYPE (symbol round, 2026-10-08 — pictures for the owner, NOT shipped:
// no layout bump, no preview twin, no tests). The prints' own drawings of
// five symbols, measured on Scryfall PNGs (2006 → 2025) and scaled to the HD
// bake; the numbers are data here so a builder can pick them up.
// ---------------------------------------------------------------------------

/** {Q}: a near-black disc and a white arrow 0.64 of the disc tall (11 prints,
 *  SHM 2008 → MB2 2024: disc #1c1a20–#27271d, arrow #f7f7f5–#ffffff, arrow
 *  0.60–0.65 wide and 0.63–0.66 tall). mana-font's arrow is 0.704 em tall. */
export const UNTAP_GEM = { bg: "#211f23", ink: "#ffffff", glyphOfDisc: 0.9 } as const;

/** A Phyrexian symbol is 0.90–0.93 of ITS disc tall on the prints (18
 *  discs, NPH 2011 → EOC 2025); mana-font's is 1 em tall. */
export const PHYREXIAN_GLYPH_OF_DISC = 0.91;

/** The prints set a Phyrexian pip — one colour or two — on a LARGER disc
 *  than the pips beside it: 1.12–1.24 of them in a cost (mean 1.19, n = 11),
 *  1.22–1.31 in rules text (n = 6). One factor for both here. */
export const LARGE_PIP_SCALE = 1.2;

/** The prints' hybrid and twobrid discs are that large too (GTC #215 41 px
 *  against 35, EVE #152 40) — measured, NOT part of this round: flip this to
 *  see it. */
export const LARGE_PIP_INCLUDES_HYBRID: boolean = false;

/** {S}: the disc of a generic pip, a WHITE flake 0.94 of the disc across
 *  with a dark outline 0.05–0.06 of the flake wide (8 prints, CSP 2006 → J22
 *  2022, the same drawing throughout). mana-font's `s` is that flake with an
 *  outline 0.085 wide and no fill, so a card draws the prints' from the
 *  font's white parts instead (lib/cards/snow-flake-path.ts): the parts
 *  stroked `outlineOfDisc` of the disc in the ink, then filled — and grown
 *  `fillOfDisc` — in white on top: a thin dark line round and between white
 *  petals. */
export const SNOW_GEM = { flakeOfDisc: 0.94, fill: "#ffffff", outlineOfDisc: 0.062, fillOfDisc: 0.012 } as const;

/** {E}: a bare symbol, no disc and no shadow, 0.895 of a text pip's disc
 *  tall and as wide, advancing like a pip (18 symbols on 9 prints, KLD 2016 →
 *  DRC 2025). mana-font's is 0.863 em tall. */
export const ENERGY_GEM = { glyphOfDisc: 1.04 } as const;

/** A two-colour Phyrexian disc ({G/U/P}): each half's symbol 0.42–0.49 of
 *  the disc tall, centred 0.17 of the diameter up-left / down-right of the
 *  disc's centre (6 prints: NEO, DMU, ONE). Its em box's corner, as SPLIT_GEM. */
export const PHYREXIAN_SPLIT_GEM = {
  halfOfDisc: 0.45,
  top: { top: 0.096, left: 0.105 },
  bottom: { top: 0.436, left: 0.445 },
} as const;

const isPhyrexian = (suffix: string) => /^[wubrgc]p$/.test(suffix);
const isSplitPhyrexian = (suffix: string) => /^[wubrg]{2}p$/.test(suffix);

/** How much larger than a pip's own disc `symbol` is drawn (1 for most). The
 *  rules layout and the cost row measure a pip with it; ManaGem draws it. */
export function pipScale(symbol: string): number {
  const suffix = symbol.toLowerCase();
  if (isPhyrexian(suffix) || isSplitPhyrexian(suffix)) return LARGE_PIP_SCALE;
  if (LARGE_PIP_INCLUDES_HYBRID && hybridHalves(suffix)) return LARGE_PIP_SCALE;
  return 1;
}

/** A pip's drawn diameter in whole px where a plain pip's is `discPx`. */
export function scaledDiscPx(symbol: string, discPx: number): number {
  return Math.round(discPx * pipScale(symbol));
}

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
      /** The disc's fill; null = no disc and no shadow, the symbol alone
       *  ({E}). */
      bg: string | null;
      /** Drawn INSTEAD of the font's symbol when present ({S}): the snow
       *  flake's white parts in a square `sizePx` wide centred on the disc,
       *  outlined `outlinePx` in `ink` and filled `fill`, the fill grown
       *  `fillPx`. Fractions of a px are meant (an SVG stroke). */
      flake?: { sizePx: number; outlinePx: number; fillPx: number; fill: string };
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
    const phyrexian = isSplitPhyrexian(suffix);
    const geo = phyrexian ? PHYREXIAN_SPLIT_GEM : SPLIT_GEM;
    const topBg = MANA_GEM_BG[halves.top] ?? MANA_GEM_BG.c;
    const bottomBg = MANA_GEM_BG[halves.bottom] ?? MANA_GEM_BG.c;
    return {
      kind: "split",
      suffix,
      ink: MANA_SYMBOL_INK,
      background: `linear-gradient(${SPLIT_GEM.angleDeg}deg, ${topBg} 50%, ${bottomBg} 50%)`,
      halfPx: Math.round(discPx * geo.halfOfDisc),
      top: {
        suffix: phyrexian ? "p" : halves.top,
        bg: topBg,
        topPx: Math.round(discPx * geo.top.top),
        leftPx: Math.round(discPx * geo.top.left),
      },
      bottom: {
        suffix: phyrexian ? "p" : halves.bottom,
        bg: bottomBg,
        topPx: Math.round(discPx * geo.bottom.top),
        leftPx: Math.round(discPx * geo.bottom.left),
      },
    };
  }
  const bg = MANA_GEM_BG[inlineManaTintKey(suffix)] ?? MANA_GEM_BG.c;
  // The prints' own drawings (prototype — see the constants above).
  if (suffix === "untap") {
    return { kind: "solid", suffix, bg: UNTAP_GEM.bg, ink: UNTAP_GEM.ink, glyphPx: Math.round(discPx * UNTAP_GEM.glyphOfDisc) };
  }
  if (suffix === "s") {
    return {
      kind: "solid",
      suffix,
      bg,
      ink: MANA_SYMBOL_INK,
      glyphPx: manaGlyphPx(discPx),
      flake: {
        sizePx: Math.round(discPx * SNOW_GEM.flakeOfDisc),
        outlinePx: discPx * SNOW_GEM.outlineOfDisc,
        fillPx: discPx * SNOW_GEM.fillOfDisc,
        fill: SNOW_GEM.fill,
      },
    };
  }
  if (suffix === "e") {
    return { kind: "solid", suffix, bg: null, ink: MANA_SYMBOL_INK, glyphPx: Math.round(discPx * ENERGY_GEM.glyphOfDisc) };
  }
  if (isPhyrexian(suffix)) {
    return { kind: "solid", suffix, bg, ink: MANA_SYMBOL_INK, glyphPx: Math.round(discPx * PHYREXIAN_GLYPH_OF_DISC) };
  }
  return { kind: "solid", suffix, bg, ink: MANA_SYMBOL_INK, glyphPx: manaGlyphPx(discPx) };
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
  // two-colour Phyrexian (prototype: the tokenizer's three-part form)
  ..."wup wbp ubp urp brp bgp rwp rgp gwp gup".split(" "),
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
