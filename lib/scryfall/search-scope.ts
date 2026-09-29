import type { ScryfallCard } from "@/lib/scryfall/client";

// ---------------------------------------------------------------------------
// The import dialog's search scopes (TODO 1.23). Scryfall's /cards/search
// leaves tokens, emblems and the other "extras" out unless the request sends
// `include_extras`, so `!"Treasure"` or "Kaito Cunning Infiltrator Emblem"
// found nothing. Sending it on every query isn't the answer: measured
// 2026-09-29, it puts 4, 6 and 7 extras (tokens, an art card, a front card,
// a vanguard) into the first 12 typeahead results for "Soldier", "Treasure"
// and "Angel". So /api/scryfall/search sends it only
//   • from the dialog's "Tokens & emblems" scope, restricted to tokens and
//     emblems (tokensScopeQuery), or
//   • as a second request when a plain query from the dialog's Cards scope
//     finds nothing at all (Scryfall's 404) — the same tokens-and-emblems
//     query. The dialog asks for it (`fallback=tokens`, SEARCH_FALLBACK);
//     the route's other callers (the "Use art from a real card" dialog, the
//     admin frame-reference picker) don't, so a typo there is still ONE
//     counted search and never lists tokens;
// and drops what PipGlyph can't import from those results
// (keepExtrasResult). The printings list (TODO 1.5) then picks the printing:
// its `oracleid:` search returns tokens and emblems without the flag.
//
// Pure and client-safe (a type-only import), shared by the route, the
// Scryfall client and the dialog.
// ---------------------------------------------------------------------------

export const SEARCH_SCOPE_VALUES = ["cards", "tokens"] as const;

export type SearchScope = (typeof SEARCH_SCOPE_VALUES)[number];

export const DEFAULT_SEARCH_SCOPE: SearchScope = "cards";

/** The scope chips' labels, in chip order. */
export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  cards: "Cards",
  tokens: "Tokens & emblems",
};

export function isSearchScope(value: unknown): value is SearchScope {
  return (SEARCH_SCOPE_VALUES as readonly unknown[]).includes(value);
}

/** The `fallback` value the import dialog's Cards scope sends: when the plain
 *  query finds nothing, the route asks once more in the tokens scope. The
 *  only value the route accepts; without it a Cards search is one request. */
export const SEARCH_FALLBACK = "tokens" as const;

/** The Scryfall query for the "Tokens & emblems" scope: the user's query,
 *  grouped, restricted to token and emblem type lines. */
export function tokensScopeQuery(query: string): string {
  return `(${query.trim()}) (t:token OR t:emblem)`;
}

/** Layouts `include_extras` brings in that are no card to make: art-series
 *  cards, the Jumpstart front cards (FJ22 #36 "Treasure"), planes,
 *  schemes and vanguards. */
export const EXTRAS_DROPPED_LAYOUTS: ReadonlySet<string> = new Set([
  "art_series",
  "front_card",
  "planar",
  "scheme",
  "vanguard",
]);

/** Friday Night Magic's double-faced promo tokens (2017–18): `!"Treasure"`
 *  with extras answers F17 #11 "Dinosaur // Treasure" first. The real
 *  Treasure token is TFRA #15 (and the rest of its printings). */
export const DFC_PROMO_TOKEN_SETS: ReadonlySet<string> = new Set(["f17", "f18"]);

/** True when an `include_extras` result is something the import makes. */
export function keepExtrasResult(card: Pick<ScryfallCard, "layout" | "set">): boolean {
  const layout = (card.layout ?? "").trim().toLowerCase();
  if (EXTRAS_DROPPED_LAYOUTS.has(layout)) return false;
  const set = (card.set ?? "").trim().toLowerCase();
  return !(layout === "double_faced_token" && DFC_PROMO_TOKEN_SETS.has(set));
}
