import { cache } from "react";
import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isDeckBoard,
  isDeckEntrySource,
  isDeckFormat,
  isDeckVisibility,
  type Deck,
  type DeckCardEntry,
  type DeckFormat,
} from "@/types/deck";
import {
  type Card,
} from "@/types/card";
import type {
  Card as CardRow,
  Deck as DeckRow,
  DeckCard as DeckCardRow,
  Profile,
} from "@/types/supabase";
import { narrowCard } from "@/lib/cards/narrow";
import { IMPORT_FINGERPRINT_FIELDS } from "@/lib/cards/import-fingerprint";
import { canLinkIntoDeck } from "@/lib/decks/entry-status";
import { featuredRankOf } from "@/lib/decks/featured";
import { viaDeckLink } from "@/lib/decks/deck-link";
import { profileMediaSrc } from "@/lib/media/media-urls";
import { chunkIds, selectAllRows } from "@/lib/supabase/select-all-rows";

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

function narrowDeckCard(row: DeckCardRow): DeckCardEntry {
  // `source` (migration 0144) and `featured_rank` (0150) are absent on a
  // database that migration hasn't reached.
  const source = (row as { source?: unknown }).source;
  return {
    ...row,
    board: isDeckBoard(row.board) ? row.board : "main",
    source: isDeckEntrySource(source) ? source : null,
    featured_rank: featuredRankOf((row as { featured_rank?: unknown }).featured_rank),
  };
}

type DeckCounts = {
  /** Physical cards across playable boards (quantities summed, maybeboard
   *  excluded) — the "99 cards" number. `decks.card_count`. */
  cards_count: number;
  /** Physical cards (same boards) whose entry links a PipGlyph card — the
   *  deck owner's or, since D3, another creator's. `decks.linked_card_count`. */
  linked_count: number;
};

export type DeckWithCounts = Deck & DeckCounts;

/** The tile counts, straight off the deck row: migration 0143 keeps them in
 *  the database (a statement trigger on deck_cards recounts both), so a list
 *  never reads entry rows — that read hit PostgREST's 1000-row cap once a
 *  page of decks held more entries, and the decks past it showed 0 cards. */
function withCounts(row: DeckRow): DeckWithCounts {
  return {
    ...narrowDeck(row),
    cards_count: row.card_count ?? 0,
    linked_count: row.linked_card_count ?? 0,
  };
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
    return decks.map(withCounts);
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

// ---------------------------------------------------------------------------
// Public browse + detail
// ---------------------------------------------------------------------------

type DeckOwner = Pick<
  Profile,
  "username" | "display_name" | "avatar_url"
> | null;

export type DeckWithOwner = Deck & { owner: DeckOwner };

export type PublicDeckListing = DeckWithCounts & {
  owner: DeckOwner;
  liked_by_viewer: boolean;
};

export type PublicDecksSort = "recent" | "popular" | "viewed";

type DeckReadClient =
  | ReturnType<typeof createPublicClient>
  | Awaited<ReturnType<typeof createClient>>;

/** Owners and the viewer's hearts for a page of public deck rows — the
 *  one hydration every public deck list shares (browse, trending, a card's
 *  "Decks with this card"). `viewerId` null = anonymous (no like read). */
async function hydratePublicDecks(
  supabase: DeckReadClient,
  decks: DeckRow[],
  viewerId: string | null,
): Promise<PublicDeckListing[]> {
  if (decks.length === 0) return [];
  const deckIds = decks.map((d) => d.id);
  const [owners, viewerLikes] = await Promise.all([
    (async () => {
      const ownerIds = Array.from(new Set(decks.map((d) => d.owner_id)));
      const { data } = await supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", ownerIds);
      const byId = new Map<string, DeckOwner>();
      for (const row of data ?? []) {
        byId.set(row.id, {
          username: row.username,
          display_name: row.display_name,
          // Only a drawable avatar (migration 0127, lib/media/media-urls.ts).
          avatar_url: profileMediaSrc("avatar", row.avatar_url, row.id),
        });
      }
      return byId;
    })(),
    viewerId
      ? supabase
          .from("deck_likes")
          .select("deck_id")
          .eq("user_id", viewerId)
          .in("deck_id", deckIds)
      : Promise.resolve({ data: [] as Array<{ deck_id: string }> }),
  ]);

  const viewerLiked = new Set<string>();
  for (const row of viewerLikes.data ?? []) {
    viewerLiked.add(row.deck_id);
  }

  // likes_count comes straight off the row — the deck_likes triggers keep
  // it exact (migration 0055), so no aggregation query is needed here.
  return decks.map((row) => ({
    ...withCounts(row),
    owner: owners.get(row.owner_id) ?? null,
    liked_by_viewer: viewerLiked.has(row.id),
  }));
}

export async function listPublicDecks(
  options: {
    limit?: number;
    offset?: number;
    search?: string;
    format?: DeckFormat;
    sort?: PublicDecksSort;
    /** One creator's decks (/decks/browse?owner=<handle>, a profile's "See
     *  all decks"). An unknown handle lists nothing. */
    ownerUsername?: string;
    /** Skip the viewer lookup AND the cookie read entirely — for static/ISR
     *  pages (e.g. /decks). `liked_by_viewer` is `false` for every row; the
     *  like button re-checks the session cookie at click time. */
    anonymous?: boolean;
  } = {},
): Promise<PublicDeckListing[]> {
  if (!isSupabaseConfigured()) return [];
  const {
    limit = 24,
    offset = 0,
    search,
    format,
    sort = "recent",
    ownerUsername,
    anonymous = false,
  } = options;

  try {
    const supabase = anonymous ? createPublicClient() : await createClient();
    // An empty deck is thin content: the sitemap, the hub counts and the
    // deck page's robots already skip it, and the list does too (DK0.8).
    let query = supabase
      .from("decks")
      .select("*")
      .eq("visibility", "public")
      .gt("card_count", 0);

    if (ownerUsername) {
      const { data: owner } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", ownerUsername.toLowerCase())
        .maybeSingle();
      if (!owner) return [];
      query = query.eq("owner_id", owner.id);
    }
    if (format) {
      query = query.eq("format", format);
    }
    if (search?.trim()) {
      // Same LIKE-escaping posture as the gallery/sets search.
      const sqlEscaped = search.trim().replace(/[%_]/g, "\\$&");
      const quoted = `"%${sqlEscaped.replace(/"/g, '\\"')}%"`;
      query = query.or(`title.ilike.${quoted},description.ilike.${quoted}`);
    }

    query =
      sort === "popular"
        ? query.order("likes_count", { ascending: false }).order("updated_at", {
            ascending: false,
          })
        : sort === "viewed"
          ? query.order("view_count", { ascending: false }).order("updated_at", {
              ascending: false,
            })
          : query.order("updated_at", { ascending: false });

    // A unique key last, so offset pages never repeat or skip a deck that
    // ties another on the sort (decks made in one transaction share an
    // updated_at).
    const { data: decks } = await query
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    if (!decks || decks.length === 0) return [];

    const viewer = anonymous ? null : await getCurrentUser();
    return await hydratePublicDecks(supabase, decks, viewer?.id ?? null);
  } catch {
    return [];
  }
}

/** How many decks a one-row strip fetches (the CSS shows 1–4 of them). */
export const DECK_ROW_MAX = 4;

/** "Trending now" (TODO DK8.2): public, non-empty decks of REAL CREATORS —
 *  no admin, at least one public card of their own (0149's
 *  `owner_is_creator`, the card page's anti-spam rule: a throwaway
 *  account's deck never trends, however liked) — ranked by their likes of
 *  the last 7 days (migration 0149's `list_trending_decks` — the owner's
 *  own like left out; ties by all-time likes, then the newest edit). Only
 *  decks liked this week: an empty answer hides the row. Cookie-free (the
 *  /decks and /gallery landings stay ISR); a database the function hasn't
 *  reached lists none. */
export async function listTrendingDecks(limit = DECK_ROW_MAX): Promise<PublicDeckListing[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("list_trending_decks", { p_limit: limit });
    if (error || !Array.isArray(data) || data.length === 0) return [];
    return await hydratePublicDecks(supabase, data, null);
  } catch {
    return [];
  }
}

/** Public decks by one creator — the profile page's "Decks by X" section.
 *  Cookie-free public client + likes off the denormalized column, so the
 *  caller stays viewer-independent. Empty decks are left out (DK0.8), as
 *  `countPublicDecksByOwner` leaves them out of its number. */
export async function listPublicDecksByOwner(
  ownerId: string,
  limit = 6,
): Promise<DeckWithCounts[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createPublicClient();
    const { data: decks } = await supabase
      .from("decks")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("visibility", "public")
      .gt("card_count", 0)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (!decks || decks.length === 0) return [];
    return decks.map(withCounts);
  } catch {
    return [];
  }
}

/** Count of a creator's public, non-empty decks (profile badge) — the decks
 *  `listPublicDecksByOwner` lists, so the section never shows a number over
 *  nothing. */
export async function countPublicDecksByOwner(ownerId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = createPublicClient();
    const { count } = await supabase
      .from("decks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("visibility", "public")
      .gt("card_count", 0);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** How many public decks name each card — the gallery tile's "In N decks"
 *  and the card page's "Decks" stat (TODO DK8.4). ONE batched call per page
 *  of cards (migration 0149's `public_deck_counts_for_cards`, at most 200
 *  ids), counted by the same rule as the card page's list
 *  (`listPublicDecksContaining`: 0149's `public_deck_card_pairs`), so a
 *  count and the decks it stands for never disagree. A card no public deck
 *  names is absent (read it as 0). A failed call — a database 0149 hasn't
 *  reached — answers null: the caller shows no count rather than a wrong 0.
 *  Pass the caller's client; the answer doesn't depend on the viewer. */
export async function publicDeckCountsForCards(
  supabase: DeckReadClient,
  cardIds: readonly string[],
): Promise<Map<string, number> | null> {
  if (cardIds.length === 0) return new Map();
  try {
    const { data, error } = await supabase.rpc("public_deck_counts_for_cards", {
      p_card_ids: [...cardIds],
    });
    if (error || !Array.isArray(data)) return null;
    return new Map(data.map((row) => [row.card_id, row.deck_count]));
  } catch {
    return null;
  }
}

/** Sitewide public, non-empty deck count (homepage stats) — what /decks
 *  lists. Cookie-free. */
export async function countPublicDecks(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = createPublicClient();
    const { count } = await supabase
      .from("decks")
      .select("id", { count: "exact", head: true })
      .eq("visibility", "public")
      .gt("card_count", 0);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Deck + owner profile for the detail page. RLS filters non-readable rows
 *  (viewer-dependent, so the route stays dynamic — matching set pages). The
 *  read names the deck by its slug (lib/decks/deck-link.ts): an UNLISTED
 *  deck opens by its link and is in no list (migration 0151). */
export const getDeckBySlugWithOwner = cache(async (
  slug: string,
): Promise<DeckWithOwner | null> => {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: deck } = await viaDeckLink(
      supabase.from("decks").select("*").eq("slug", slug),
      slug,
    ).maybeSingle();
    if (!deck) return null;

    const { data: ownerRow } = await supabase
      .from("profiles")
      .select("username, display_name, avatar_url")
      .eq("id", deck.owner_id)
      .maybeSingle();

    return {
      ...narrowDeck(deck),
      owner: ownerRow
        ? {
            username: ownerRow.username,
            display_name: ownerRow.display_name,
            avatar_url: profileMediaSrc("avatar", ownerRow.avatar_url, deck.owner_id),
          }
        : null,
    };
  } catch {
    return null;
  }
});

// ---------------------------------------------------------------------------
// Entries inside a deck
// ---------------------------------------------------------------------------

export type DeckItem<C = Card> = {
  entry: DeckCardEntry;
  /** The linked PipGlyph card, when the entry has one and it's still
   *  readable by the viewer. */
  card: C | null;
  /** The card's maker when it is NOT the deck's owner (owner decision D3,
   *  TODO DK2.9: another creator's public card, credited "by @handle" and
   *  linked at THEIR card page). Null for the owner's own cards and for an
   *  entry with no readable card. */
  cardOwner: { username: string | null } | null;
};

/** Every entry of a deck, in list order. Paged past PostgREST's 1000-row
 *  cap (a deck holds at most 500 rows since 0143, but one stored before it
 *  may hold more), ordered on a unique key last so pages never overlap. The
 *  exact count lets an ordinary deck finish in ONE request.
 *
 *  The ONE deck read every surface uses (the page, its copied decklist, the
 *  exports and report, the AI's deck context): another creator's card is
 *  shown only while it is PUBLIC (owner decision D3). RLS would hand an
 *  UNLISTED one to anyone — the card is link-only, never a deck's; it reads
 *  as null here, "No longer available" to the deck's owner, exactly as a
 *  card RLS hides. The deck owner's own cards are as RLS returns them.
 *  Every column of each card (`*`); the deck page reads listDeckPageCards. */
export async function listDeckCards(deckId: string): Promise<DeckItem[]> {
  return readDeckItems(deckId, async (supabase, ids) => {
    const { data } = await supabase.from("cards").select("*").in("id", ids);
    return (data ?? []).map(narrowCard);
  });
}

/** The card columns the deck PAGE reads (TODO DK5.11) instead of `cards.*`:
 *  what its list, pop-up, breakdown, fan and cover draw — the card's
 *  identity, its render pointers, its provenance (an entry's status,
 *  lib/decks/entry-status.ts) and every field the import fingerprint covers
 *  (whether an import is still "Imported" hashes them all, and the same
 *  fields are a tile's live-preview fallback, cardToPreviewData). Left out:
 *  the search vector, metadata, oracle text, counters and stamps. */
export const DECK_PAGE_CARD_COLUMNS = [
  "id",
  "owner_id",
  "slug",
  "visibility",
  "parent_card_id",
  "source_scryfall_id",
  "rendered_image_url",
  "rendered_thumb_url",
  "rendered_back_image_url",
  "rendered_back_thumb_url",
  ...IMPORT_FINGERPRINT_FIELDS,
  "import_scryfall_id",
  "import_fingerprint",
] as const;

/** The page's columns a database may not have yet, by migration (0137,
 *  0141, 0144): PostgREST answers a select naming one with 42703, and the
 *  read runs again without that migration's columns — the row then reads as
 *  such a database's `*` does. Remove each once its migration is on
 *  production and on dev. */
const DECK_PAGE_LATE_COLUMNS: readonly (readonly string[])[] = [
  ["printed_types"],
  ["nickname"],
  ["import_scryfall_id", "import_fingerprint"],
];

type PageColumn = (typeof DECK_PAGE_CARD_COLUMNS)[number];
type ProvenanceColumn = "import_scryfall_id" | "import_fingerprint";

/** A card as the deck page reads it (DECK_PAGE_CARD_COLUMNS). A `Card` is
 *  one; the provenance columns are absent on a database 0144 hasn't reached. */
export type DeckPageCard = Omit<Pick<Card, PageColumn>, ProvenanceColumn> & Partial<Pick<Card, ProvenanceColumn>>;

/** The deck page's read (TODO DK5.11): listDeckCards' entries and rules —
 *  the D3 filter, the makers' credit — with only DECK_PAGE_CARD_COLUMNS of
 *  each card. */
export async function listDeckPageCards(deckId: string): Promise<DeckItem<DeckPageCard>[]> {
  return readDeckItems(deckId, async (supabase, ids) =>
    (await readDeckPageCardRows((columns) => supabase.from("cards").select(columns).in("id", ids))) ?? [],
  );
}

/** Cards read with DECK_PAGE_CARD_COLUMNS — the page's read, and the add
 *  box's results (lib/decks/add-actions.ts), which the page draws as rows
 *  the moment they are added. `select(columns)` builds the query; a
 *  database missing a late column (DECK_PAGE_LATE_COLUMNS) is asked again
 *  without it. Null on any other error. */
export async function readDeckPageCardRows(
  select: (columns: string) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
): Promise<DeckPageCard[] | null> {
  let columns: string[] = [...DECK_PAGE_CARD_COLUMNS];
  for (;;) {
    const { data, error } = await select(columns.join(", "));
    const missing =
      error?.code === "42703"
        ? DECK_PAGE_LATE_COLUMNS.find((late) => late.some((column) => columns.includes(column) && (error.message ?? "").includes(column)))
        : undefined;
    if (missing) {
      columns = columns.filter((column) => !missing.includes(column));
      continue;
    }
    if (error) return null;
    return ((data ?? []) as unknown as CardRow[]).map((row) => narrowCard(row) as DeckPageCard);
  }
}

type CardReader<C> = (supabase: Awaited<ReturnType<typeof createClient>>, ids: string[]) => Promise<C[]>;

/** The one body of both reads: the entries in list order, each card the
 *  deck may show (canLinkIntoDeck), each other creator's handle. Both deck
 *  reads name the deck by its id — its link (lib/decks/deck-link.ts): a
 *  visitor reads an UNLISTED deck's rows by it, never in a list (0151). */
async function readDeckItems<C extends { id: string; owner_id: string; visibility: string }>(
  deckId: string,
  readCards: CardReader<C>,
): Promise<DeckItem<C>[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const [{ data: entries, error }, { data: deck }] = await Promise.all([
      selectAllRows<DeckCardRow>((from, to) =>
        viaDeckLink(
          supabase
            .from("deck_cards")
            .select("*", { count: "exact" })
            .eq("deck_id", deckId)
            .order("position", { ascending: true })
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
          deckId,
        ),
      ),
      viaDeckLink(supabase.from("decks").select("owner_id").eq("id", deckId), deckId).maybeSingle(),
    ]);
    // No readable deck row, no entries: without the owner, another
    // creator's card could not be told from the owner's own.
    if (error || !deck || entries.length === 0) return [];
    const deckOwnerId = deck.owner_id;

    const cardIds = Array.from(
      new Set(
        entries
          .map((e) => e.card_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const cardById = new Map<string, C>();
    for (const ids of chunkIds(cardIds)) {
      for (const card of await readCards(supabase, ids)) {
        // The write rule, read side (canLinkIntoDeck: own, or public).
        if (!canLinkIntoDeck(card, deckOwnerId)) continue;
        cardById.set(card.id, card);
      }
    }

    // Another creator's card (D3): its maker's handle, for the credit and
    // the link to their card page.
    const makerIds = Array.from(
      new Set([...cardById.values()].map((card) => card.owner_id).filter((id) => id !== deckOwnerId)),
    );
    const usernameOf = new Map<string, string | null>();
    if (makerIds.length > 0) {
      const { data: makers } = await supabase.from("profiles").select("id, username").in("id", makerIds);
      for (const maker of makers ?? []) usernameOf.set(maker.id, maker.username ?? null);
    }

    return entries.map((row) => {
      const card = row.card_id ? (cardById.get(row.card_id) ?? null) : null;
      return {
        entry: narrowDeckCard(row),
        card,
        cardOwner:
          card && card.owner_id !== deckOwnerId
            ? { username: usernameOf.get(card.owner_id) ?? null }
            : null,
      };
    });
  } catch {
    return [];
  }
}

/** A single deck entry + its parent deck, only when the current user owns
 *  the deck. Powers the /create?deckCard= remix deep-link. */
export async function getMyDeckCardWithDeck(deckCardId: string): Promise<{
  entry: DeckCardEntry;
  deck: Deck;
} | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data: entry } = await supabase
      .from("deck_cards")
      .select("*")
      .eq("id", deckCardId)
      .maybeSingle();
    if (!entry) return null;
    const { data: deck } = await supabase
      .from("decks")
      .select("*")
      .eq("id", entry.deck_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!deck) return null;
    return { entry: narrowDeckCard(entry), deck: narrowDeck(deck) };
  } catch {
    return null;
  }
}

/** Whether the current viewer has liked the given deck. */
export async function viewerLikesDeck(deckId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("deck_likes")
      .select("id")
      .eq("deck_id", deckId)
      .eq("user_id", user.id)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

/**
 * Entries a remix job turns into cards: those with a linked custom card or a
 * Scryfall printing. The jobs route sizes a deck_remix batch on this (never
 * the ceiling), and the deck page's capacity warning uses the same number.
 * RLS hides decks that aren't the caller's, so a foreign deck reads 0.
 */
export async function countRemixableDeckCards(deckId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("deck_cards")
      .select("*", { count: "exact", head: true })
      .eq("deck_id", deckId)
      .or("card_id.not.is.null,scryfall_id.not.is.null");
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** How many cards a deck holds — the indexing gate for /deck/[slug]: an
 *  empty deck page is thin and stays out of the index (noindex, follow) until
 *  it has cards. "Empty" is the stored `card_count` (0143: physical cards,
 *  maybeboard left out) — the same test the public lists, the sitemap and
 *  the format hubs' counts use. Viewer-independent, cookie-free,
 *  cache()-deduped per request. */
export const countDeckEntries = cache(async (deckId: string): Promise<number> => {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("decks")
      .select("card_count")
      .eq("id", deckId)
      .maybeSingle();
    return data?.card_count ?? 0;
  } catch {
    return 0;
  }
});

/** One card's public deck count — the card page's "Decks" stat, the total
 *  behind its "Decks with this card" (which shows the newest few). Null
 *  when it couldn't be read. Cookie-free. */
export async function countPublicDecksForCard(cardId: string): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  const counts = await publicDeckCountsForCards(createPublicClient(), [cardId]);
  return counts ? (counts.get(cardId) ?? 0) : null;
}

/** How many decks a card's page names (its "Decks with this card" tiles —
 *  two rows of three — the "In decks" row and the JSON-LD). */
export const CARD_PAGE_DECKS_MAX = 6;

/** The public decks a card's page names — its "Decks with this card"
 *  tiles, its "In decks" row AND its CreativeWork `isPartOf`, one list
 *  (card-detail-content.tsx). Since D3 anyone's public deck may hold a
 *  creator's public card, so the page names the card owner's own public,
 *  non-empty decks and another user's only from a real creator: no admin,
 *  at least one public card of their own, and only while the card is public
 *  (migration 0144's `public_decks_containing_card`, since 0149 over
 *  `public_deck_card_pairs` — the ONE rule, which the "In N decks" count
 *  reads too). Newest first, at most CARD_PAGE_DECKS_MAX. A database the
 *  function hasn't reached names none. Cookie-free; cache()-deduped per
 *  request. */
export const listPublicDecksContaining = cache(
  async (cardId: string): Promise<Array<{ slug: string; title: string }>> => {
    if (!isSupabaseConfigured()) return [];
    try {
      const supabase = createPublicClient();
      const { data, error } = await supabase.rpc("public_decks_containing_card", {
        p_card_id: cardId,
        p_limit: CARD_PAGE_DECKS_MAX,
      });
      if (error || !Array.isArray(data)) return [];
      return data.map((d) => ({ slug: d.slug, title: d.title }));
    } catch {
      return [];
    }
  },
);

/** The same list as deck rows for the tiles — `listPublicDecksContaining`
 *  (the ONE list, in its order) hydrated by slug (decks' slugs are
 *  unique), never a second rule. Cookie-free. */
export async function listPublicDeckTilesContaining(cardId: string): Promise<PublicDeckListing[]> {
  const named = await listPublicDecksContaining(cardId);
  if (named.length === 0) return [];
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("decks")
      .select("*")
      .in("slug", named.map((deck) => deck.slug))
      .eq("visibility", "public");
    if (error || !data) return [];
    const bySlug = new Map(data.map((row) => [row.slug, row]));
    const rows = named.flatMap((deck) => {
      const row = bySlug.get(deck.slug);
      return row ? [row] : [];
    });
    return await hydratePublicDecks(supabase, rows, null);
  } catch {
    return [];
  }
}
