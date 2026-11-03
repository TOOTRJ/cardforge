import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache } from "next/cache";
import { getCardCollection, SCRYFALL_COLLECTION_MAX } from "@/lib/scryfall/client";
import { logScryfallCall } from "@/lib/scryfall/rate-limit";
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
// spacing, each call held to DECK_TOKEN_CALL_TIMEOUT_MS (retries included:
// a page view never waits on a slow Scryfall). The answer is held in Next's
// data cache, keyed by the deck's sorted printings, so every viewer of a
// deck shares ONE lookup:
//   * a SUCCESS for a day (a 100-card deck: two calls a day, at most; an
//     edit that changes its printings: one lookup more);
//   * a FAILURE (an outage, a 429, a timeout) for
//     DECK_TOKEN_FAILURE_CACHE_SECONDS — two entries: the short one keeps
//     every answer, the day one only a success (it throws on a failure, so
//     it keeps nothing) and reads the short one on a miss, so the views of
//     those minutes read the failure instead of calling again.
// A lookup that reached Scryfall is logged (logScryfallCall, action
// `deck_tokens`: one row per lookup) on the signed-in viewer whose view made
// it — never checked (a page view is never refused), and an anonymous
// view's lookup goes unlogged (the log needs a user). A deck is never
// scanned for anything else.
// ---------------------------------------------------------------------------

/** How long a deck's printings' answer is kept. */
export const DECK_TOKEN_CACHE_SECONDS = 86_400;

/** How long a FAILED lookup is kept (the next views don't call again). */
export const DECK_TOKEN_FAILURE_CACHE_SECONDS = 300;

/** Each Scryfall call's budget, retries included. */
export const DECK_TOKEN_CALL_TIMEOUT_MS = 4_000;

/** The cache tag of both entries. */
export const DECK_TOKEN_CACHE_TAG = "deck-token-parts";

/** At most this many printings are looked up (a deck holds ≤ 500 entries;
 *  seven calls at most). */
const MAX_PRINTINGS = 500;

type TokenLookup = { ok: true; parts: Record<string, TokenPart[]> } | { ok: false };

/** Counts the Scryfall calls the lookup of THIS view made (a cache hit
 *  makes none): the cached function runs inside the caller's async
 *  context on a miss. */
const viewCalls = new AsyncLocalStorage<{ calls: number }>();

/** The token parts of each printing in `ids`, by printing id — or a
 *  failure when any call fails (nothing partial is ever an answer). */
async function lookUpTokenParts(ids: readonly string[]): Promise<TokenLookup> {
  const out: Record<string, TokenPart[]> = {};
  for (const chunk of chunkIds([...ids], SCRYFALL_COLLECTION_MAX)) {
    const counter = viewCalls.getStore();
    if (counter) counter.calls += 1;
    let result: Awaited<ReturnType<typeof getCardCollection>>;
    try {
      result = await getCardCollection(
        chunk.map((id) => ({ id })),
        { timeoutMs: DECK_TOKEN_CALL_TIMEOUT_MS },
      );
    } catch {
      return { ok: false };
    }
    if (!result) return { ok: false };
    for (const card of result.cards) {
      const parts = tokenPartsOf(card);
      if (parts.length > 0) out[card.id] = parts;
    }
  }
  return { ok: true, parts: out };
}

// Built on first use (a test that mocks next/cache can still import this).
let caches: { recent: typeof lookUpTokenParts; daily: (ids: readonly string[]) => Promise<Record<string, TokenPart[]>> } | null =
  null;
function tokenCaches() {
  if (caches) return caches;
  // Every answer, a failure too, for a few minutes…
  const recent = unstable_cache(lookUpTokenParts, ["deck-token-lookup-v2"], {
    revalidate: DECK_TOKEN_FAILURE_CACHE_SECONDS,
    tags: [DECK_TOKEN_CACHE_TAG],
  });
  // …and a success for a day: a failure throws here, so this entry keeps
  // nothing and the next view reads the short entry's failure.
  const daily = unstable_cache(
    async (ids: readonly string[]) => {
      const answer = await recent(ids);
      if (!answer.ok) throw new Error("scryfall_collection_failed");
      return answer.parts;
    },
    ["deck-token-parts-v2"],
    { revalidate: DECK_TOKEN_CACHE_SECONDS, tags: [DECK_TOKEN_CACHE_TAG] },
  );
  caches = { recent, daily };
  return caches;
}

/** The tokens and emblems the rows (as THIS viewer reads them) make. A deck
 *  with no printing calls nothing; Scryfall failing (or a failure in the
 *  last few minutes) lists the PipGlyph cards' tokens alone
 *  (`realCardsFailed`). `viewerId`: the signed-in viewer, whose view's
 *  lookup — if it reached Scryfall — is logged. */
export async function listDeckTokens(
  items: readonly TokenSourceItem[],
  options: { viewerId?: string | null } = {},
): Promise<{ tokens: DeckToken[]; realCardsFailed: boolean }> {
  const ids = realTokenSourceIds(items).slice(0, MAX_PRINTINGS);
  let parts: Record<string, TokenPart[]> = {};
  let realCardsFailed = false;
  if (ids.length > 0) {
    const counter = { calls: 0 };
    try {
      parts = await viewCalls.run(counter, () => tokenCaches().daily(ids));
    } catch {
      realCardsFailed = true;
    }
    if (counter.calls > 0 && options.viewerId) await logScryfallCall(options.viewerId, "deck_tokens");
  }
  return { tokens: collectDeckTokens(items, parts), realCardsFailed };
}
