import "server-only";

import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/lib/auth/schemas";

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
  /** The creator's filled-in social profiles, in SOCIAL_PLATFORMS order. */
  socials: { key: SocialPlatformKey; label: string; url: string }[];
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
      "id, username, display_name, avatar_url, banner_url, accent_color, bio, pinned_card_ids, twitter_url, bluesky_url, instagram_url, youtube_url, tiktok_url, discord_url, github_url",
    )
    .not("featured_at", "is", null)
    .not("username", "is", null)
    .order("featured_at", { ascending: false })
    .limit(limit);
  if (!profiles || profiles.length === 0) return [];

  // Showcase cards for ALL creators in two batched queries (was a per-creator
  // N+1 loop): pinned first, padded with each creator's most-liked public
  // cards so the banner never renders empty.
  const profileIds = profiles.map((p) => p.id);
  const allPinnedIds = profiles.flatMap((p) =>
    (p.pinned_card_ids ?? []).slice(0, 3),
  );

  const [pinnedRes, fallbackRes] = await Promise.all([
    allPinnedIds.length > 0
      ? supabase
          .from("cards")
          .select("id, slug, title, rendered_image_url, owner_id")
          .in("id", allPinnedIds)
          .eq("visibility", "public")
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("cards")
      .select("slug, title, rendered_image_url, owner_id")
      .in("owner_id", profileIds)
      .eq("visibility", "public")
      .not("rendered_image_url", "is", null)
      .order("likes_count", { ascending: false })
      // Enough per creator to pad to 3 even when all pinned rows also
      // appear in the fallback window.
      .limit(profiles.length * 8),
  ]);

  const pinnedById = new Map(
    (pinnedRes.data ?? []).map((c) => [c.id as string, c]),
  );
  const fallbackByOwner = new Map<string, typeof fallbackRes.data>();
  for (const c of fallbackRes.data ?? []) {
    const list = fallbackByOwner.get(c.owner_id as string) ?? [];
    list.push(c);
    fallbackByOwner.set(c.owner_id as string, list);
  }

  const out: FeaturedCreator[] = [];
  for (const p of profiles) {
    const pinned = (p.pinned_card_ids ?? []).slice(0, 3);
    const cards: { slug: string; title: string; imageUrl: string }[] = pinned
      .map((id: string) => pinnedById.get(id))
      .filter((c): c is NonNullable<typeof c> =>
        Boolean(c?.rendered_image_url),
      )
      .map((c) => ({
        slug: c.slug,
        title: c.title,
        imageUrl: c.rendered_image_url as string,
      }));

    for (const c of fallbackByOwner.get(p.id) ?? []) {
      if (cards.length >= 3) break;
      if (cards.some((x) => x.slug === c.slug)) continue;
      cards.push({
        slug: c.slug,
        title: c.title,
        imageUrl: c.rendered_image_url as string,
      });
    }

    out.push({
      username: p.username as string,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      bannerUrl: p.banner_url,
      accentColor: p.accent_color,
      bio: p.bio,
      socials: SOCIAL_PLATFORMS.flatMap((platform) => {
        const url = p[platform.key];
        return url ? [{ key: platform.key, label: platform.label, url }] : [];
      }),
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
