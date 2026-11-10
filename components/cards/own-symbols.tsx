"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OwnSymbolChoice } from "@/lib/symbols/symbols";

export type { OwnSymbolChoice };

// ---------------------------------------------------------------------------
// The card maker's own mana symbols as the creator OFFERS them (new pips
// PR 4): the cost picker's "Your symbols" row and the rules toolbar's. Given
// by the creator (lib/symbols/queries.ts listOwnSymbolChoices: their live
// symbols, only while the `custom-symbols` tool is open to them); empty
// everywhere else, so a picker or toolbar outside it looks as it always did.
// Each button inserts `{*CODE}` — what that MEANS and how it draws is the
// card owner's symbol (lib/symbols/symbol-token.ts).
// ---------------------------------------------------------------------------

const OwnSymbolsContext = createContext<readonly OwnSymbolChoice[]>([]);

export function OwnSymbolsProvider({
  symbols,
  children,
}: {
  symbols: readonly OwnSymbolChoice[] | null | undefined;
  children: ReactNode;
}) {
  return <OwnSymbolsContext.Provider value={symbols ?? []}>{children}</OwnSymbolsContext.Provider>;
}

/** The symbols the creator offers; [] outside it. */
export function useOwnSymbols(): readonly OwnSymbolChoice[] {
  return useContext(OwnSymbolsContext);
}

/** What one inserts: `{*CODE}`. */
export function ownSymbolToken(symbol: Pick<OwnSymbolChoice, "code">): string {
  return `{*${symbol.code.toUpperCase()}}`;
}

/** The section's name, the same in the picker and the toolbar. */
export const OWN_SYMBOLS_LABEL = "Your symbols";
