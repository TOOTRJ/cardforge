// ---------------------------------------------------------------------------
// Pip names — what a mana symbol IS, in words, for a screen reader (TODO
// 6.7). A pip drawn as text in the UI (the rules editor's chips, InlinePips:
// idea chips, the import's text) is a picture; its text alternative was its
// brace code, which a screen reader spells out ("left brace, T, right
// brace"). It now says "tap", "white mana", "2 generic mana", "green or blue
// Phyrexian mana".
//
// UI only: no card render reads this (the bake and the preview draw pips,
// they never name them). The "more symbols" group's names are the same
// words (lib/cards/more-symbols.ts — a test holds them together).
//
// Pure, no React: safe on the server and in a test.
// ---------------------------------------------------------------------------

import { COLOR_LETTER_IDENTITY, type ColorLetter } from "@/types/card";

const COLOUR = /^[WUBRG]$/;
const colourName = (letter: string) => COLOR_LETTER_IDENTITY[letter as ColorLetter];

/** Lower-case words for one symbol's INNER code ("T", "2/W", "G/U/P"), or
 *  null for a code it has no words for. Case-insensitive; the hybrid pairs
 *  are named in the order they were written. */
export function pipNameOfInner(inner: string): string | null {
  const code = inner.trim().toUpperCase();
  if (/^\d{1,2}$/.test(code)) return `${Number(code)} generic mana`;
  if (/^[XYZ]$/.test(code)) return `${code} generic mana`;
  if (COLOUR.test(code)) return `${colourName(code)} mana`;
  switch (code) {
    case "C":
      return "colorless mana";
    case "T":
      return "tap";
    case "Q":
      return "untap";
    case "S":
      return "snow mana";
    case "E":
      return "energy";
  }
  const parts = code.split("/");
  if (parts.length === 2) {
    const [a, b] = parts;
    if (COLOUR.test(a) && COLOUR.test(b) && a !== b) return `${colourName(a)} or ${colourName(b)} mana`;
    if (a === "2" && COLOUR.test(b)) return `two generic or ${colourName(b)} mana`;
    if ((COLOUR.test(a) || a === "C") && b === "P") return `${colourName(a)} Phyrexian mana`;
  }
  if (parts.length === 3) {
    const [a, b, p] = parts;
    if (COLOUR.test(a) && COLOUR.test(b) && a !== b && p === "P") {
      return `${colourName(a)} or ${colourName(b)} Phyrexian mana`;
    }
  }
  return null;
}

/** Words for a brace code ("{T}" → "tap"); the code itself when there are
 *  none, so a pip is never left without a text alternative. */
export function pipName(code: string): string {
  const inner = code.replace(/^\{|\}$/g, "");
  return pipNameOfInner(inner) ?? code;
}
