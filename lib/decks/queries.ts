import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isDeckBoard,
  isDeckFormat,
  isDeckVisibility,
  type Deck,
  type DeckCardEntry,
  type DeckFormat,
} from "@/types/deck";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  isVisibility,
  type Card,
  type CardWatermark,
  type ColorIdentity,
  type FaceContent,
} from "@/types/card";
import type {
  Card as CardRow,
  Deck as DeckRow,
  DeckCard as DeckCardRow,
  Profile,
} from "@/types/supabase";

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
  return {
    ...row,
    board: isDeckBoard(row.board) ? row.board : "main",
  };
}

// Same trust-boundary narrowing as lib/sets/queries.ts — jsonb columns are
// validated app-side on write.
function narrowCard(row: CardRow): Card {
  return {
    ...row,
    visibility: isVisibility(row.visibility) ? row.visibility : "private",
    rarity: row.rarity === null ? null : isRarity(row.rarity) ? row.rarity : null,
    card_type:
      row.card_type === null
        ? null
        : isCardType(row.card_type)
          ? row.card_type
          : null,
    color_identity: row.color_identity.filter(isColorIdentity) as ColorIdentity[],
    face_content: (row.face_content as FaceContent | null) ?? null,
    watermark: (row.watermark as CardWatermark | null) ?? null,
  };
}

type DecksClient =
  | Awaited<ReturnType<typeof createClient>>
  | ReturnType<typeof createPublicClient>;

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
  supabase: DecksClient,
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

// ---------------------------------------------------------------------------
// Public browse + detail
// ---------------------------------------------------------------------------

export type DeckOwner = Pick<
  Profile,
  "username" | "display_name" | "avatar_url"
> | null;

export type DeckWithOwner = Deck & { owner: DeckOwner };

export type PublicDeckListing = DeckWithCounts & {
  owner: DeckOwner;
  liked_by_viewer: boolean;
};

export type PublicDecksSort = "recent" | "popular" | "viewed";

export async function listPublicDecks(
  options: {
    limit?: number;
    offset?: number;
    search?: string;
    format?: DeckFormat;
    sort?: PublicDecksSort;
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
    anonymous = false,
  } = options;

  try {
    const supabase = anonymous ? createPublicClient() : await createClient();
    let query = supabase
      .from("decks")
      .select("*")
      .eq("visibility", "public");

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

    const { data: decks } = await query.range(offset, offset + limit - 1);
    if (!decks || decks.length === 0) return [];

    const deckIds = decks.map((d) => d.id);
    const viewer = anonymous ? null : await getCurrentUser();

    const [counts, owners, viewerLikes] = await Promise.all([
      countCardsForDecks(deckIds, supabase),
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
            avatar_url: row.avatar_url,
          });
        }
        return byId;
      })(),
      viewer
        ? supabase
            .from("deck_likes")
            .select("deck_id")
            .eq("user_id", viewer.id)
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
      ...narrowDeck(row),
      ...(counts.get(row.id) ?? { cards_count: 0, remixed_count: 0 }),
      owner: owners.get(row.owner_id) ?? null,
      liked_by_viewer: viewerLiked.has(row.id),
    }));
  } catch {
    return [];
  }
}

/** Public decks by one creator — the profile page's "Decks by X" section.
 *  Cookie-free public client + likes off the denormalized column, so the
 *  caller stays viewer-independent. */
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
      .order("updated_at", { ascending: false })
      .limit(limit);
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

/** Count of a creator's public decks (profile badge). */
export async function countPublicDecksByOwner(ownerId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = createPublicClient();
    const { count } = await supabase
      .from("decks")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", ownerId)
      .eq("visibility", "public");
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Sitewide public deck count (homepage stats). Cookie-free. */
export async function countPublicDecks(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = createPublicClient();
    const { count } = await supabase
      .from("decks")
      .select("id", { count: "exact", head: true })
      .eq("visibility", "public");
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** Deck + owner profile for the detail page. RLS filters non-readable rows
 *  (viewer-dependent, so the route stays dynamic — matching set pages). */
export async function getDeckBySlugWithOwner(
  slug: string,
): Promise<DeckWithOwner | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: deck } = await supabase
      .from("decks")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
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
            avatar_url: ownerRow.avatar_url,
          }
        : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entries inside a deck
// ---------------------------------------------------------------------------

export type DeckItem = {
  entry: DeckCardEntry;
  /** The linked custom card (proxy), when the entry has one and it's still
   *  readable by the viewer. */
  card: Card | null;
};

export async function listDeckCards(deckId: string): Promise<DeckItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data: entries } = await supabase
      .from("deck_cards")
      .select("*")
      .eq("deck_id", deckId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (!entries || entries.length === 0) return [];

    const cardIds = entries
      .map((e) => e.card_id)
      .filter((id): id is string => Boolean(id));
    const cardById = new Map<string, Card>();
    if (cardIds.length > 0) {
      const { data: cards } = await supabase
        .from("cards")
        .select("*")
        .in("id", cardIds);
      for (const row of cards ?? []) {
        cardById.set(row.id, narrowCard(row));
      }
    }

    return entries.map((row) => ({
      entry: narrowDeckCard(row),
      card: row.card_id ? (cardById.get(row.card_id) ?? null) : null,
    }));
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
 * Bump a deck's lifetime view tally (best-effort, fire-and-forget). Uses the
 * public client + a SECURITY DEFINER RPC so it never touches auth/session —
 * safe to call from after(). Skip owner views at the call site.
 */
export async function incrementDeckView(deckId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = createPublicClient();
    await supabase.rpc("increment_deck_view", { p_deck_id: deckId });
  } catch {
    // best-effort — a missed view tick isn't worth surfacing
  }
}
