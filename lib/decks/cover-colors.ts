import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { deckCoverColors, type DeckCoverColor } from "@/lib/decks/cover";

// ---------------------------------------------------------------------------
// The colours a LIST of decks' default covers are picked by (TODO DK6.2) —
// the tiles' read of what the deck page computes from its own rows
// (`deckCoverColors`, lib/decks/cover.ts), so a deck shows the same default
// on its tile and on its page.
//
// Two small reads, never every entry of every deck:
//   1. the commander boards of all the decks (a row or two each) — a
//      commander deck is its commander's colours;
//   2. only for a deck whose commanders say nothing (no commander, or a
//      private one): its playable entries, embedded under the deck so the
//      row cap is per deck, at the cap the deck page reads its list with.
// Only the columns the colours need, and the linked card's colours and
// visibility (a private card counts for nobody — lib/decks/cover.ts).
// A failed read is "unknown" (the neutral pair), never a thrown page.
// ---------------------------------------------------------------------------

/** listDeckCards reads a deck's entries in one PostgREST page. */
const ENTRY_CAP = 1000;

const ENTRY_COLUMNS = "board, scryfall_id, card_id, color_identity, card:cards(color_identity, visibility)";

type ColorRow = {
  board: string;
  scryfall_id: string | null;
  card_id: string | null;
  color_identity: string[] | null;
  card: { color_identity: string[] | null; visibility: string } | null;
};

const asItems = (rows: readonly ColorRow[]) => rows.map(({ card, ...entry }) => ({ entry, card }));

export async function listDeckCoverColors(
  deckIds: readonly string[],
  options: {
    /** The cookie-free public client — for static / ISR pages (public
     *  decks only); the owner's own list reads with their session. */
    anonymous?: boolean;
  } = {},
): Promise<Map<string, DeckCoverColor[] | null>> {
  const colors = new Map<string, DeckCoverColor[] | null>();
  if (deckIds.length === 0 || !isSupabaseConfigured()) return colors;
  try {
    const supabase = options.anonymous ? createPublicClient() : await createClient();

    const { data: commanders } = await supabase
      .from("deck_cards")
      .select(`deck_id, ${ENTRY_COLUMNS}`)
      .in("deck_id", [...deckIds])
      .eq("board", "commander");
    const byDeck = new Map<string, ColorRow[]>();
    for (const row of (commanders ?? []) as unknown as Array<ColorRow & { deck_id: string }>) {
      const { deck_id: deckId, ...rest } = row;
      byDeck.set(deckId, [...(byDeck.get(deckId) ?? []), rest]);
    }
    const rest: string[] = [];
    for (const id of deckIds) {
      const known = deckCoverColors(asItems(byDeck.get(id) ?? []));
      if (known) colors.set(id, known);
      else rest.push(id);
    }
    if (rest.length === 0) return colors;

    const { data: decks } = await supabase
      .from("decks")
      .select(`id, deck_cards(${ENTRY_COLUMNS})`)
      .in("id", rest)
      .neq("deck_cards.board", "maybe")
      // The order the page reads its rows in (listDeckCards), so a deck past
      // the cap is cut where its page cuts it.
      .order("position", { referencedTable: "deck_cards" })
      .order("created_at", { referencedTable: "deck_cards" })
      .limit(ENTRY_CAP, { referencedTable: "deck_cards" });
    for (const deck of (decks ?? []) as unknown as Array<{ id: string; deck_cards: ColorRow[] }>) {
      colors.set(deck.id, deckCoverColors(asItems(deck.deck_cards ?? [])));
    }
  } catch {
    // swallow — a deck with no colours read takes the neutral pair.
  }
  return colors;
}
