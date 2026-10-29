import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { deckCoverColors, type DeckCoverColor } from "@/lib/decks/cover";
import { featuredCardsOf, missingFeaturedRank, type FeaturableCard, type FeaturedCard } from "@/lib/decks/featured";
import { canLinkIntoDeck, withDeckVisibleCards } from "@/lib/decks/entry-status";
import { narrowCard } from "@/lib/cards/narrow";
import type { Card } from "@/types/card";

// ---------------------------------------------------------------------------
// What a LIST of deck tiles draws besides the deck row (TODO DK8.1): each
// deck's colours — its default cover's pick (DK6.2) and the tile's colour
// pips — and the 3-card fan in front of the cover. The same answers the
// deck's own page computes from its rows (`deckCoverColors`,
// `featuredCardsOf`, lib/decks/cover.ts + featured.ts), so a deck shows the
// same default and the first three cards of the same fan — the commanders,
// the owner's cover picks (0151), then the fill — on its tile and on its
// page.
//
// ONE read for the page of decks: every playable entry (the maybeboard is
// not the deck) embedded under its deck — so the row cap is per deck, at
// the cap the deck page reads its list with, in the page's order — with
// only the columns the colours and the fan need, and the linked card's
// visibility, owner, colours and render pointers. Then ONE read of the full
// rows of the few cards a fan shows (BakedCardThumbnail draws a card from
// them). The rules are the page's, for every viewer alike:
//   * another creator's card only while it is PUBLIC (D3,
//     withDeckVisibleCards — RLS hands an unlisted card to anyone);
//   * a private card counts for nobody and never stands in a fan
//     (lib/decks/cover.ts, featured.ts — the owner's dashboard reads its
//     private cards and still leaves them out);
//   * a fan card is its 600 px bake thumb, never the HD PNG.
// A failed read is "unknown": the neutral pair and no fan, never a thrown
// page.
// ---------------------------------------------------------------------------

/** A tile's fan: the first three of the deck page's fan (FAN_MAX five). */
export const TILE_FAN_MAX = 3;

/** listDeckCards reads a deck's entries in one PostgREST page. */
const ENTRY_CAP = 1000;

/** The entry columns the colours and the fan read — the owner's cover pick
 *  too (0151), left out on a database that migration hasn't reached. */
const entryColumns = (withRank: boolean) =>
  "id, board, name, position, card_id, scryfall_id, image_url, type_line, color_identity, " +
  (withRank ? "featured_rank, " : "") +
  "card:cards(id, owner_id, title, visibility, color_identity, rendered_image_url, rendered_thumb_url)";

type LiteCard = FeaturableCard & { color_identity: string[] | null };

type EntryRow = {
  id: string;
  board: string;
  name: string;
  position: number | null;
  card_id: string | null;
  scryfall_id: string | null;
  image_url: string | null;
  type_line: string | null;
  color_identity: string[] | null;
  /** Absent on a database 0151 hasn't reached. */
  featured_rank?: number | null;
  card: LiteCard | null;
};

export type DeckTileArt = {
  /** The deck's colours (WUBRG letters, "M" for a gold card that names
   *  none) — null when nothing the viewer-independent rows say tells. */
  colors: DeckCoverColor[] | null;
  /** Up to three cards, in the deck page's fan order. */
  fan: FeaturedCard<Card>[];
};

/** The colours and the fan of every deck on a page of tiles, by deck id. */
export async function listDeckTileArt(
  decks: readonly { id: string; owner_id: string }[],
  options: {
    /** The cookie-free public client — for static / ISR pages (public
     *  decks only); the owner's own list reads with their session. */
    anonymous?: boolean;
  } = {},
): Promise<Map<string, DeckTileArt>> {
  const art = new Map<string, DeckTileArt>();
  if (decks.length === 0 || !isSupabaseConfigured()) return art;
  try {
    const supabase = options.anonymous ? createPublicClient() : await createClient();
    const read = (withRank: boolean) =>
      supabase
        .from("decks")
        .select(`id, owner_id, deck_cards(${entryColumns(withRank)})`)
        .in("id", decks.map((deck) => deck.id))
        .neq("deck_cards.board", "maybe")
        .order("position", { referencedTable: "deck_cards" })
        .order("created_at", { referencedTable: "deck_cards" })
        .order("id", { referencedTable: "deck_cards" })
        .limit(ENTRY_CAP, { referencedTable: "deck_cards" });
    let { data, error } = await read(true);
    if (missingFeaturedRank(error)) ({ data, error } = await read(false));

    const lite = new Map<string, { ownerId: string; colors: DeckCoverColor[] | null; fan: FeaturedCard<LiteCard>[] }>();
    for (const deck of (data ?? []) as unknown as Array<{ id: string; owner_id: string; deck_cards: EntryRow[] | null }>) {
      // The rows as the deck may show them: another creator's card that
      // isn't public reads as null.
      const items = withDeckVisibleCards(
        (deck.deck_cards ?? []).map(({ card, ...entry }) => ({ entry, card })),
        deck.owner_id,
      );
      lite.set(deck.id, {
        ownerId: deck.owner_id,
        colors: deckCoverColors(items),
        fan: featuredCardsOf(items, deck, { max: TILE_FAN_MAX }),
      });
    }

    // The fans' PipGlyph cards, whole (the thumbnail's live fallback and
    // its frame facts read the full row).
    const customIds = [
      ...new Set([...lite.values()].flatMap(({ fan }) => fan.flatMap((f) => (f.kind === "custom" ? [f.card.id] : [])))),
    ];
    const full = new Map<string, Card>();
    if (customIds.length > 0) {
      const { data: cards } = await supabase.from("cards").select("*").in("id", customIds);
      for (const row of cards ?? []) full.set(row.id, narrowCard(row));
    }

    for (const [deckId, { ownerId, colors, fan }] of lite) {
      art.set(deckId, {
        colors,
        // A card that stopped standing in a fan between the two reads (made
        // private, or another creator's no longer public) leaves it.
        fan: fan.flatMap((f): FeaturedCard<Card>[] => {
          if (f.kind === "printing") return [f];
          const card = full.get(f.card.id);
          return card && card.visibility !== "private" && canLinkIntoDeck(card, ownerId) ? [{ ...f, card }] : [];
        }),
      });
    }
  } catch {
    // swallow — a deck with no art read takes the neutral pair, no fan.
  }
  return art;
}
