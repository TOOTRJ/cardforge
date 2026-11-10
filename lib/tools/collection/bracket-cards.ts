import "server-only";

import { searchCardNames } from "@/lib/scryfall/client";
import { cardKey } from "./builder";

// ---------------------------------------------------------------------------
// The cards the Commander brackets name, read from Scryfall — never written
// here (owner decision 5, 2026-11-09: the lists change a few times a year).
//
//   * Game Changers — `is:gamechanger` (53 on 2026-11-09): none in Brackets
//     1–2, at most three in 3 (the commander counts), any in 4–5;
//   * mass land denial — Scryfall Tagger's `otag:mass-land-denial`: none in
//     Brackets 1–3;
//   * extra turns — `otag:extra-turn`: none in Bracket 1, a few (never
//     chained) in 2–3.
//
// (Wizards, "Introducing Commander Brackets Beta", 2025-02-11; the 2025-10-21
// and 2026-02-09 updates.) Each list is one to three Scryfall searches (4 s
// a page at most: this runs before the AI build's charge), held a day in
// Next's data cache and six hours in this instance. A list Scryfall can't
// give — or gives EMPTY (a renamed Tagger tag answers "no matches", and an
// empty list would pass every card as checked) — makes the whole set
// `null`: the builder then leaves the bracket unchecked and says so; it
// never blocks a build. Keys are card names as the drafter reads them
// (`cardKey`).
// ---------------------------------------------------------------------------

export type BracketCards = {
  gameChangers: ReadonlySet<string>;
  massLandDenial: ReadonlySet<string>;
  extraTurns: ReadonlySet<string>;
};

const DAY_SECONDS = 24 * 60 * 60;
const MEMO_MS = 6 * 60 * 60 * 1000;
let memo: { at: number; value: BracketCards } | null = null;

async function namesFor(query: string): Promise<Set<string> | null> {
  const names = await searchCardNames(`${query} legal:commander`, { maxPages: 3, revalidate: DAY_SECONDS, timeoutMs: 4_000 });
  // Empty is "unknown", never "none of them": every list has dozens of cards.
  return names && names.length > 0 ? new Set(names.map(cardKey)) : null;
}

/** The three lists, or null when any of them can't be read. */
export async function getBracketCards(now: number = Date.now()): Promise<BracketCards | null> {
  if (memo && now - memo.at < MEMO_MS) return memo.value;
  const [gameChangers, massLandDenial, extraTurns] = await Promise.all([
    namesFor("is:gamechanger"),
    namesFor("otag:mass-land-denial"),
    namesFor("otag:extra-turn"),
  ]);
  if (!gameChangers || !massLandDenial || !extraTurns) return null;
  const value = { gameChangers, massLandDenial, extraTurns };
  memo = { at: now, value };
  return value;
}
