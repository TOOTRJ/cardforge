import "server-only";

import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Featured creators — admin-curated via profiles.featured_at (0052). Reads
// are viewer-independent (public client, no cookies) so the gallery and
// challenges pages keep their static/ISR rendering.
// ---------------------------------------------------------------------------

export type FeaturedCreator = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  accentColor: string | null;
  bio: string | null;
  cards: { slug: string; title: string; imageUrl: string }[];
};

export async function listFeaturedCreators(
  limit = 2,
): Promise<FeaturedCreator[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = createPublicClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select(
      "id, username, display_name, avatar_url, banner_url, accent_color, bio, pinned_card_ids",
    )
    .not("featured_at", "is", null)
    .not("username", "is", null)
    .order("featured_at", { ascending: false })
    .limit(limit);
  if (!profiles || profiles.length === 0) return [];

  // One query for everyone's showcase cards: pinned first, padded with the
  // creator's most-liked public cards so the banner never renders empty.
  const out: FeaturedCreator[] = [];
  for (const p of profiles) {
    const pinned = (p.pinned_card_ids ?? []).slice(0, 3);
    let cards: { slug: string; title: string; imageUrl: string }[] = [];

    if (pinned.length > 0) {
      const { data } = await supabase
        .from("cards")
        .select("id, slug, title, rendered_image_url")
        .in("id", pinned)
        .eq("visibility", "public");
      const byId = new Map((data ?? []).map((c) => [c.id, c]));
      cards = pinned
        .map((id: string) => byId.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c?.rendered_image_url))
        .map((c) => ({
          slug: c.slug,
          title: c.title,
          imageUrl: c.rendered_image_url as string,
        }));
    }
    if (cards.length < 3) {
      const { data } = await supabase
        .from("cards")
        .select("slug, title, rendered_image_url")
        .eq("owner_id", p.id)
        .eq("visibility", "public")
        .not("rendered_image_url", "is", null)
        .order("likes_count", { ascending: false })
        .limit(3 - cards.length + 3);
      for (const c of data ?? []) {
        if (cards.length >= 3) break;
        if (cards.some((x) => x.slug === c.slug)) continue;
        cards.push({
          slug: c.slug,
          title: c.title,
          imageUrl: c.rendered_image_url as string,
        });
      }
    }

    out.push({
      username: p.username as string,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      bannerUrl: p.banner_url,
      accentColor: p.accent_color,
      bio: p.bio,
      cards,
    });
  }
  return out;
}

export type FeaturedHomeCard = {
  slot: number;
  slug: string;
  title: string;
  imageUrl: string;
  owner: { username: string; displayName: string | null };
};

/** The admin-curated homepage hero cards (0053). Public-client read keeps
 *  the homepage static; a featured card that later goes non-public (or
 *  loses its render) silently drops out — the hero falls back to the
 *  placeholder pair. */
export async function listFeaturedHomeCards(): Promise<FeaturedHomeCard[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("featured_cards")
    .select(
      "slot, cards(slug, title, visibility, rendered_image_url, owner_id)",
    )
    .order("slot", { ascending: true });
  if (!data || data.length === 0) return [];

  const rows = data
    .map((r) => ({ slot: r.slot, card: r.cards as unknown as {
      slug: string;
      title: string;
      visibility: string;
      rendered_image_url: string | null;
      owner_id: string;
    } | null }))
    .filter(
      (r) =>
        r.card &&
        r.card.visibility === "public" &&
        Boolean(r.card.rendered_image_url),
    ) as { slot: number; card: NonNullable<{
      slug: string;
      title: string;
      visibility: string;
      rendered_image_url: string | null;
      owner_id: string;
    }> }[];
  if (rows.length === 0) return [];

  const ownerIds = [...new Set(rows.map((r) => r.card.owner_id))];
  const { data: owners } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .in("id", ownerIds);
  const byId = new Map((owners ?? []).map((o) => [o.id, o]));

  return rows
    .map((r) => {
      const owner = byId.get(r.card.owner_id);
      if (!owner?.username) return null;
      return {
        slot: r.slot,
        slug: r.card.slug,
        title: r.card.title,
        imageUrl: r.card.rendered_image_url as string,
        owner: { username: owner.username, displayName: owner.display_name },
      };
    })
    .filter((r): r is FeaturedHomeCard => r !== null);
}
