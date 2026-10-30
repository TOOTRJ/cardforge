import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { DECK_PAGE_CARD_COLUMNS, readDeckPageCardRows, type DeckPageCard } from "@/lib/decks/queries";
import { ADD_RESULTS_PER_SECTION, ADD_SEARCH_MIN_CHARS, normalizeAddQuery, typedFoldPattern } from "@/lib/decks/add-search";

// ---------------------------------------------------------------------------
// The add box's two PipGlyph searches (TODO DK5.2), read with the caller's
// session (GET /api/decks/add-search — a route, not a server action: a
// typeahead must be cancellable and must never wait in line behind the
// page's edits, which Next sends one at a time):
//
//   My cards         the owner's own cards at any visibility, by title or
//                    nickname, read the way a title is printed
//                    (typedFoldPattern — ’ “ ” — match what a keyboard
//                    types), never a frame preview (it never joins a deck);
//                    no query = the cards edited last. A title that starts
//                    with the query comes first.
//   PipGlyph cards   other creators' PUBLIC cards (owner decision D3)
//                    through the gallery's own search (list_gallery_cards:
//                    full text + the folded title match, ranked), from two
//                    characters on.
//
// The third section — real cards — is Scryfall's, through the app's own
// route and quota (`/api/scryfall/search`).
// ---------------------------------------------------------------------------

export type AddCandidate = {
  /** The card as the deck page draws a row of it. */
  card: DeckPageCard;
  /** Another creator's handle (D3); null for the owner's own. */
  maker: string | null;
};

export type AddSearchResults = { mine: AddCandidate[]; community: AddCandidate[] };

/** Only the page's columns of a card row (the gallery's RPC answers `*`). */
function pageCardOf(row: Record<string, unknown>): DeckPageCard {
  const card: Record<string, unknown> = {};
  for (const column of DECK_PAGE_CARD_COLUMNS) if (column in row) card[column] = row[column];
  return card as unknown as DeckPageCard;
}

export async function searchDeckAddCards(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  rawQuery: string,
): Promise<AddSearchResults> {
  const query = normalizeAddQuery(rawQuery);

  const mineOf = async (column: "title" | "nickname" | null) =>
    (await readDeckPageCardRows((columns) => {
      let read = supabase.from("cards").select(columns).eq("owner_id", userId).not("frame_preview", "is", true);
      if (column) read = read.filter(column, "imatch", typedFoldPattern(query));
      return read.order("updated_at", { ascending: false }).limit(ADD_RESULTS_PER_SECTION * 2);
    })) ?? [];

  const [byTitle, byNickname, communityRows] = await Promise.all([
    mineOf(query ? "title" : null),
    // The nickname (TODO 6.3): a database without the column answers this
    // half with nothing.
    query ? mineOf("nickname").catch(() => [] as DeckPageCard[]) : Promise.resolve([] as DeckPageCard[]),
    query.length >= ADD_SEARCH_MIN_CHARS
      ? supabase
          .rpc("list_gallery_cards", { p_search: query, p_sort: "discover", p_limit: ADD_RESULTS_PER_SECTION * 3 })
          .then(({ data }) => ((data ?? []) as Array<Record<string, unknown>>).filter((row) => row.owner_id !== userId))
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);

  const seen = new Set<string>();
  const lower = query.toLowerCase();
  const starts = (card: DeckPageCard) => Number(Boolean(lower) && card.title.toLowerCase().startsWith(lower));
  const mine = [...byTitle, ...byNickname]
    .filter((card) => (seen.has(card.id) ? false : (seen.add(card.id), true)))
    .sort((a, b) => starts(b) - starts(a))
    .slice(0, ADD_RESULTS_PER_SECTION)
    .map((card) => ({ card, maker: null }));

  const communityCards = communityRows.slice(0, ADD_RESULTS_PER_SECTION).map(pageCardOf);
  const makerIds = Array.from(new Set(communityCards.map((card) => card.owner_id)));
  const handleOf = new Map<string, string | null>();
  if (makerIds.length > 0) {
    const { data: makers } = await supabase.from("profiles").select("id, username").in("id", makerIds);
    for (const maker of makers ?? []) handleOf.set(maker.id, maker.username ?? null);
  }
  return {
    mine,
    community: communityCards.map((card) => ({ card, maker: handleOf.get(card.owner_id) ?? null })),
  };
}
