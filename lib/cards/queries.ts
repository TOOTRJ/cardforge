import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
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

// Composed shape: card + owner profile + like count. Used by the gallery
// and any "card tile" listing.
export type CardWithStats = CardWithOwner & {
  likes_count: number;
};

export type ProfileWithStats = Profile & {
  public_cards_count: number;
};

export type PublicCardListOptions = {
  limit?: number;
  offset?: number;
  cardType?: CardType;
  rarity?: Rarity;
  search?: string;
  sort?: "recent" | "popular";
  visibility?: "public" | "unlisted" | "all-shareable";
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
    const supabase = await createClient();
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
    const supabase = await createClient();
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
      .order("updated_at", { ascending: false });
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
): Promise<CardWithStats[]> {
  if (rows.length === 0) return [];

  const supabase = await createClient();
  const cardIds = rows.map((r) => r.id);
  const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id)));

  const [likesResult, ownersResult] = await Promise.all([
    supabase.from("card_likes").select("card_id").in("card_id", cardIds),
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", ownerIds),
  ]);

  const likeCount = new Map<string, number>();
  for (const row of likesResult.data ?? []) {
    likeCount.set(row.card_id, (likeCount.get(row.card_id) ?? 0) + 1);
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
  } = options;

  try {
    const supabase = await createClient();
    let query = supabase
      .from("cards")
      .select("*")
      .order("updated_at", { ascending: false });

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
    // re-sort has more candidates to work with.
    const fetchLimit = sort === "popular" ? Math.max(limit * 3, 60) : limit;
    query = query.range(offset, offset + fetchLimit - 1);

    const { data, error } = await query;
    if (error || !data) return [];

    const enriched = await attachStats(data, sort);
    return enriched.slice(0, limit);
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
