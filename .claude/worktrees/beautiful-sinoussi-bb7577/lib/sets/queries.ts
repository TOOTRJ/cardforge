import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  isCardType,
  isColorIdentity,
  isRarity,
  isVisibility,
  type Card,
  type ColorIdentity,
  type Visibility,
} from "@/types/card";
import type {
  Card as CardRow,
  CardSet as CardSetRow,
  Profile,
} from "@/types/supabase";

export type CardSet = Omit<CardSetRow, "visibility"> & {
  visibility: Visibility;
};

export type CardSetWithCount = CardSet & {
  cards_count: number;
};

export type CardSetWithOwner = CardSet & {
  owner: Pick<Profile, "username" | "display_name" | "avatar_url"> | null;
};

// ---------------------------------------------------------------------------
// Narrowers — keep enum-typed text columns honest.
// ---------------------------------------------------------------------------

function narrowSet(row: CardSetRow): CardSet {
  return {
    ...row,
    visibility: isVisibility(row.visibility) ? row.visibility : "private",
  };
}

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

async function countCardsForSets(
  setIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (setIds.length === 0) return counts;

  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("card_set_items")
      .select("set_id")
      .in("set_id", setIds);
    for (const row of data ?? []) {
      counts.set(row.set_id, (counts.get(row.set_id) ?? 0) + 1);
    }
  } catch {
    // swallow — caller treats counts as 0 if missing.
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function listMySets(): Promise<CardSetWithCount[]> {
  if (!isSupabaseConfigured()) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    const supabase = await createClient();
    const { data: sets } = await supabase
      .from("card_sets")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });
    if (!sets || sets.length === 0) return [];

    const counts = await countCardsForSets(sets.map((s) => s.id));
    return sets.map((row) => ({
      ...narrowSet(row),
      cards_count: counts.get(row.id) ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function listPublicSets(options: {
  limit?: number;
  offset?: number;
} = {}): Promise<(CardSetWithCount & CardSetWithOwner)[]> {
  if (!isSupabaseConfigured()) return [];
  const { limit = 24, offset = 0 } = options;

  try {
    const supabase = await createClient();
    const { data: sets } = await supabase
      .from("card_sets")
      .select("*")
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (!sets || sets.length === 0) return [];

    const [counts, owners] = await Promise.all([
      countCardsForSets(sets.map((s) => s.id)),
      (async () => {
        const ownerIds = Array.from(new Set(sets.map((s) => s.owner_id)));
        const { data } = await supabase
          .from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", ownerIds);
        const byId = new Map<string, CardSetWithOwner["owner"]>();
        for (const row of data ?? []) {
          byId.set(row.id, {
            username: row.username,
            display_name: row.display_name,
            avatar_url: row.avatar_url,
          });
        }
        return byId;
      })(),
    ]);

    return sets.map((row) => ({
      ...narrowSet(row),
      cards_count: counts.get(row.id) ?? 0,
      owner: owners.get(row.owner_id) ?? null,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Single set lookups
// ---------------------------------------------------------------------------

export async function getSetById(id: string): Promise<CardSet | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("card_sets")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return data ? narrowSet(data) : null;
  } catch {
    return null;
  }
}

/**
 * Find a set by slug across all owners. RLS filters non-readable rows.
 * If multiple owners share a slug (slugs are unique per owner), the most
 * recently updated one wins — same first-match convention as cards.
 */
export async function getSetBySlugPublic(
  slug: string,
): Promise<CardSetWithOwner | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data: sets } = await supabase
      .from("card_sets")
      .select("*")
      .eq("slug", slug)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (!sets || sets.length === 0) return null;

    const set = sets[0];
    const { data: ownerRow } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .eq("id", set.owner_id)
      .maybeSingle();

    return {
      ...narrowSet(set),
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

export async function getMySetBySlug(slug: string): Promise<CardSet | null> {
  if (!isSupabaseConfigured()) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("card_sets")
      .select("*")
      .eq("owner_id", user.id)
      .eq("slug", slug)
      .maybeSingle();
    return data ? narrowSet(data) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Items inside a set
// ---------------------------------------------------------------------------

export type SetItem = {
  item_id: string;
  position: number;
  card: Card;
};

export async function listCardsInSet(setId: string): Promise<SetItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data: items } = await supabase
      .from("card_set_items")
      .select("id, position, card_id, created_at")
      .eq("set_id", setId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (!items || items.length === 0) return [];

    const cardIds = items.map((i) => i.card_id);
    const { data: cards } = await supabase
      .from("cards")
      .select("*")
      .in("id", cardIds);
    const cardById = new Map<string, Card>();
    for (const row of cards ?? []) {
      cardById.set(row.id, narrowCard(row));
    }

    return items
      .map((row) => {
        const card = cardById.get(row.card_id);
        if (!card) return null;
        return { item_id: row.id, position: row.position, card };
      })
      .filter((value): value is SetItem => value !== null);
  } catch {
    return [];
  }
}

/**
 * Cards owned by the current user that AREN'T already in the given set.
 * Used by the set editor's "add card" picker.
 */
export async function listMyCardsNotInSet(setId: string): Promise<Card[]> {
  if (!isSupabaseConfigured()) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    const supabase = await createClient();
    const [{ data: items }, { data: myCards }] = await Promise.all([
      supabase.from("card_set_items").select("card_id").eq("set_id", setId),
      supabase
        .from("cards")
        .select("*")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false }),
    ]);

    const inSet = new Set((items ?? []).map((r) => r.card_id));
    return (myCards ?? [])
      .filter((row) => !inSet.has(row.id))
      .map(narrowCard);
  } catch {
    return [];
  }
}

/**
 * For the card editor "Add to set" dropdown: every set owned by the
 * current user, with a flag telling us whether this card is already in it.
 */
export async function listMySetsForCard(cardId: string): Promise<
  Array<CardSetWithCount & { contains_card: boolean }>
> {
  if (!isSupabaseConfigured()) return [];
  const user = await getCurrentUser();
  if (!user) return [];

  try {
    const supabase = await createClient();
    const { data: sets } = await supabase
      .from("card_sets")
      .select("*")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false });
    if (!sets || sets.length === 0) return [];

    const counts = await countCardsForSets(sets.map((s) => s.id));

    const { data: memberships } = await supabase
      .from("card_set_items")
      .select("set_id")
      .eq("card_id", cardId);
    const inSet = new Set((memberships ?? []).map((r) => r.set_id));

    return sets.map((row) => ({
      ...narrowSet(row),
      cards_count: counts.get(row.id) ?? 0,
      contains_card: inSet.has(row.id),
    }));
  } catch {
    return [];
  }
}

/**
 * True if the current user has used the given set slug. Friendlier error
 * surface than waiting for the unique-constraint failure.
 */
export async function isSetSlugTakenForCurrentUser(
  slug: string,
  excludeSetId?: string,
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  const user = await getCurrentUser();
  if (!user) return false;
  try {
    const supabase = await createClient();
    let query = supabase
      .from("card_sets")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("slug", slug);
    if (excludeSetId) {
      query = query.neq("id", excludeSetId);
    }
    const { count } = await query;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}
