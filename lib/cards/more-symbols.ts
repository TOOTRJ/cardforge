// ---------------------------------------------------------------------------
// The "more symbols" group — the hybrid, twobrid and Phyrexian mana symbols
// the creator offers behind ONE collapsed group, in ONE order, wherever a
// symbol is picked: the rules-text toolbar
// (components/creator/rules-symbol-toolbar.tsx) and the cost picker
// (components/cards/mana-cost-picker.tsx). Both read this list — never a
// copy — so the two can't drift (tests/unit/cards/more-symbols.test.ts).
//
// Every token is in the printed pair order (HYBRID_PAIRS, mana-order.ts): the
// one normalizeManaCost keeps, the one mana-font has a class for.
// `{C/P}` is not here: no renderer draws it (TODO 1.11).
//
// Pure data, no React: safe on the server and in a test.
// ---------------------------------------------------------------------------

import { HYBRID_PAIRS } from "@/lib/cards/mana-order";
import { COLOR_LETTER_IDENTITY, type ColorLetter } from "@/types/card";

export type MoreSymbolGroupId = "hybrid" | "twobrid" | "phyrexian" | "hybrid-phyrexian";

export type MoreSymbol = {
  /** The brace code, as printed: "{W/U}", "{2/W}", "{W/P}", "{W/U/P}". */
  token: string;
  /** What it is, in words, lower case: "white or blue mana". */
  name: string;
};

export type MoreSymbolGroup = {
  id: MoreSymbolGroupId;
  /** The group in words (an accessible name for its row of buttons). */
  label: string;
  symbols: readonly MoreSymbol[];
};

/** The collapsed group's label, the same words wherever it is offered. */
export const MORE_SYMBOLS_LABEL = "Hybrid, twobrid & Phyrexian symbols…";

const COLORS = ["W", "U", "B", "R", "G"] as const;
const colorName = (letter: string) => COLOR_LETTER_IDENTITY[letter as ColorLetter];
const pairName = (pair: string) => `${colorName(pair[0])} or ${colorName(pair[1])}`;

// The ten two-colour hybrids as the toolbar has always listed them: the five
// allied pairs round the wheel, then the five enemy pairs. Each must be one
// of HYBRID_PAIRS (the printed order of the pair) — a test holds it.
const HYBRID_ORDER = ["WU", "UB", "BR", "RG", "GW", "WB", "UR", "BG", "RW", "GU"] as const;

export const MORE_SYMBOL_GROUPS: readonly MoreSymbolGroup[] = [
  {
    id: "hybrid",
    label: "Hybrid mana",
    symbols: HYBRID_ORDER.map((pair) => ({ token: `{${pair[0]}/${pair[1]}}`, name: `${pairName(pair)} mana` })),
  },
  {
    id: "twobrid",
    label: "Twobrid mana",
    symbols: COLORS.map((c) => ({ token: `{2/${c}}`, name: `two generic or ${colorName(c)} mana` })),
  },
  {
    id: "phyrexian",
    label: "Phyrexian mana",
    symbols: COLORS.map((c) => ({ token: `{${c}/P}`, name: `${colorName(c)} Phyrexian mana` })),
  },
  {
    // The ten two-colour Phyrexian symbols ({G/U/P}: Tamiyo, Compleated
    // Sage), in the printed pair order — Scryfall's symbology and
    // mana-font's ten classes.
    id: "hybrid-phyrexian",
    label: "Hybrid Phyrexian mana",
    symbols: HYBRID_PAIRS.map((pair) => ({ token: `{${pair[0]}/${pair[1]}/P}`, name: `${pairName(pair)} Phyrexian mana` })),
  },
];

/** All thirty, in the order they are offered. */
export const MORE_SYMBOLS: readonly MoreSymbol[] = MORE_SYMBOL_GROUPS.flatMap((group) => group.symbols);

/** A sentence-case name ("White or blue mana"). */
export const capitalized = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;
