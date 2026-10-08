// ---------------------------------------------------------------------------
// One mana pip of a CARD, as data — the ONE description both renderers draw:
//
//   - the bake's ManaGem (lib/render/card-image.tsx, Satori): the stored PNG;
//   - the preview's CardPip (components/cards/mana-cost-glyphs.tsx): the same
//     numbers in em of the disc, so the live card is the stored one.
//
// The BAKE is the truth here (every stored card was drawn by it): a change
// to a number below changes stored bakes and is a layout bump. Layout v49
// set five symbols on the prints' own drawings (the constants below).
//
// mana-font's own `.ms-cost` look (the pickers, deck lists, articles) is NOT
// this: it has its own untap disc, Phyrexian scale and snow glyphs, sets a
// split disc's halves by its own offsets in its own lighter colours, draws a
// disc behind the energy symbol and inks everything #111. A card's pip
// therefore takes no `.ms-cost` class at all.
//
// Client-safe; imports only the symbol style, the snow flake's path and the
// rules tokenizer's suffix helpers.
// ---------------------------------------------------------------------------

import { hybridHalves, inlineManaTintKey } from "@/lib/cards/rules-text";
import { SNOW_FLAKE_BOX, SNOW_FLAKE_PATH } from "@/lib/cards/snow-flake-path";
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
// Five symbols as the PRINTS draw them (layout v49, owner round 43,
// 2026-10-08) — measured on Scryfall PNGs, 2006 → 2025, scaled to the HD
// bake; the numbers are data here and docs/FRAMES.md "Symbols as printed"
// holds the measurements. ONE look on every symbol style: each symbol was
// first printed on the 2003 frame or the M15 one, in the same drawing since
// (untap: Shadowmoor 2008; Phyrexian: New Phyrexia 2011; snow: Coldsnap
// 2006; energy: Kaladesh 2016; two-colour Phyrexian: Kamigawa: Neon Dynasty
// 2022), and the 1997 and 1993 frames never printed one — a card on those
// takes the nearest printed look, the same one.
// ---------------------------------------------------------------------------

/** {Q}: a near-black disc and a white arrow 0.63 of the disc tall (9 prints,
 *  SHM 2008 → MB2 2024: disc #202123, arrow #fefdfe, 0.639 ± 0.008 tall,
 *  0.622 ± 0.011 wide; flat in the rules text). mana-font's arrow is 0.704 em
 *  tall, so its font size is `glyphOfDisc` of the disc. */
export const UNTAP_GEM = { bg: "#211f23", ink: "#ffffff", glyphOfDisc: 0.9 } as const;

/** A Phyrexian symbol is 0.904 ± 0.009 (cost, n = 11) / 0.913 ± 0.018 (rules
 *  text, n = 8) of ITS disc tall on the prints, NPH 2011 → EOC 2025;
 *  mana-font's is 1 em tall. */
export const PHYREXIAN_GLYPH_OF_DISC = 0.91;

/** The prints set a Phyrexian pip — one colour or two — on a LARGER disc
 *  than the pips beside it: 1.175 ± 0.020 of them in a cost (M15 frame,
 *  n = 8; New Phyrexia's on the 2003 frame 80.9 HD px against that frame's
 *  66: 1.22), 1.21 ± 0.08 in rules text (n = 8), 1.224 ± 0.025 for the
 *  two-colour one (n = 5). One factor for all. The hybrid and twobrid discs
 *  are NOT part of this (their own measuring task). */
export const LARGE_PIP_SCALE = 1.2;

/** {S}: the disc of a generic pip and a WHITE flake 0.92 of the disc across
 *  with a dark outline 0.056 of the flake wide (6 rules-text flakes and 2
 *  cost flakes on 7 prints, CSP 2006 → J22 2022, the same drawing
 *  throughout). mana-font's `s` is that flake as an outline 0.085 wide with
 *  no fill, so a card draws the prints' from the font's WHITE parts instead
 *  (lib/cards/snow-flake-path.ts): the parts stroked `outlineOfDisc` of the
 *  disc in the ink, then filled — and grown `fillOfDisc` — in white on top:
 *  a thin dark line round and between white petals. `flakeOfDisc` is the
 *  drawing's square, outline included. */
export const SNOW_GEM = { flakeOfDisc: 0.94, fill: "#ffffff", outlineOfDisc: 0.062, fillOfDisc: 0.012 } as const;

/** {E}: the bare symbol — no disc, no shadow — 0.895 ± 0.012 of a text
 *  pip's disc tall and 0.883 ± 0.016 wide, advancing like a pip (18 symbols
 *  on 9 prints, KLD 2016 → DRC 2025). mana-font's is 0.863 em tall. */
export const ENERGY_GEM = { glyphOfDisc: 1.04 } as const;

/** A two-colour Phyrexian disc ({G/U/P}): each half's symbol 0.453 ± 0.051
 *  of the disc tall, centred 0.169 ± 0.029 of the diameter up-left /
 *  down-right of the disc's centre (5 discs: NEO, DMU, ONE). Its em box's
 *  corner, as SPLIT_GEM. */
export const PHYREXIAN_SPLIT_GEM = {
  halfOfDisc: 0.45,
  top: { top: 0.096, left: 0.105 },
  bottom: { top: 0.436, left: 0.445 },
} as const;

/** A one-colour Phyrexian suffix the font has a symbol for ("wp"; never
 *  "cp", which no card draws). */
const isPhyrexian = (suffix: string) => /^[wubrg]p$/.test(suffix);
/** A two-colour Phyrexian suffix ("gup"). */
const isSplitPhyrexian = (suffix: string) => /^[wubrg]{2}p$/.test(suffix) && suffix[0] !== suffix[1];

/** How much larger than a plain pip's disc `symbol` is drawn: LARGE_PIP_SCALE
 *  for a Phyrexian symbol, 1 for every other. The same on every symbol
 *  style. The rules layout (pipWidthPx) and the cost row (costRowTerms)
 *  measure a pip with it; both renderers draw manaGemSpec's `discPx`. */
export function pipScale(symbol: string): number {
  const suffix = symbol.toLowerCase();
  return isPhyrexian(suffix) || isSplitPhyrexian(suffix) ? LARGE_PIP_SCALE : 1;
}

/** `symbol`'s drawn diameter in whole px where a plain pip's is `pipPx`. */
export function pipDiscPx(symbol: string, pipPx: number): number {
  return Math.round(pipPx * pipScale(symbol));
}

/** How many whole px ABOVE a plain pip's top `symbol`'s disc starts in a
 *  line of rules text: a larger disc keeps the plain pip's centre (the
 *  odd px below). 0 for a plain pip. */
export function pipRisePx(symbol: string, pipPx: number): number {
  return Math.floor((pipDiscPx(symbol, pipPx) - pipPx) / 2);
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

/** The snow flake as both renderers draw it: ONE inline SVG `sizePx`
 *  square, centred on the disc — `d` drawn twice, first filled and stroked
 *  `outlineWidth` in the pip's ink, then filled and stroked `fillWidth` in
 *  `fill` on top (mitre joins, limit SNOW_FLAKE_MITRE). Widths are in the
 *  viewBox's units. */
export type SnowFlakeSpec = {
  sizePx: number;
  viewBox: string;
  d: string;
  outlineWidth: number;
  fillWidth: number;
  fill: string;
};

/** The mitre limit of the flake's strokes: its petals' sharp tips are cut
 *  square past it, as the prints' are. */
export const SNOW_FLAKE_MITRE = 2.5;

export type ManaGemSpec =
  | {
      kind: "solid";
      /** The mana-font suffix drawn — the style's own {T} already applied. */
      suffix: string;
      /** The disc's drawn diameter, whole px: the plain pip's, or a
       *  Phyrexian symbol's larger one (pipDiscPx). */
      discPx: number;
      /** The disc's fill; null = no disc and NO shadow, the symbol alone
       *  ({E}) in a pip's box. */
      bg: string | null;
      /** Drawn INSTEAD of the font's symbol when present ({S}). */
      flake?: SnowFlakeSpec;
      ink: string;
      /** The symbol's font size, whole px. */
      glyphPx: number;
    }
  | {
      kind: "split";
      suffix: string;
      /** The disc's drawn diameter, whole px (pipDiscPx). */
      discPx: number;
      ink: string;
      /** The disc's fill (a CSS gradient both renderers take as written). */
      background: string;
      /** Each half symbol's font size, whole px. */
      halfPx: number;
      top: ManaGemHalf;
      bottom: ManaGemHalf;
    };

/** The flake for a disc `discPx` wide: the path's box plus its outline
 *  spans a square SNOW_GEM.flakeOfDisc of the disc, centred in it. */
function snowFlakeSpec(discPx: number): SnowFlakeSpec {
  const [x0, y0, x1, y1] = SNOW_FLAKE_BOX;
  const sizePx = Math.round(discPx * SNOW_GEM.flakeOfDisc);
  const outlinePx = discPx * SNOW_GEM.outlineOfDisc;
  // px per path unit.
  const unit = (sizePx - 2 * outlinePx) / Math.max(x1 - x0, y1 - y0);
  const side = sizePx / unit;
  const n = (v: number) => Number(v.toFixed(3));
  return {
    sizePx,
    viewBox: `${n((x0 + x1) / 2 - side / 2)} ${n((y0 + y1) / 2 - side / 2)} ${n(side)} ${n(side)}`,
    d: SNOW_FLAKE_PATH,
    outlineWidth: n((2 * outlinePx) / unit),
    fillWidth: n((2 * discPx * SNOW_GEM.fillOfDisc) / unit),
    fill: SNOW_GEM.fill,
  };
}

/** The pip `symbol` (a mana-font suffix, before the style's own {T}) where a
 *  PLAIN pip's disc is `pipPx` wide, in `symbols`' style. Geometry is in the
 *  whole px the bake draws; `discPx` is the disc it draws them on (larger
 *  than `pipPx` for a Phyrexian symbol). Whether the font HAS the symbol is
 *  the caller's to ask (the bake: its codepoint map; the preview:
 *  hasManaGlyph) — a solid pip without one is not drawn at all, a split disc
 *  always is. */
export function manaGemSpec(symbol: string, pipPx: number, symbols: SymbolStyleSpec): ManaGemSpec {
  const suffix = styledSuffix(symbols, symbol);
  const discPx = pipDiscPx(suffix, pipPx);
  const halves = hybridHalves(suffix);
  if (halves) {
    // A two-colour Phyrexian disc: the Phyrexian symbol in each half.
    const phyrexian = isSplitPhyrexian(suffix);
    const geo = phyrexian ? PHYREXIAN_SPLIT_GEM : SPLIT_GEM;
    const topBg = MANA_GEM_BG[halves.top] ?? MANA_GEM_BG.c;
    const bottomBg = MANA_GEM_BG[halves.bottom] ?? MANA_GEM_BG.c;
    return {
      kind: "split",
      suffix,
      discPx,
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
  const solid = { kind: "solid", suffix, discPx, bg, ink: MANA_SYMBOL_INK, glyphPx: manaGlyphPx(discPx) } as const;
  if (suffix === "untap") {
    return { ...solid, bg: UNTAP_GEM.bg, ink: UNTAP_GEM.ink, glyphPx: Math.round(discPx * UNTAP_GEM.glyphOfDisc) };
  }
  if (suffix === "s") return { ...solid, flake: snowFlakeSpec(discPx) };
  if (suffix === "e") return { ...solid, bg: null, glyphPx: Math.round(discPx * ENERGY_GEM.glyphOfDisc) };
  if (isPhyrexian(suffix)) return { ...solid, glyphPx: Math.round(discPx * PHYREXIAN_GLYPH_OF_DISC) };
  return solid;
}

// ---------------------------------------------------------------------------
// Which suffixes mana-font has a glyph for — the browser's copy of the
// bake's codepoint map (lib/render/card-fonts.ts parses mana.css on the
// server; that file is server-only). The bake draws NOTHING for a suffix
// without one — no disc, no room — so the preview must know too, or it
// leaves an empty disc where the stored card has none ({C/P}, {3/W},
// {21}…).
//
// Only what a card's text can reach: tokenSuffix
// (components/cards/mana-cost-glyphs.tsx) yields digits, one to three
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
  // two-colour Phyrexian (a card draws its own split disc for any pair)
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
