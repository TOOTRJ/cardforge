// PROTOTYPE (symbol round, 2026-10-08): the white parts of the snow symbol —
// mana-font 1.18's `s-mtga` glyph (U+E996; the font is SIL OFL 1.1) as one
// SVG path in a 1000-unit em, y down, the baseline at the font's ascender —
// so the bake can stroke it (Satori has no text stroke). Six petals and the
// six-armed star; lib/cards/mana-gem.ts says how a card draws them.
// Client-safe, no imports.

/** The path's own box in those units: left, top, right, bottom. */
export const SNOW_FLAKE_BOX = [1, 33.2, 999, 1008.8] as const;

export const SNOW_FLAKE_PATH =
  "M500 736.3L597.7 871.1L500 1008.8L402.3 871.1L500 736.3M750 88.9L665 128.9L668 188.5L500 435.5L333 189.5L335 128.9L250 88.9L243.2 182.6L295.9 209L425.8 476.6L128.9 500L79.1 467.8L1 520.5L79.1 574.2L128.9 542L425.8 563.5L294.9 834L243.2 859.4L250 953.1L335 912.1L331.1 853.5L500 605.5L669.9 851.6L665 912.1L750 953.1L756.8 859.4L701.2 834L574.2 563.5L872.1 541L920.9 574.2L999 520.5L920.9 467.8L871.1 501L574.2 476.6L704.1 210L756.8 182.6L750 88.9M500 33.2L402.3 170.9L500 307.6L597.7 170.9L500 33.2M852.5 430.7L922.9 276.4L753.9 260.7L684.6 416L852.5 430.7M852.5 611.3L922.9 764.6L753.9 780.3L681.6 626L852.5 611.3M246.1 260.7L319.3 417L147.5 430.7L77.1 276.4L246.1 260.7M317.4 623L147.5 611.3L77.1 764.6L246.1 780.3";
