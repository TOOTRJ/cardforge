import "server-only";

import { unstable_cache } from "next/cache";
import { getCardCollection, SCRYFALL_COLLECTION_MAX } from "@/lib/scryfall/client";
import { chunkIds } from "@/lib/supabase/select-all-rows";
import {
  collectDeckTokens,
  realTokenSourceIds,
  tokenPartsOf,
  type DeckToken,
  type TokenPart,
  type TokenSourceItem,
} from "@/lib/decks/deck-tokens";

// ---------------------------------------------------------------------------
// The deck page's tokens (TODO DK5.16), server side: the real cards'
// `all_parts` through the shared Scryfall client's batch lookup — POST
// /cards/collection, 75 printings a call, the client's own 2-per-second
// spacing — and NO new quota path: the answer is held in Next's data cache
// for a day, keyed by the deck's sorted printings, so every viewer of a
// deck shares ONE lookup (a 100-card deck: two calls a day, at most; an
// edit that changes its printings: one lookup more). A deck is never
// scanned for anything else, and a failed call caches nothing (the next
// view asks again; this one lists no real card's tokens).
// ---------------------------------------------------------------------------

/** How long a deck's printings' answer is kept. */
export const DECK_TOKEN_CACHE_SECONDS = 86_400;

/** At most this many printings are looked up (a deck holds ≤ 500 entries;
 *  seven calls at most). */
const MAX_PRINTINGS = 500;

/** The token parts of each printing in `ids`, by printing id. Throws when a
 *  call fails, so nothing partial is cached. */
async function fetchTokenParts(ids: readonly string[]): Promise<Record<string, TokenPart[]>> {
  const out: Record<string, TokenPart[]> = {};
  for (const chunk of chunkIds([...ids], SCRYFALL_COLLECTION_MAX)) {
    const result = await getCardCollection(chunk.map((id) => ({ id })));
    if (!result) throw new Error("scryfall_collection_failed");
    for (const card of result.cards) {
      const parts = tokenPartsOf(card);
      if (parts.length > 0) out[card.id] = parts;
    }
  }
  return out;
}

const cachedTokenParts = unstable_cache(fetchTokenParts, ["deck-token-parts-v1"], {
  revalidate: DECK_TOKEN_CACHE_SECONDS,
  tags: ["deck-token-parts"],
});

/** The tokens and emblems the rows (as THIS viewer reads them) make. A deck
 *  with no printing calls nothing; Scryfall failing lists the PipGlyph
 *  cards' tokens alone (`realCardsFailed`). */
export async function listDeckTokens(
  items: readonly TokenSourceItem[],
): Promise<{ tokens: DeckToken[]; realCardsFailed: boolean }> {
  const ids = realTokenSourceIds(items).slice(0, MAX_PRINTINGS);
  let parts: Record<string, TokenPart[]> = {};
  let realCardsFailed = false;
  if (ids.length > 0) {
    try {
      parts = await cachedTokenParts(ids);
    } catch {
      realCardsFailed = true;
    }
  }
  return { tokens: collectDeckTokens(items, parts), realCardsFailed };
}
