import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { chunkIds, selectAllRows } from "@/lib/supabase/select-all-rows";
import { isDeckBoard, isDeckFormat, isDeckVisibility, type DeckBoard } from "@/types/deck";
import type { PickerDeck, DeckMemberships } from "@/lib/decks/membership-state";

// ---------------------------------------------------------------------------
// Which of the OWNER's decks hold which cards (TODO DK9): the My Cards "In N
// decks" chips, the picker's ticks (My Cards, the creator's edit box, the
// gallery). Only the caller's own decks — RLS lets them read every public
// deck's entries too, so the read is pinned to their deck ids. Paged past
// PostgREST's 1000-row cap (a few full decks are more rows than that).
// ---------------------------------------------------------------------------

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The caller's decks, most recently changed first (listMyDecks' order) —
 *  the picker's list. */
export async function listPickerDecks(supabase: Supabase, ownerId: string): Promise<PickerDeck[] | null> {
  const { data, error } = await supabase
    .from("decks")
    .select("id, title, slug, format, visibility")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });
  if (error) return null;
  return (data ?? []).map((deck) => ({
    id: deck.id,
    title: deck.title,
    slug: deck.slug,
    format: isDeckFormat(deck.format) ? deck.format : "casual",
    visibility: isDeckVisibility(deck.visibility) ? deck.visibility : "private",
  }));
}

type EntryRow = {
  id: string;
  deck_id: string;
  card_id: string | null;
  board: string;
  quantity: number;
};

/**
 * Every entry of the given decks that links a PipGlyph card — optionally
 * only these cards — as `card id → its entries`. Null when a page fails
 * (never a partial map read as the whole: a chip would say "Add to deck" on
 * a card that is in one).
 */
export async function listDeckMemberships(
  supabase: Supabase,
  deckIds: readonly string[],
  cardIds?: readonly string[],
): Promise<DeckMemberships | null> {
  const memberships: DeckMemberships = {};
  if (deckIds.length === 0 || (cardIds && cardIds.length === 0)) return memberships;
  const cardChunks = cardIds ? chunkIds([...cardIds]) : [null];
  for (const decks of chunkIds([...deckIds])) {
    for (const cards of cardChunks) {
      const { data, error } = await selectAllRows<EntryRow>((from, to) => {
        let query = supabase
          .from("deck_cards")
          .select("id, deck_id, card_id, board, quantity")
          .in("deck_id", decks)
          .not("card_id", "is", null);
        if (cards) query = query.in("card_id", cards);
        return query.order("id", { ascending: true }).range(from, to);
      });
      if (error) return null;
      for (const row of data) {
        if (!row.card_id) continue;
        const board: DeckBoard = isDeckBoard(row.board) ? row.board : "main";
        (memberships[row.card_id] ??= []).push({
          deckId: row.deck_id,
          entryId: row.id,
          board,
          quantity: row.quantity,
        });
      }
    }
  }
  return memberships;
}

/** My Cards' chips: card id → how many of the owner's decks hold it (every
 *  card of theirs, and the liked cards their decks hold). Null when a read
 *  fails — the chips then claim no number. */
export async function getMyDeckCounts(supabase: Supabase, ownerId: string): Promise<Record<string, number> | null> {
  const decks = await listPickerDecks(supabase, ownerId);
  if (!decks) return null;
  const memberships = await listDeckMemberships(
    supabase,
    decks.map((deck) => deck.id),
  );
  return memberships ? deckCountsOf(memberships) : null;
}

/** "In N decks" per card: the number of DIFFERENT decks of the owner's that
 *  hold it (a card on two boards of one deck is in one deck). */
export function deckCountsOf(memberships: DeckMemberships): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [cardId, entries] of Object.entries(memberships)) {
    counts[cardId] = new Set(entries.map((entry) => entry.deckId)).size;
  }
  return counts;
}
