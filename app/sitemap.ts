import "server-only";

import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Sitemap
//
// Three layers, in priority order:
//
//   1. Static product pages (home, /preview, /gallery, /mtg-card-maker, etc.)
//   2. Dynamic per-card pages — every public card with a username-resolved
//      owner (the indexable canonical URLs).
//
// Deliberately NO query-string URLs (e.g. /gallery?color=…&rarity=…):
// Next's sitemap serializer does not XML-escape, so a raw "&" produces an
// invalid document Google Search Console rejects — and the gallery filters
// declare canonical=/gallery anyway, making them non-canonical duplicates a
// sitemap shouldn't list. Every URL here must stay query-free; card slugs
// and usernames are validation-constrained to XML-safe characters.
//
// Fail-soft: if Supabase isn't configured or the queries error, we still
// return the static layer. We don't want a transient DB hiccup to drop the
// entire sitemap.
// ---------------------------------------------------------------------------

const MAX_DYNAMIC_CARDS = 5000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteBaseUrl();
  const lastModified = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/mtg-card-maker`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.95,
    },
    {
      url: `${baseUrl}/ai-mtg-card-generator`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/mana-pip-editor`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/preview`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.85,
    },
    {
      url: `${baseUrl}/gallery`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/challenges`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/about`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/disclaimer`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/login`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${baseUrl}/signup`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];

  const [dynamicCards, challengePages] = await Promise.all([
    fetchPublicCardEntries(baseUrl),
    fetchChallengeEntries(baseUrl),
  ]);

  return [...staticPages, ...challengePages, ...dynamicCards];
}

// ---------------------------------------------------------------------------
// DB read — gathered in a single batch query so we don't fan out per row.
// ---------------------------------------------------------------------------

async function fetchPublicCardEntries(
  baseUrl: string,
): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];

  try {
    const supabase = await createClient();
    const { data: cards } = await supabase
      .from("cards")
      .select("slug, owner_id, updated_at, visibility")
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .limit(MAX_DYNAMIC_CARDS);

    if (!cards || cards.length === 0) return [];

    const ownerIds = Array.from(new Set(cards.map((c) => c.owner_id)));
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", ownerIds);

    const usernameById = new Map<string, string>();
    for (const profile of profiles ?? []) {
      if (profile.username) usernameById.set(profile.id, profile.username);
    }

    const entries: MetadataRoute.Sitemap = [];
    for (const card of cards) {
      const username = usernameById.get(card.owner_id);
      // Cards owned by profiles without a username aren't reachable via the
      // canonical /card/[username]/[slug] URL, so they're omitted entirely.
      if (!username) continue;
      entries.push({
        url: `${baseUrl}/card/${username}/${card.slug}`,
        lastModified: new Date(card.updated_at),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
    return entries;
  } catch {
    return [];
  }
}

async function fetchChallengeEntries(
  baseUrl: string,
): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("challenges")
      .select("slug, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    return (data ?? []).map((c) => ({
      url: `${baseUrl}/challenges/${c.slug}`,
      lastModified: new Date(c.created_at),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    return [];
  }
}
