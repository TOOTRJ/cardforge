// ---------------------------------------------------------------------------
// Mana value of a mana cost (CR 202.3) — pure, no imports, safe in the
// client bundle (the deck list reads it through lib/decks/analytics.ts).
//
// Per symbol (the text between the braces, any case):
//   {N}            → N (generic)
//   {X} {Y} {Z}    → 0 (CR 107.3: 0 everywhere but the stack)
//   {W} … {C} {S}  → 1 (a coloured, colourless or snow pip)
//   {W/U} {C/W}    → 1 (a hybrid symbol counts its LARGEST part, 202.3f)
//   {2/W}          → 2 (the monocoloured hybrid's largest part)
//   {W/P} {G/U/P}  → 1 (a Phyrexian symbol is one mana, 202.3g)
//   {HW} {½}       → 0.5 (Un-set half mana)
//   anything else  → 0 ({T}, {E}, {Q}, {CHAOS}… are not mana)
//
// A split card's " // " cost sums both halves, as its mana value does off
// the stack (CR 709.4).
//
// The AI's design lint parses costs strictly (lib/ai/mtg-rules.ts
// parseManaCost: null on any stray text); this one is lenient — a stored
// cost from any source still yields a value.
// ---------------------------------------------------------------------------

const PIP = /^[WUBRGCS]$/;

/** Mana value of ONE symbol, given without its braces ("2/W", "G/U/P"). */
export function symbolManaValue(symbol: string): number {
  const s = symbol.trim().toUpperCase();
  if (/^\d+$/.test(s)) return Number(s);
  if (s === "½" || /^H[WUBRGCS]$/.test(s)) return 0.5;
  if (PIP.test(s)) return 1;
  if (s.includes("/")) {
    // Hybrid and Phyrexian: the largest part; a trailing "P" is only the
    // Phyrexian marker, never a part of its own.
    const parts = s.split("/");
    const sides = parts[parts.length - 1] === "P" ? parts.slice(0, -1) : parts;
    if (sides.length === 0) return 0;
    let largest = 0;
    for (const part of sides) {
      if (/^\d+$/.test(part)) largest = Math.max(largest, Number(part));
      else if (PIP.test(part)) largest = Math.max(largest, 1);
      else return 0;
    }
    return largest;
  }
  return 0;
}

/**
 * Mana value of a cost string (`{2}{W}{W}` → 4, `{2/W}{G/U/P}` → 3). A cost
 * with no braces is read as a bare number ("3"); anything else without a
 * symbol is null (no cost to read). Symbols that are not mana count 0 but
 * still make the cost readable.
 */
export function manaValueOfCost(cost: string | null | undefined): number | null {
  if (!cost) return null;
  const symbols = Array.from(cost.matchAll(/\{([^}]+)\}/g), (match) => match[1]);
  if (symbols.length === 0) {
    const bare = cost.trim();
    return /^\d+$/.test(bare) ? Number(bare) : null;
  }
  return symbols.reduce((total, symbol) => total + symbolManaValue(symbol), 0);
}
