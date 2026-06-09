import "server-only";

import { createClient, getCurrentUser } from "@/lib/supabase/server";

// All reads go through the user's RLS-scoped session, so a user only ever sees
// their own notifications. actor/card are FK'd to auth.users/cards (no direct
// profiles FK), so we stitch in the actor + card-owner profiles by hand.

export type NotificationItem = {
  id: string;
  type: string;
  createdAt: string;
  readAt: string | null;
  actor: {
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  } | null;
  card: { slug: string; title: string; ownerUsername: string | null } | null;
};

export async function getUnreadNotificationCount(): Promise<number> {
  const user = await getCurrentUser();
  if (!user) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  return count ?? 0;
}

export async function listNotifications(limit = 30): Promise<NotificationItem[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("notifications")
    .select("id, type, created_at, read_at, actor_id, card_id")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!rows || rows.length === 0) return [];

  const cardIds = [
    ...new Set(rows.map((r) => r.card_id).filter(Boolean)),
  ] as string[];
  const actorIds = [
    ...new Set(rows.map((r) => r.actor_id).filter(Boolean)),
  ] as string[];

  const cardsById = new Map<
    string,
    { slug: string; title: string; owner_id: string }
  >();
  if (cardIds.length) {
    const { data: cards } = await supabase
      .from("cards")
      .select("id, slug, title, owner_id")
      .in("id", cardIds);
    for (const c of cards ?? []) {
      cardsById.set(c.id, { slug: c.slug, title: c.title, owner_id: c.owner_id });
    }
  }

  const ownerIds = [...cardsById.values()].map((c) => c.owner_id);
  const profileIds = [...new Set([...actorIds, ...ownerIds])];
  const profilesById = new Map<
    string,
    { username: string | null; display_name: string | null; avatar_url: string | null }
  >();
  if (profileIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", profileIds);
    for (const p of profiles ?? []) {
      profilesById.set(p.id, {
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
      });
    }
  }

  return rows.map((r) => {
    const card = r.card_id ? cardsById.get(r.card_id) : undefined;
    const owner = card ? profilesById.get(card.owner_id) : undefined;
    const actor = r.actor_id ? profilesById.get(r.actor_id) : undefined;
    return {
      id: r.id,
      type: r.type,
      createdAt: r.created_at,
      readAt: r.read_at,
      actor: actor
        ? {
            username: actor.username,
            displayName: actor.display_name,
            avatarUrl: actor.avatar_url,
          }
        : null,
      card: card
        ? { slug: card.slug, title: card.title, ownerUsername: owner?.username ?? null }
        : null,
    };
  });
}
