import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isDeckFormat,
  isDeckVisibility,
  type Deck,
} from "@/types/deck";
import type { Deck as DeckRow } from "@/types/supabase";

// ---------------------------------------------------------------------------
// Narrowers — keep enum-typed text columns honest (types/deck.ts convention).
// ---------------------------------------------------------------------------

function narrowDeck(row: DeckRow): Deck {
  return {
    ...row,
    visibility: isDeckVisibility(row.visibility) ? row.visibility : "private",
    format: isDeckFormat(row.format) ? row.format : "casual",
  };
}

export type DeckCounts = {
  /** Physical cards across playable boards (quantities summed, maybeboard
   *  excluded) — the "99 cards" number. */
  cards_count: number;
  /** Physical cards (same boards) whose entry has a linked custom proxy. */
  remixed_count: number;
};

export type DeckWithCounts = Deck & DeckCounts;

async function countCardsForDecks(
  deckIds: string[],
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, DeckCounts>> {
  const counts = new Map<string, DeckCounts>();
  if (deckIds.length === 0) return counts;

  try {
    const { data } = await supabase
      .from("deck_cards")
      .select("deck_id, board, quantity, card_id")
      .in("deck_id", deckIds);
    for (const row of data ?? []) {
      if (row.board === "maybe") continue;
      const entry = counts.get(row.deck_id) ?? {
        cards_count: 0,
        remixed_count: 0,
      };
      entry.cards_count += row.quantity;
      if (row.card_id) entry.remixed_count += row.quantity;
      counts.set(row.deck_id, entry);
    }
  } catch {
    // swallow — caller treats missing counts as 0.
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function listMyDecks(): Promise<DeckWithCounts[]> {
  if (!isSupabaseConfigured()) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    const supabase = await createClient();
    const { data: decks } = await supabase
      .from("decks")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });
    if (!decks || decks.length === 0) return [];

    const counts = await countCardsForDecks(
      decks.map((d) => d.id),
      supabase,
    );
    return decks.map((row) => ({
      ...narrowDeck(row),
      ...(counts.get(row.id) ?? { cards_count: 0, remixed_count: 0 }),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Single deck lookups
// ---------------------------------------------------------------------------

export async function getDeckById(id: string): Promise<Deck | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("decks")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? narrowDeck(data) : null;
  } catch {
    return null;
  }
}

/** Deck slugs are globally unique (migration 0055), so a bare slug lookup is
 *  unambiguous — RLS still filters decks the viewer can't read. */
export async function getDeckBySlug(slug: string): Promise<Deck | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("decks")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    return data ? narrowDeck(data) : null;
  } catch {
    return null;
  }
}

export async function getMyDeckBySlug(slug: string): Promise<Deck | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("decks")
      .select("*")
      .eq("owner_id", user.id)
      .eq("slug", slug)
      .maybeSingle();
    return data ? narrowDeck(data) : null;
  } catch {
    return null;
  }
}
