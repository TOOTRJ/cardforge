import "server-only";

import type { MetadataRoute } from "next";
import { getSiteBaseUrl } from "@/lib/site-url";
import { listArticles, listTags } from "@/lib/content/articles";
import { getCluster } from "@/lib/content/clusters";
import { createPublicClient } from "@/lib/supabase/public";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isBillingEnabled } from "@/lib/billing/flags";

// ---------------------------------------------------------------------------
// Sitemap
//
// Layers, in priority order:
//
//   1. Static product pages (home, the tool landing pages, /create, /gallery,
//      /decks, /challenges, /news, guides + their indexable topic hubs, …).
//      They carry NO lastModified: stamping "now" on every hourly rebuild
//      taught crawlers the date was noise and made them ignore the real
//      ones on cards and guides.
//   2. Dynamic pages — only what is indexable: public cards whose owner has a
//      username (the canonical /card/[username]/[slug] URLs), profiles with
//      at least one public card, public decks with at least one entry, and
//      challenges. A public page that the app itself marks noindex (thin
//      profile, empty deck, unlisted anything) never appears here.
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

// All reads are viewer-independent public rows, so they use the cookie-free
// public client — cookies would force the route dynamic, regenerating the
// whole sitemap on every crawler hit. ISR instead: rebuilt at most hourly.
export const revalidate = 3600;

const MAX_DYNAMIC_CARDS = 5000;
const MAX_DYNAMIC_DECKS = 500;
const MAX_CHALLENGES = 100;
const OWNER_LOOKUP_CHUNK = 200;

type Entry = MetadataRoute.Sitemap[number];
type Frequency = NonNullable<Entry["changeFrequency"]>;

function staticEntry(
  baseUrl: string,
  path: string,
  changeFrequency: Frequency,
  priority: number,
): Entry {
  return { url: `${baseUrl}${path}`, changeFrequency, priority };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteBaseUrl();

  const staticPages: MetadataRoute.Sitemap = [
    staticEntry(baseUrl, "/", "weekly", 1),
    staticEntry(baseUrl, "/mtg-card-maker", "monthly", 0.95),
    staticEntry(baseUrl, "/ai-mtg-card-generator", "monthly", 0.9),
    staticEntry(baseUrl, "/mana-pip-editor", "monthly", 0.9),
    staticEntry(baseUrl, "/best-mtg-card-makers", "monthly", 0.9),
    // The guest creator is a real, self-canonical landing page (ISR, cookie-
    // free) — it belongs here AND must stay crawlable in robots.ts.
    staticEntry(baseUrl, "/create", "monthly", 0.85),
    staticEntry(baseUrl, "/gallery", "daily", 0.9),
    staticEntry(baseUrl, "/decks", "daily", 0.8),
    staticEntry(baseUrl, "/challenges", "weekly", 0.8),
    staticEntry(baseUrl, "/faq", "monthly", 0.85),
    staticEntry(baseUrl, "/articles", "weekly", 0.85),
    // The guides themselves — read straight from content/articles/ so a new
    // MDX file lands in the sitemap on the same deploy. These DO carry a
    // date: it's the frontmatter's, not the build's.
    ...listArticles().map(
      (article): Entry => ({
        url: `${baseUrl}/articles/${article.slug}`,
        lastModified: new Date(article.updated ?? article.date),
        changeFrequency: "monthly",
        priority: 0.8,
      }),
    ),
    // Tag/cluster hubs — the substantive topic pages (defined clusters or any
    // tag with 2+ guides). One-off single-article tags are noindex, so they're
    // kept out of the sitemap too. Tag slugs are [a-z0-9-] only, so XML-safe.
    ...listTags()
      .filter((tag) => getCluster(tag.slug) !== null || tag.count >= 2)
      .map((tag) => staticEntry(baseUrl, `/articles/tag/${tag.slug}`, "weekly", 0.7)),
    staticEntry(baseUrl, "/news", "weekly", 0.6),
    // /pricing calls notFound() while billing is off — never advertise a 404.
    ...(isBillingEnabled() ? [staticEntry(baseUrl, "/pricing", "monthly", 0.8)] : []),
    staticEntry(baseUrl, "/about", "monthly", 0.5),
    staticEntry(baseUrl, "/press", "monthly", 0.3),
    staticEntry(baseUrl, "/disclaimer", "monthly", 0.3),
    staticEntry(baseUrl, "/terms", "monthly", 0.3),
    staticEntry(baseUrl, "/privacy", "monthly", 0.3),
    staticEntry(baseUrl, "/login", "yearly", 0.2),
    staticEntry(baseUrl, "/signup", "yearly", 0.2),
  ];

  const [{ cards, profiles }, challengePages, deckPages] = await Promise.all([
    fetchCardAndProfileEntries(baseUrl),
    fetchChallengeEntries(baseUrl),
    fetchPublicDeckEntries(baseUrl),
  ]);

  return [...staticPages, ...challengePages, ...deckPages, ...profiles, ...cards];
}

// ---------------------------------------------------------------------------
// DB reads — gathered in batch queries so we don't fan out per row.
// ---------------------------------------------------------------------------

/** Public cards + the profiles that own at least one of them. One card scan
 *  feeds both layers: a profile's freshness is its newest public card. */
async function fetchCardAndProfileEntries(
  baseUrl: string,
): Promise<{ cards: MetadataRoute.Sitemap; profiles: MetadataRoute.Sitemap }> {
  const empty = { cards: [], profiles: [] };
  if (!isSupabaseConfigured()) return empty;

  try {
    const supabase = createPublicClient();
    const { data: rows } = await supabase
      .from("cards")
      .select("slug, owner_id, updated_at, visibility")
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .limit(MAX_DYNAMIC_CARDS);

    if (!rows || rows.length === 0) return empty;

    // Chunked owner lookup: one `.in()` over up to 5,000 ids is a URL-length
    // gamble on PostgREST, and its error used to be thrown away — every card
    // URL then silently vanished from the sitemap. A failed chunk is logged
    // and only its cards are skipped.
    const ownerIds = Array.from(new Set(rows.map((c) => c.owner_id)));
    const usernameById = new Map<string, string>();
    for (let i = 0; i < ownerIds.length; i += OWNER_LOOKUP_CHUNK) {
      const chunk = ownerIds.slice(i, i + OWNER_LOOKUP_CHUNK);
      const { data: owners, error } = await supabase
        .from("profiles")
        .select("id, username")
        .in("id", chunk);
      if (error) {
        console.error(`[sitemap] owner lookup failed for ${chunk.length} ids: ${error.message}`);
        continue;
      }
      for (const owner of owners ?? []) {
        if (owner.username) usernameById.set(owner.id, owner.username);
      }
    }

    const cards: MetadataRoute.Sitemap = [];
    const newestByOwner = new Map<string, Date>(); // rows arrive newest-first
    for (const card of rows) {
      const username = usernameById.get(card.owner_id);
      // Cards owned by profiles without a username aren't reachable via the
      // canonical /card/[username]/[slug] URL, so they're omitted entirely.
      if (!username) continue;
      const updated = new Date(card.updated_at);
      cards.push({
        url: `${baseUrl}/card/${username}/${card.slug}`,
        lastModified: updated,
        changeFrequency: "weekly",
        priority: 0.7,
      });
      if (!newestByOwner.has(username)) newestByOwner.set(username, updated);
    }

    // Profiles earn a sitemap slot by publishing: a handle-only profile is
    // noindex on its own page (app/(marketing)/profile/[username]/page.tsx),
    // so listing it would only advertise a page we ask crawlers to skip.
    const profiles: MetadataRoute.Sitemap = [...newestByOwner].map(
      ([username, updated]) => ({
        url: `${baseUrl}/profile/${username}`,
        lastModified: updated,
        changeFrequency: "weekly",
        priority: 0.5,
      }),
    );
    return { cards, profiles };
  } catch {
    return empty;
  }
}

async function fetchChallengeEntries(
  baseUrl: string,
): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("challenges")
      .select("slug, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_CHALLENGES);
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

type DeckSitemapRow = {
  slug: string;
  updated_at: string;
  deck_cards: { count: number }[] | null;
};

async function fetchPublicDeckEntries(
  baseUrl: string,
): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = createPublicClient();
    // deck_cards(count) is PostgREST's embedded aggregate — one round trip
    // for the entry counts that decide indexability (an empty deck page is
    // noindex, see app/(marketing)/deck/[slug]/page.tsx).
    const { data } = await supabase
      .from("decks")
      .select("slug, updated_at, deck_cards(count)")
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .limit(MAX_DYNAMIC_DECKS);
    const rows = (data ?? []) as unknown as DeckSitemapRow[];
    return rows
      .filter((d) => (d.deck_cards?.[0]?.count ?? 0) > 0)
      .map((d) => ({
        url: `${baseUrl}/deck/${d.slug}`,
        lastModified: new Date(d.updated_at),
        changeFrequency: "weekly" as const,
        priority: 0.6,
      }));
  } catch {
    return [];
  }
}
