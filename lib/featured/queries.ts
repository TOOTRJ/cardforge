import "server-only";

import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/lib/auth/schemas";
import { isLandscapeFrame } from "@/lib/cards/card-orientation";
import { isStoredRenderUrl } from "@/lib/cards/render-cdn";
import { profileMediaSrc } from "@/lib/media/media-urls";
import { dailyHeroPair } from "@/lib/featured/hero-rotation";

// ---------------------------------------------------------------------------
// Featured creators — admin-curated via profiles.featured_at (0052). Reads
// are viewer-independent (public client, no cookies) so the gallery and
// challenges pages keep their static/ISR rendering.
// ---------------------------------------------------------------------------

/** A featured card's tile image: its WebP thumb, else its HD PNG — and only a
 *  bake in our card-renders bucket (lib/cards/render-cdn.ts). These tiles are
 *  raw <img>s on the homepage, gallery and challenges pages; a row written
 *  before migration 0126 (when an owner could PATCH the render columns) could
 *  point anywhere. null = the card has no drawable render and is skipped. */
export function featuredImageOf(card: {
  rendered_image_url: string | null;
  rendered_thumb_url?: string | null;
}): string | null {
  if (isStoredRenderUrl(card.rendered_thumb_url)) return card.rendered_thumb_url;
  if (isStoredRenderUrl(card.rendered_image_url)) return card.rendered_image_url;
  return null;
}

/** A showcase card's baked image. `landscape` (a 7:5 Battle/Split render)
 *  picks the card corner class — a 5:7 radius on a 7:5 image is an ellipse. */
export type FeaturedCardImage = {
  slug: string;
  title: string;
  imageUrl: string;
  landscape: boolean;
};

export type FeaturedCreator = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  accentColor: string | null;
  bio: string | null;
  /** The creator's filled-in social profiles, in SOCIAL_PLATFORMS order. */
  socials: { key: SocialPlatformKey; label: string; url: string }[];
  cards: FeaturedCardImage[];
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
          .select("id, slug, title, frame_style, rendered_image_url, rendered_thumb_url, owner_id")
          .in("id", allPinnedIds)
          .eq("visibility", "public")
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("cards")
      .select("slug, title, frame_style, rendered_image_url, rendered_thumb_url, owner_id")
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
    const cards: FeaturedCardImage[] = pinned
      .map((id: string) => pinnedById.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c && featuredImageOf(c)))
      .map((c) => ({
        slug: c.slug,
        title: c.title,
        imageUrl: featuredImageOf(c) as string,
        landscape: isLandscapeFrame(c.frame_style),
      }));

    for (const c of fallbackByOwner.get(p.id) ?? []) {
      if (cards.length >= 3) break;
      if (cards.some((x) => x.slug === c.slug)) continue;
      const imageUrl = featuredImageOf(c);
      if (!imageUrl) continue;
      cards.push({
        slug: c.slug,
        title: c.title,
        imageUrl,
        landscape: isLandscapeFrame(c.frame_style),
      });
    }

    out.push({
      username: p.username as string,
      displayName: p.display_name,
      // Only drawable profile pictures (migration 0127, lib/media/media-urls.ts).
      avatarUrl: profileMediaSrc("avatar", p.avatar_url, p.id),
      bannerUrl: profileMediaSrc("banner", p.banner_url, p.id),
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
  slug: string;
  title: string;
  imageUrl: string;
  /** A 7:5 (Battle/Split) render — see FeaturedCardImage. */
  landscape: boolean;
  owner: { username: string; displayName: string | null };
};

/** The home page hero's cards for the UTC day `now` falls in (TODO HM4,
 *  migration 0169; by key since 0196): home_hero_pool() hands the pool's cards the hero can
 *  draw (public, baked) and the fallback slots' that pass the original-card
 *  guard after them; dailyHeroPair re-sorts them by (source, ord) — never
 *  trusting the transport's order — and picks the day's two. Public-client
 *  read keeps the page ISR; a card with no drawable bake drops out, and an
 *  empty answer is the placeholder pair. */
export async function listFeaturedHomeCards(now: Date = new Date()): Promise<FeaturedHomeCard[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("home_hero_pool");
  if (error) {
    console.warn("listFeaturedHomeCards: home_hero_pool failed", error.message);
    return [];
  }
  const rows = (data ?? [])
    .map((r) => ({ ...r, id: r.card_id, imageUrl: featuredImageOf(r) }))
    .filter((r): r is typeof r & { imageUrl: string } => Boolean(r.imageUrl));
  return dailyHeroPair(rows, now).map((r) => ({
    slug: r.slug,
    title: r.title,
    imageUrl: r.imageUrl,
    landscape: isLandscapeFrame(r.frame_style),
    owner: { username: r.username, displayName: r.display_name },
  }));
}
