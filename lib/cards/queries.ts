import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  isVisibility,
  type Card,
  type CardTemplate,
  type CardWithLineage,
  type CardWithOwner,
  type CardType,
  type ColorIdentity,
  type GameSystem,
  type Profile,
  type Rarity,
} from "@/types/card";
import type { Card as CardRow } from "@/types/supabase";
import { buildCardPath } from "@/lib/cards/utils";
import {
  TRENDING_FRESHNESS_WINDOW_DAYS,
  TRENDING_WINDOW_DAYS,
  sortTrending,
  trendingScore,
} from "@/lib/cards/trending";

// Composed shape: card + owner profile + like count + viewer's like state.
// Used by the gallery and any "card tile" listing.
//
// `liked_by_viewer` is `false` for anonymous viewers and for cards the
// current user hasn't liked. The flag lets tile UIs render the heart in
// the right state without a follow-up client fetch.
export type CardWithStats = CardWithOwner & {
  likes_count: number;
  liked_by_viewer: boolean;
};

export type ProfileWithStats = Profile & {
  public_cards_count: number;
};

export type PublicCardListSort = "recent" | "popular" | "viewed";

export type PublicCardListOptions = {
  limit?: number;
  offset?: number;
  cardType?: CardType;
  rarity?: Rarity;
  search?: string;
  sort?: PublicCardListSort;
  visibility?: "public" | "unlisted" | "all-shareable";
  /** Scryfall provenance filter (Phase 11 chunk 13). When set, restricts
   *  the result to cards imported from this Scryfall id. Powers the
   *  /gallery?source=<id> "lineage" view. */
  sourceScryfallId?: string;
  /** Filter to cards carrying this tag (the gallery ?tag= view). */
  tag?: string;
  /** Color-identity filter. Solid colors match via array containment;
   *  "colorless" matches an empty identity OR a literal colorless token. */
  colorIdentity?: ColorIdentity;
  /** Only cards that are themselves remixes of another card. */
  remixesOnly?: boolean;
  /** Viewer-independent mode for static/ISR pages: uses the cookie-free
   *  public client and skips the viewer's like-state lookup
   *  (`liked_by_viewer` is always false). Anonymous RLS visibility is
   *  identical to what signed-out traffic sees today. */
  anonymous?: boolean;
};

// ---------------------------------------------------------------------------
// Narrowing helper — every query returns rows whose enum-typed text columns
// are typed as plain `string`. We cast through this so the rest of the app
// gets the narrower domain type from `types/card.ts`.
// ---------------------------------------------------------------------------

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
  };
}

// ---------------------------------------------------------------------------
// Catalog reads — cached per-request via Supabase's auto-batched fetches.
// ---------------------------------------------------------------------------

export async function getActiveGameSystems(): Promise<GameSystem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("game_systems")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

export async function getFantasyGameSystem(): Promise<GameSystem | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    // Seeded reference data, identical for every viewer — cookie-free so
    // /preview can be ISR-cached.
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("game_systems")
      .select("*")
      .eq("key", "fantasy")
      .eq("is_active", true)
      .maybeSingle();
    return data ?? null;
  } catch {
    return null;
  }
}

export async function getTemplatesForGameSystem(
  gameSystemId: string,
): Promise<CardTemplate[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    // Seeded reference data — see getFantasyGameSystem.
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("card_templates")
      .select("*")
      .eq("game_system_id", gameSystemId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Card reads
// ---------------------------------------------------------------------------

type ListPublicCardsOptions = {
  limit?: number;
  offset?: number;
  cardType?: string;
};

export async function listPublicCards(
  options: ListPublicCardsOptions = {},
): Promise<CardWithOwner[]> {
  if (!isSupabaseConfigured()) return [];
  const { limit = 24, offset = 0, cardType } = options;

  try {
    const supabase = await createClient();
    // We can't embed profiles via PostgREST: cards.owner_id references
    // auth.users(id), not profiles(id), so the relationship isn't auto-
    // discovered. Fetch in two steps and stitch by owner_id.
    let cardQuery = supabase
      .from("cards")
      .select("*")
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (cardType) {
      cardQuery = cardQuery.eq("card_type", cardType);
    }

    const { data: cardRows, error: cardErr } = await cardQuery;
    if (cardErr || !cardRows || cardRows.length === 0) return [];

    const ownerIds = Array.from(new Set(cardRows.map((c) => c.owner_id)));
    const { data: ownerRows } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", ownerIds);

    const ownerById = new Map<string, CardWithOwner["owner"]>();
    for (const row of ownerRows ?? []) {
      ownerById.set(row.id, {
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
      });
    }

    return cardRows.map((row) => ({
      ...narrowCard(row),
      owner: ownerById.get(row.owner_id) ?? null,
    }));
  } catch {
    return [];
  }
}

export async function listMyCards(): Promise<Card[]> {
  if (!isSupabaseConfigured()) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      // Safety bound so a power user with a huge library can't pull an
      // unbounded result set into the dashboard. Pagination is a follow-up.
      .limit(1000);
    if (error || !data) return [];
    return data.map(narrowCard);
  } catch {
    return [];
  }
}

export async function getCardById(id: string): Promise<Card | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? narrowCard(data) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch a card by slug owned by the currently signed-in user. Returns null
 * if there's no session, no Supabase config, or no matching row. Used by
 * the editor page to load a draft for editing.
 */
export async function getMyCardBySlug(slug: string): Promise<Card | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("owner_id", user.id)
      .eq("slug", slug)
      .maybeSingle();
    return data ? narrowCard(data) : null;
  } catch {
    return null;
  }
}

/**
 * Find a card by slug across all owners — RLS filters out anything the viewer
 * isn't allowed to see. If multiple cards share the slug (slugs are unique
 * per owner, not globally), we return the most recently updated one.
 *
 * Used by the public `/card/[slug]` page. A future phase can disambiguate
 * via `/card/[username]/[slug]` if collisions become common.
 */
export async function getCardBySlugPublic(slug: string): Promise<Card | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("slug", slug)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (!data || data.length === 0) return null;
    return narrowCard(data[0]);
  } catch {
    return null;
  }
}

/**
 * Resolve a legacy `/card/[slug]` URL to its canonical
 * `/card/[username]/[slug]` form. Used by the redirector page.
 *
 * Rules (per Phase 11 chunk 11):
 *   - Only shareable rows count: visibility must be public or unlisted.
 *   - There must be EXACTLY one match. Multiple owners with the same
 *     slug are an ambiguous resolve — we 404 rather than guess.
 *   - The owner must have a username set. Cards owned by a profile
 *     without a username are unreachable via the public URL and resolve
 *     to null (the caller turns this into a 404).
 *
 * RLS still gates which rows are visible; this query doesn't broaden
 * access — it just decides where to redirect when the slug resolves.
 */
export async function resolveLegacyCardSlug(
  slug: string,
): Promise<{ username: string; slug: string } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: rows } = await supabase
      .from("cards")
      .select("id, slug, owner_id, visibility")
      .eq("slug", slug)
      .in("visibility", ["public", "unlisted"]);
    if (!rows || rows.length !== 1) return null;

    const row = rows[0];
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", row.owner_id)
      .maybeSingle();
    const username = profile?.username;
    if (!username) return null;

    return { username, slug: row.slug };
  } catch {
    return null;
  }
}

/**
 * Fetch a card by `(owner_username, slug)`. Used by the public `/card/[slug]`
 * page in later phases — for now we accept the *current* user's slug too,
 * since profile lookups need RLS context.
 */
export async function getCardByOwnerAndSlug(
  ownerUsername: string,
  slug: string,
): Promise<CardWithOwner | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .eq("username", ownerUsername)
      .maybeSingle();

    if (!profile) return null;

    const { data: card } = await supabase
      .from("cards")
      .select("*")
      .eq("owner_id", profile.id)
      .eq("slug", slug)
      .maybeSingle();

    if (!card) return null;

    return {
      ...narrowCard(card),
      owner: {
        username: profile.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
      },
    };
  } catch {
    return null;
  }
}

export async function getCardWithLineage(
  id: string,
): Promise<CardWithLineage | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: cardRow } = await supabase
      .from("cards")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!cardRow) return null;

    let parent: CardWithLineage["parent"] = null;
    if (cardRow.parent_card_id) {
      const { data: parentRow } = await supabase
        .from("cards")
        .select("id, slug, title")
        .eq("id", cardRow.parent_card_id)
        .maybeSingle();
      parent = parentRow ?? null;
    }

    return {
      ...narrowCard(cardRow),
      parent,
    };
  } catch {
    return null;
  }
}

/**
 * True if the given slug is already used by the current user. The DB
 * unique (owner_id, slug) constraint enforces this server-side too — this
 * is just for friendlier UX errors.
 */
export async function isSlugTakenForCurrentUser(
  slug: string,
  excludeCardId?: string,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const user = await getCurrentUser();
  if (!user) return false;

  try {
    const supabase = await createClient();
    let query = supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("slug", slug);
    if (excludeCardId) {
      query = query.neq("id", excludeCardId);
    }
    const { count, error } = await query;
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Gallery + profile reads — Phase 6.
//
// PostgREST can't auto-discover the cards↔profiles relationship (owner_id
// references auth.users, not profiles) and aggregates across relationships
// are awkward to ORDER BY. Each query batches a follow-up fetch and stitches
// in TypeScript so we keep the SQL straightforward and RLS-safe.
// ---------------------------------------------------------------------------

const SHAREABLE_VISIBILITIES = ["public", "unlisted"] as const;

async function attachStats(
  rows: CardRow[],
  sort: "recent" | "popular" = "recent",
  { anonymous = false }: { anonymous?: boolean } = {},
): Promise<CardWithStats[]> {
  if (rows.length === 0) return [];

  const supabase = anonymous ? createPublicClient() : await createClient();
  const cardIds = rows.map((r) => r.id);
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));

  // Read the viewer once up front; if they're anonymous we skip the
  // self-like lookup entirely. The likes query never blocks on RLS — the
  // policy is publicly readable — so this is cheap. Anonymous mode skips
  // the lookup without touching cookies (keeps ISR callers static).
  const viewer = anonymous ? null : await getCurrentUser();

  // Two queries instead of three: the like rows already carry user_id, so
  // the viewer's own likes are derived from the same result set that
  // feeds the counts.
  const [likesResult, ownersResult] = await Promise.all([
    supabase
      .from("card_likes")
      .select("card_id, user_id")
      .in("card_id", cardIds),
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", ownerIds),
  ]);

  const likeCount = new Map<string, number>();
  const viewerLiked = new Set<string>();
  for (const row of likesResult.data ?? []) {
    likeCount.set(row.card_id, (likeCount.get(row.card_id) ?? 0) + 1);
    if (viewer && row.user_id === viewer.id) viewerLiked.add(row.card_id);
  }

  const ownerById = new Map<string, CardWithOwner["owner"]>();
  for (const row of ownersResult.data ?? []) {
    ownerById.set(row.id, {
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
    });
  }

  const enriched: CardWithStats[] = rows.map((row) => ({
    ...narrowCard(row),
    owner: ownerById.get(row.owner_id) ?? null,
    likes_count: likeCount.get(row.id) ?? 0,
    liked_by_viewer: viewerLiked.has(row.id),
  }));

  if (sort === "popular") {
    enriched.sort((a, b) => {
      if (b.likes_count !== a.likes_count) return b.likes_count - a.likes_count;
      return (
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
    });
  }

  return enriched;
}

/**
 * Public gallery query with filters, search, and sort. RLS limits results
 * to readable rows; we layer "public" (default) or "all-shareable"
 * (public + unlisted) on top.
 */
export async function listPublicCardsRich(
  options: PublicCardListOptions = {},
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];

  const {
    limit = 24,
    offset = 0,
    cardType,
    rarity,
    search,
    sort = "recent",
    visibility = "public",
    sourceScryfallId,
    tag,
    colorIdentity,
    remixesOnly = false,
    anonymous = false,
  } = options;

  try {
    const supabase = anonymous ? createPublicClient() : await createClient();
    // "viewed" sorts by the materialized view tally in SQL; "recent" (and the
    // pre-rerank pool for "popular") sort by recency.
    const orderColumn = sort === "viewed" ? "view_count" : "updated_at";
    let query = supabase
      .from("cards")
      .select("*")
      .order(orderColumn, { ascending: false });

    if (visibility === "all-shareable") {
      query = query.in(
        "visibility",
        SHAREABLE_VISIBILITIES as unknown as string[],
      );
    } else {
      query = query.eq("visibility", visibility);
    }

    if (cardType) {
      query = query.eq("card_type", cardType);
    }
    if (rarity) {
      query = query.eq("rarity", rarity);
    }
    if (sourceScryfallId) {
      query = query.eq("source_scryfall_id", sourceScryfallId);
    }
    if (tag) {
      query = query.contains("tags", [tag]);
    }
    if (remixesOnly) {
      query = query.not("parent_card_id", "is", null);
    }
    if (colorIdentity) {
      if (colorIdentity === "colorless") {
        // Colorless cards are stored inconsistently — some as an empty
        // identity, some with an explicit "colorless" token. Match both.
        query = query.or(
          "color_identity.eq.{},color_identity.cs.{colorless}",
        );
      } else {
        query = query.contains("color_identity", [colorIdentity]);
      }
    }
    if (search?.trim()) {
      // PostgREST's `.or(...)` argument is a structural string: commas
      // separate filter terms, parens group, colons split column/op/value,
      // and double-quotes delimit values that contain those structural
      // characters. We escape SQL LIKE wildcards (% and _) so a user can't
      // turn a search into a wildcard match, then wrap the value in
      // double-quotes and backslash-escape any literal quotes so that
      // structural chars in the input don't break the filter expression.
      // RLS is still the real authorization gate, but a clean filter
      // expression avoids runtime parse errors and confusing results.
      const sqlEscaped = search.trim().replace(/[%_]/g, "\\$&");
      const quoted = `"%${sqlEscaped.replace(/"/g, '\\"')}%"`;
      query = query.or(
        `title.ilike.${quoted},rules_text.ilike.${quoted},flavor_text.ilike.${quoted}`,
      );
    }

    // When sorting by popularity we fetch a larger window so the in-process
    // re-sort has more candidates to work with. 2× the page (capped at 48)
    // is plenty at current scale — 3×/60 was measurably over-fetching.
    const fetchLimit =
      sort === "popular" ? Math.min(Math.max(limit * 2, 32), 48) : limit;
    query = query.range(offset, offset + fetchLimit - 1);

    const { data, error } = await query;
    if (error || !data) return [];

    // Only "popular" re-ranks in-process; "recent"/"viewed" are already
    // ordered by the SQL query above.
    const enriched = await attachStats(
      data,
      sort === "popular" ? "popular" : "recent",
      { anonymous },
    );
    return enriched.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Resolves a profile's `pinned_card_ids` array into full card rows. We
 * filter out cards that:
 *   - no longer exist (the array isn't FK-bound, so this can happen)
 *   - have been made private/unlisted (only public pins are honored)
 * The result preserves the saved order of the array — the user explicitly
 * chose which card sits first.
 */
export async function listPinnedCardsForProfile(
  pinnedIds: readonly string[],
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];
  if (pinnedIds.length === 0) return [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .in("id", pinnedIds as string[])
      .eq("visibility", "public");

    if (error || !data || data.length === 0) return [];

    const order = new Map(pinnedIds.map((id, i) => [id, i]));
    const sorted = [...data].sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    return attachStats(sorted, "recent");
  } catch {
    return [];
  }
}

/**
 * All public + unlisted cards owned by a given user. Used by the profile
 * page. RLS already filters out private cards belonging to others; we
 * keep that filter explicit in the query for clarity.
 */
export async function listPublicCardsByOwner(
  ownerId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];
  const { limit = 24, offset = 0 } = options;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("owner_id", ownerId)
      .in("visibility", SHAREABLE_VISIBILITIES as unknown as string[])
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (!data || data.length === 0) return [];
    return attachStats(data, "recent");
  } catch {
    return [];
  }
}

/**
 * Recent public cards from every creator the user follows, newest first.
 * Powers the /feed page.
 */
export async function listFollowingFeed(
  userId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];
  const { limit = 24, offset = 0 } = options;

  try {
    const supabase = await createClient();
    const { data: follows } = await supabase
      .from("follows")
      .select("following_id")
      .eq("follower_id", userId)
      .limit(500);
    const ids = (follows ?? []).map((f) => f.following_id);
    if (ids.length === 0) return [];

    const { data } = await supabase
      .from("cards")
      .select("*")
      .in("owner_id", ids)
      .eq("visibility", "public")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (!data || data.length === 0) return [];
    return attachStats(data, "recent");
  } catch {
    return [];
  }
}

/**
 * Other public cards by the same owner, newest first — "More from this creator".
 */
export async function listMoreFromOwner(
  ownerId: string,
  excludeCardId: string,
  limit = 4,
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("visibility", "public")
      .neq("id", excludeCardId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data || data.length === 0) return [];
    return attachStats(data, "recent");
  } catch {
    return [];
  }
}

/**
 * Public cards of the same type by OTHER creators — "More like this".
 */
export async function listRelatedCards(
  params: { cardId: string; ownerId: string; cardType: string | null },
  limit = 4,
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured() || !params.cardType) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("card_type", params.cardType)
      .eq("visibility", "public")
      .neq("id", params.cardId)
      .neq("owner_id", params.ownerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data || data.length === 0) return [];
    return attachStats(data, "recent");
  } catch {
    return [];
  }
}

/**
 * How many shareable cards were remixed from this one (children whose
 * parent_card_id points here). RLS scopes the count to cards the viewer can
 * read, which for anon viewers is exactly the public/unlisted remixes.
 */
export async function countRemixesOfCard(cardId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("parent_card_id", cardId)
      .in("visibility", SHAREABLE_VISIBILITIES as unknown as string[]);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * How many sets this card belongs to (readable memberships).
 */
export async function countSetsForCard(cardId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("card_set_items")
      .select("set_id", { count: "exact", head: true })
      .eq("card_id", cardId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The most-liked shareable remixes of this card, for the analytics panel.
 * Pulls a bounded recent pool then ranks it by likes (attachStats "popular").
 */
export async function listTopRemixesOfCard(
  cardId: string,
  limit = 3,
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("parent_card_id", cardId)
      .in("visibility", SHAREABLE_VISIBILITIES as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(50);
    if (!data || data.length === 0) return [];
    const ranked = await attachStats(data, "popular");
    return ranked.slice(0, limit);
  } catch {
    return [];
  }
}

export type RemixWithParent = CardWithStats & {
  parent: { title: string; path: string } | null;
};

/**
 * The current user's own remixes (cards with a parent_card_id), newest first,
 * each annotated with the original's title + canonical path. Powers the
 * dashboard "Your remixes" section. Parent lookups are bulk (4 queries total,
 * independent of count).
 */
export async function listMyRemixes(limit = 12): Promise<RemixWithParent[]> {
  if (!isSupabaseConfigured()) return [];
  const user = await getCurrentUser();
  if (!user) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("cards")
      .select("*")
      .eq("owner_id", user.id)
      .not("parent_card_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data || data.length === 0) return [];
    const enriched = await attachStats(data, "recent");

    const parentIds = Array.from(
      new Set(
        data
          .map((r) => r.parent_card_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const parentById = new Map<string, { title: string; path: string }>();
    if (parentIds.length > 0) {
      const { data: parents } = await supabase
        .from("cards")
        .select("id, slug, title, owner_id")
        .in("id", parentIds);
      const ownerIds = Array.from(
        new Set((parents ?? []).map((p) => p.owner_id)),
      );
      const { data: owners } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", ownerIds);
      const usernameById = new Map(
        (owners ?? []).map((o) => [o.id, o.username]),
      );
      for (const p of parents ?? []) {
        parentById.set(p.id, {
          title: p.title,
          path: buildCardPath({
            slug: p.slug,
            owner: { username: usernameById.get(p.owner_id) ?? null },
          }),
        });
      }
    }

    return enriched.map((c) => ({
      ...c,
      parent: c.parent_card_id
        ? (parentById.get(c.parent_card_id) ?? null)
        : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Minimal parent-card link data for the "Remixed from" credit — the original
 * card's title + its canonical `/card/[username]/[slug]` path. Null if the
 * parent is missing or unreadable (deleted / gone private).
 */
export async function getRemixParentLink(
  parentId: string,
): Promise<{ title: string; path: string } | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: parent } = await supabase
      .from("cards")
      .select("id, slug, title, owner_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!parent) return null;
    const { data: owner } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", parent.owner_id)
      .maybeSingle();
    return {
      title: parent.title,
      path: buildCardPath({
        slug: parent.slug,
        owner: { username: owner?.username ?? null },
      }),
    };
  } catch {
    return null;
  }
}

/**
 * The canonical public path for a card id — used by the /go/card redirect so
 * gallery tiles can link to an original without every list query joining the
 * parent. Null when the card is missing / unreadable under RLS.
 */
export async function getCardCanonicalPath(
  id: string,
): Promise<string | null> {
  const link = await getRemixParentLink(id);
  return link?.path ?? null;
}

/**
 * 1-based popularity rank of this card by total likes among all shareable
 * cards. Null if the card isn't shareable. Full-scan aggregate (see 0042).
 */
export async function getCardLikeRankOverall(
  cardId: string,
): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("card_like_rank", {
      p_card_id: cardId,
    });
    return typeof data === "number" ? data : null;
  } catch {
    return null;
  }
}

/**
 * 1-based like rank of this card within a given set. Null if not a member.
 */
export async function getCardLikeRankInSet(
  cardId: string,
  setId: string,
): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("card_like_rank_in_set", {
      p_card_id: cardId,
      p_set_id: setId,
    });
    return typeof data === "number" ? data : null;
  } catch {
    return null;
  }
}

/**
 * Set summary for the "owner context" line + within-set rank: the set's title,
 * public path, and card count. Null when the id is missing / unreadable.
 */
export async function getSetSummary(setId: string): Promise<{
  title: string;
  slug: string;
  cardsCount: number;
} | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: set } = await supabase
      .from("card_sets")
      .select("id, title, slug")
      .eq("id", setId)
      .maybeSingle();
    if (!set) return null;
    const { count } = await supabase
      .from("card_set_items")
      .select("card_id", { count: "exact", head: true })
      .eq("set_id", setId);
    return { title: set.title, slug: set.slug, cardsCount: count ?? 0 };
  } catch {
    return null;
  }
}

/**
 * This card's 7-day trending signals (excluding the owner's own engagement),
 * for the velocity badge. Mirrors listTrendingCards' per-card aggregation but
 * scoped to a single card so it's cheap on the detail page.
 */
export async function getCardTrendingSignals(
  cardId: string,
  ownerId: string,
  createdAt: string,
): Promise<{
  likes_7d: number;
  comments_7d: number;
  remixes_7d: number;
  is_fresh: boolean;
}> {
  const empty = {
    likes_7d: 0,
    comments_7d: 0,
    remixes_7d: 0,
    is_fresh: false,
  };
  if (!isSupabaseConfigured()) return empty;
  try {
    const supabase = await createClient();
    const windowStart = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const [likes, comments, remixes] = await Promise.all([
      supabase
        .from("card_likes")
        .select("user_id", { count: "exact", head: true })
        .eq("card_id", cardId)
        .neq("user_id", ownerId)
        .gte("created_at", windowStart),
      supabase
        .from("card_comments")
        .select("author_id", { count: "exact", head: true })
        .eq("card_id", cardId)
        .neq("author_id", ownerId)
        .gte("created_at", windowStart),
      supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("parent_card_id", cardId)
        .neq("owner_id", ownerId)
        .gte("created_at", windowStart),
    ]);
    const freshCutoff =
      Date.now() - TRENDING_FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return {
      likes_7d: likes.count ?? 0,
      comments_7d: comments.count ?? 0,
      remixes_7d: remixes.count ?? 0,
      is_fresh: new Date(createdAt).getTime() > freshCutoff,
    };
  } catch {
    return empty;
  }
}

/**
 * Bump a card's lifetime view tally (best-effort, fire-and-forget). Uses the
 * public client + a SECURITY DEFINER RPC so it never touches auth/session —
 * safe to call from after(). Skip owner views at the call site.
 */
export async function incrementCardView(cardId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  try {
    const supabase = createPublicClient();
    await supabase.rpc("increment_card_view", { p_card_id: cardId });
  } catch {
    // best-effort — a missed view tick isn't worth surfacing
  }
}

/**
 * Look up a profile by username plus a count of their public cards.
 * Returns null if the profile doesn't exist.
 */
export async function getProfileByUsername(
  username: string,
): Promise<ProfileWithStats | null> {
  if (!isSupabaseConfigured()) return null;
  if (!username) return null;

  try {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("username", username)
      .maybeSingle();
    if (!profile) return null;

    const { count } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", profile.id)
      .in("visibility", SHAREABLE_VISIBILITIES as unknown as string[]);

    return {
      ...profile,
      public_cards_count: count ?? 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Trending — 7-day windowed weighted velocity (see lib/cards/trending.ts).
//
// We aggregate signals client-side rather than in SQL because PostgREST
// can't easily join four sources (cards, card_likes, card_comments, and
// remix children) with a single ORDER BY on the derived score. Fetching
// the candidate pool and scoring in-process mirrors how attachStats works.
//
// Candidate pool is capped at 500 most-recently-updated public cards —
// anything older is overwhelmingly unlikely to be trending, and the cap
// keeps memory bounded as the catalog grows.
// ---------------------------------------------------------------------------

const TRENDING_CANDIDATE_CAP = 500;

export async function listTrendingCards(
  options: { limit?: number; anonymous?: boolean } = {},
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];
  const { limit = 12, anonymous = false } = options;

  try {
    const supabase = anonymous ? createPublicClient() : await createClient();

    const { data: cardRows, error: cardErr } = await supabase
      .from("cards")
      .select("*")
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .limit(TRENDING_CANDIDATE_CAP);

    if (cardErr || !cardRows || cardRows.length === 0) return [];

    const cardIds = cardRows.map((c) => c.id);
    const ownerByCardId = new Map(cardRows.map((c) => [c.id, c.owner_id]));
    const ownerIds = Array.from(new Set(cardRows.map((c) => c.owner_id)));

    const now = Date.now();
    const windowStart = new Date(
      now - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const freshnessCutoffMs =
      now - TRENDING_FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    // Viewer lookup is fire-and-forget so the trending score itself never
    // depends on auth — anonymous visitors still get the same trending list.
    // Anonymous mode (ISR pages) skips it without reading cookies.
    const viewer = anonymous ? null : await getCurrentUser();

    const [
      allLikesResult,
      recentLikesResult,
      recentCommentsResult,
      recentRemixesResult,
      ownersResult,
      viewerLikesResult,
    ] = await Promise.all([
      supabase.from("card_likes").select("card_id").in("card_id", cardIds),
      supabase
        .from("card_likes")
        .select("card_id, user_id")
        .in("card_id", cardIds)
        .gte("created_at", windowStart),
      supabase
        .from("card_comments")
        .select("card_id, author_id")
        .in("card_id", cardIds)
        .gte("created_at", windowStart),
      supabase
        .from("cards")
        .select("parent_card_id, owner_id")
        .in("parent_card_id", cardIds)
        .gte("created_at", windowStart),
      supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", ownerIds),
      viewer
        ? supabase
            .from("card_likes")
            .select("card_id")
            .eq("user_id", viewer.id)
            .in("card_id", cardIds)
        : Promise.resolve({ data: [] as Array<{ card_id: string }> }),
    ]);

    const totalLikes = new Map<string, number>();
    for (const row of allLikesResult.data ?? []) {
      totalLikes.set(row.card_id, (totalLikes.get(row.card_id) ?? 0) + 1);
    }

    const viewerLiked = new Set<string>();
    for (const row of viewerLikesResult.data ?? []) {
      viewerLiked.add(row.card_id);
    }

    const recentLikes = new Map<string, number>();
    for (const row of recentLikesResult.data ?? []) {
      if (row.user_id === ownerByCardId.get(row.card_id)) continue;
      recentLikes.set(row.card_id, (recentLikes.get(row.card_id) ?? 0) + 1);
    }

    const recentComments = new Map<string, number>();
    for (const row of recentCommentsResult.data ?? []) {
      if (row.author_id === ownerByCardId.get(row.card_id)) continue;
      recentComments.set(
        row.card_id,
        (recentComments.get(row.card_id) ?? 0) + 1,
      );
    }

    const recentRemixes = new Map<string, number>();
    for (const row of recentRemixesResult.data ?? []) {
      const parentId = row.parent_card_id;
      if (!parentId) continue;
      if (row.owner_id === ownerByCardId.get(parentId)) continue;
      recentRemixes.set(parentId, (recentRemixes.get(parentId) ?? 0) + 1);
    }

    const ownerProfileById = new Map<string, CardWithOwner["owner"]>();
    for (const row of ownersResult.data ?? []) {
      ownerProfileById.set(row.id, {
        username: row.username,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
      });
    }

    const scored = cardRows.map((row) => {
      const score = trendingScore({
        likes_7d: recentLikes.get(row.id) ?? 0,
        comments_7d: recentComments.get(row.id) ?? 0,
        remixes_7d: recentRemixes.get(row.id) ?? 0,
        is_fresh: new Date(row.created_at).getTime() > freshnessCutoffMs,
      });
      return {
        card: row,
        score,
        likesTotal: totalLikes.get(row.id) ?? 0,
        createdAt: row.created_at,
      };
    });

    return sortTrending(scored)
      .slice(0, limit)
      .map(({ card, likesTotal }) => ({
        ...narrowCard(card),
        owner: ownerProfileById.get(card.owner_id) ?? null,
        likes_count: likesTotal,
        liked_by_viewer: viewerLiked.has(card.id),
      }));
  } catch {
    return [];
  }
}

/**
 * Cards the given user has liked. Filters to shareable visibilities so a
 * card that flipped private after being liked drops off the list rather
 * than rendering as a broken tile. Ordered by most-recently-liked.
 */
export async function listLikedCardsByUser(
  userId: string,
  options: { limit?: number } = {},
): Promise<CardWithStats[]> {
  if (!isSupabaseConfigured()) return [];
  const { limit = 24 } = options;

  try {
    const supabase = await createClient();
    const { data: likeRows } = await supabase
      .from("card_likes")
      .select("card_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!likeRows || likeRows.length === 0) return [];

    const orderedIds = likeRows.map((r) => r.card_id);
    const { data: cardRows } = await supabase
      .from("cards")
      .select("*")
      .in("id", orderedIds)
      .in("visibility", SHAREABLE_VISIBILITIES as unknown as string[]);

    if (!cardRows || cardRows.length === 0) return [];

    const cardById = new Map(cardRows.map((row) => [row.id, row]));
    const sortedRows = orderedIds
      .map((id) => cardById.get(id))
      .filter((row): row is CardRow => row !== undefined);

    return attachStats(sortedRows, "recent");
  } catch {
    return [];
  }
}

/**
 * Number of likes on a single card. Used on the public detail page.
 */
export async function countCardLikes(cardId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("card_likes")
      .select("id", { count: "exact", head: true })
      .eq("card_id", cardId);
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Whether the given user has liked the given card. Returns false for
 * anonymous viewers.
 */
export async function hasUserLikedCard(
  userId: string | null | undefined,
  cardId: string,
): Promise<boolean> {
  if (!isSupabaseConfigured() || !userId) return false;
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("card_likes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("card_id", cardId);
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Count of cards visible to the public gallery (RLS keeps this to
 * public/unlisted rows for anonymous viewers). Powers the marketing
 * stat strip; returns 0 on any failure so the strip degrades quietly.
 */
export async function countPublicCards(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    // Viewer-independent by definition — cookie-free client keeps the
    // marketing pages that render this static/ISR-cacheable.
    const supabase = createPublicClient();
    const { count, error } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("visibility", "public");
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The most-used tags across recently updated public cards — the community
 * "trending topics". Counted in JS over a bounded window (a few hundred
 * rows) rather than a DB aggregate; plenty for v1 scale. Fail-soft.
 */
export async function listTrendingTags(
  limit = 8,
): Promise<{ tag: string; count: number }[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    // Public tags over public cards — viewer-independent, cookie-free.
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("cards")
      .select("tags")
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .limit(300);
    if (error || !data) return [];

    const counts = new Map<string, number>();
    for (const row of data) {
      for (const tag of row.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit);
  } catch {
    return [];
  }
}
