import "server-only";

import { getDeckById, listDeckCards } from "@/lib/decks/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { getCardCollection, SCRYFALL_COLLECTION_MAX, type ScryfallCard } from "@/lib/scryfall/client";
import { chunkIdentifiers } from "@/lib/decks/import-resolution";
import { mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { remixCreditsOf, scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { getVerifiedFrameKeys } from "@/lib/cards/frame-reviews";

// ---------------------------------------------------------------------------
// The AI deck remix's cost estimate (TODO 5.4; owner decision Q4, 2026-10-02:
// a double-faced card costs TWO credits — one picture per face — and the
// deck's estimate shows the extra before anyone pays). A deck entry knows
// its printing only by id (deck_cards has no layout column), so the
// estimate resolves the entries' printings through Scryfall's collection
// endpoint (≤ 75 ids a call, the client's throttle between calls) and maps
// each through the remix's own frame choice (scryfallRemixMechanics): an
// entry lands on the double-faced bodies — both verified — and is priced 2;
// everything else 1. The same numbers size the jobs route's credit
// pre-check and the plan's per-entry reserve (createDeckRemixJob), so what
// the dialog shows is what the steps charge.
// ---------------------------------------------------------------------------

export type DeckRemixEstimate = {
  /** The entries a remix would run (the batch cap applied): the step count. */
  cards: number;
  /** The credits those steps reserve in all. */
  credits: number;
  /** The entries priced for both faces. */
  doubleFaced: number;
  /** Entries beyond the batch cap. */
  skipped: number;
  /** Scryfall entries the lookup couldn't resolve — priced one credit; the
   *  step fails them plainly ("Couldn't resolve the printing") and refunds. */
  unresolved: number;
  /** The credits per entry, by deck_cards id (every remixable entry). */
  creditsByEntry: Record<string, number>;
};

/** The printings of these ids, by id — a transport failure leaves a chunk
 *  unresolved (never throws). */
async function resolvePrintings(ids: readonly string[]): Promise<Map<string, ScryfallCard>> {
  const byId = new Map<string, ScryfallCard>();
  for (const chunk of chunkIdentifiers(ids.map((id) => ({ id })), SCRYFALL_COLLECTION_MAX)) {
    const result = await getCardCollection(chunk);
    for (const card of result?.cards ?? []) byId.set(card.id, card);
  }
  return byId;
}

/**
 * The estimate for a deck the caller OWNS: `cards` entries at `credits` in
 * all. A deck with nothing remixable — or one that isn't the caller's (only
 * its owner may remix it, createDeckRemixJob's rule; RLS still lets a
 * public deck be read) — answers zero cards and makes no Scryfall call.
 */
export async function estimateDeckRemix(deckId: string, limit: number): Promise<DeckRemixEstimate> {
  const [user, deck] = await Promise.all([getCurrentUser(), getDeckById(deckId)]);
  if (!user || !deck || deck.owner_id !== user.id) {
    return { cards: 0, credits: 0, doubleFaced: 0, skipped: 0, unresolved: 0, creditsByEntry: {} };
  }
  const items = await listDeckCards(deckId);
  const remixable = items.filter((item) => item.entry.card_id || item.entry.scryfall_id);
  const taken = remixable.slice(0, Math.max(1, limit));
  const estimate: DeckRemixEstimate = {
    cards: taken.length,
    credits: 0,
    doubleFaced: 0,
    skipped: Math.max(0, remixable.length - taken.length),
    unresolved: 0,
    creditsByEntry: {},
  };
  if (taken.length === 0) return estimate;

  const ids = Array.from(
    new Set(taken.map((item) => item.entry.scryfall_id).filter((id): id is string => Boolean(id))),
  );
  const printings = ids.length > 0 ? await resolvePrintings(ids) : new Map<string, ScryfallCard>();
  const verifiedKeys = new Set(await getVerifiedFrameKeys());

  for (const { entry } of taken) {
    let credits = 1;
    if (entry.scryfall_id) {
      const card = printings.get(entry.scryfall_id);
      if (!card) {
        estimate.unresolved += 1;
      } else {
        const resolved = scryfallRemixMechanics(mapScryfallToFormPatch(card), entry.name, verifiedKeys);
        if (resolved.ok) credits = remixCreditsOf(resolved.mechanics);
      }
    }
    if (credits > 1) estimate.doubleFaced += 1;
    estimate.credits += credits;
    estimate.creditsByEntry[entry.id] = credits;
  }
  return estimate;
}
