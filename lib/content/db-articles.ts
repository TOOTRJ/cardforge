import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isArticleCategory } from "@/lib/content/article-categories";
import { drawableMediaUrl } from "@/lib/media/media-urls";
import {
  ARTICLE_COLUMNS,
  ARTICLE_LIST_COLUMNS,
  bodyPlainText,
  wordCount,
  type ArticleFaqItem,
  type ArticleRow,
} from "@/lib/content/article-shared";
import type { Article, ArticleAuthor, ArticleMeta } from "@/lib/content/articles";

// ---------------------------------------------------------------------------
// Composer articles (migration 0160) — the reads.
//
// Public: cookie-free and cached under ARTICLES_TAG, so every article surface
// stays static / ISR. Release is RLS's (is_published AND publish_at <= now()):
// a scheduled row appears once its time passes — at the latest when the
// cache window ends, at once when /api/cron/publish-articles (or an admin's
// "Publish now") purges the tag. Admin: cookie-bound, every row.
//
// Fail-soft like the sitemap: no Supabase, or a read error, is "no composer
// articles" — the MDX guides still render.
// ---------------------------------------------------------------------------

export const ARTICLES_TAG = "articles";

/** How stale a public read may get before it is read again (seconds). */
export const ARTICLES_REVALIDATE_SECONDS = 300;

type AuthorRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  website_url: string | null;
  twitter_url: string | null;
  bluesky_url: string | null;
  instagram_url: string | null;
  youtube_url: string | null;
  github_url: string | null;
};

const AUTHOR_COLUMNS =
  "id, username, display_name, bio, website_url, twitter_url, bluesky_url, instagram_url, youtube_url, github_url";

export type PublishedComposerArticle = { row: ArticleRow; author: ArticleAuthor | null };

/** A list entry: the row WITHOUT its body (the list cache stays small) and
 *  the body's word count, worked out where the body was read. */
type ListedComposerArticle = { row: Omit<ArticleRow, "body">; words: number; author: ArticleAuthor | null };

/** "The table isn't there" — a database 0160 hasn't reached. Postgres says
 *  42P01; PostgREST answers PGRST205 from its schema cache (which is what a
 *  supabase-js read gets). */
export function isMissingArticlesTable(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** A stored FAQ value → the items (anything malformed is dropped). */
export function faqOf(value: unknown): ArticleFaqItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { q: unknown; a: unknown } => typeof item === "object" && item !== null)
    .map((item) => ({ q: String(item.q ?? "").trim(), a: String(item.a ?? "").trim() }))
    .filter((item) => item.q && item.a);
}

export function authorOf(row: AuthorRow | null | undefined): ArticleAuthor | null {
  if (!row?.username) return null;
  const sameAs = [
    row.website_url,
    row.twitter_url,
    row.bluesky_url,
    row.instagram_url,
    row.youtube_url,
    row.github_url,
  ].filter((url): url is string => typeof url === "string" && url.startsWith("https://"));
  return {
    name: row.display_name?.trim() || row.username,
    path: `/profile/${row.username}`,
    bio: row.bio?.trim() || null,
    sameAs,
  };
}

/** A row as the article pages read it (the same shape as an MDX guide).
 *  `words`: the body's count when the body isn't in hand (a list entry). */
export function composerArticle(
  row: Omit<ArticleRow, "body"> & { body?: string },
  author: ArticleAuthor | null,
  words: number = wordCount(bodyPlainText(row.body ?? "")),
): Article {
  const coverSrc = drawableMediaUrl("article-image", row.cover_url);
  const faq = faqOf(row.faq);
  const meta: ArticleMeta = {
    slug: row.slug,
    title: row.title,
    description: row.description,
    // A row only reaches a public surface once released, so publish_at is set.
    date: new Date(row.publish_at ?? row.created_at).toISOString(),
    updated: row.content_updated_at ? new Date(row.content_updated_at).toISOString() : undefined,
    tags: row.tags ?? [],
    category: isArticleCategory(row.category) ? row.category : undefined,
    faq: faq.length > 0 ? faq : undefined,
    seoTitle: row.seo_title ?? undefined,
    excerpt: row.excerpt ?? undefined,
    readingMinutes: Math.max(1, Math.round(words / 220)),
    wordCount: words,
    source: "composer",
    cover:
      coverSrc && row.cover_alt
        ? { src: coverSrc, alt: row.cover_alt, width: row.cover_width, height: row.cover_height }
        : undefined,
    author: author ?? undefined,
  };
  return { meta, content: row.body ?? "" };
}

async function readAuthors(
  supabase: ReturnType<typeof createPublicClient>,
  ids: string[],
): Promise<Map<string, ArticleAuthor>> {
  const authors = new Map<string, ArticleAuthor>();
  if (ids.length === 0) return authors;
  const { data } = await supabase.from("profiles").select(AUTHOR_COLUMNS).in("id", ids);
  for (const row of (data ?? []) as AuthorRow[]) {
    const author = authorOf(row);
    if (author) authors.set(row.id, author);
  }
  return authors;
}

const loadReleased = unstable_cache(
  async (): Promise<ListedComposerArticle[]> => {
    const supabase = createPublicClient();
    // What the cache KEEPS is the list columns and each body's word count
    // (the "N min read" every list prints) — never the bodies: an
    // unstable_cache entry holds 2 MB at most, and 500 bodies of up to
    // 100 000 characters would not fit. The body is read here only to be
    // counted; the page reads its own (loadReleasedBySlug).
    const { data, error } = await supabase
      .from("articles")
      .select(`${ARTICLE_LIST_COLUMNS}, body`)
      .order("publish_at", { ascending: false })
      .limit(500);
    if (error) {
      if (!isMissingArticlesTable(error)) console.warn("[articles] public read failed:", error.message);
      return [];
    }
    const rows = (data ?? []) as unknown as ArticleRow[];
    const authors = await readAuthors(
      supabase,
      [...new Set(rows.map((r) => r.author_id).filter((id): id is string => Boolean(id)))],
    );
    return rows.map(({ body, ...row }) => ({
      row,
      words: wordCount(bodyPlainText(body ?? "")),
      author: row.author_id ? authors.get(row.author_id) ?? null : null,
    }));
  },
  [ARTICLES_TAG, "released-list"],
  { revalidate: ARTICLES_REVALIDATE_SECONDS, tags: [ARTICLES_TAG] },
);

/** One released article WITH its body (the page), cached per slug. */
const loadReleasedBySlug = unstable_cache(
  async (slug: string): Promise<PublishedComposerArticle | null> => {
    const supabase = createPublicClient();
    const { data, error } = await supabase.from("articles").select(ARTICLE_COLUMNS).eq("slug", slug).maybeSingle();
    if (error) {
      if (!isMissingArticlesTable(error)) console.warn("[articles] public read failed:", error.message);
      return null;
    }
    if (!data) return null;
    const row = data as unknown as ArticleRow;
    const authors = await readAuthors(supabase, row.author_id ? [row.author_id] : []);
    return { row, author: row.author_id ? authors.get(row.author_id) ?? null : null };
  },
  [ARTICLES_TAG, "released-one"],
  { revalidate: ARTICLES_REVALIDATE_SECONDS, tags: [ARTICLES_TAG] },
);

/** Every released composer article, newest first (RLS hides the rest) — the
 *  list: `content` is empty (the body is read per article). */
export const listReleasedComposerArticles = cache(async (): Promise<Article[]> => {
  if (!isSupabaseConfigured()) return [];
  try {
    return (await loadReleased()).map(({ row, words, author }) => composerArticle(row, author, words));
  } catch (error) {
    console.warn("[articles] public read threw:", error);
    return [];
  }
});

/** One released composer article with its body (null = none released). */
export const getReleasedComposerArticle = cache(async (slug: string): Promise<Article | null> => {
  if (!isSupabaseConfigured()) return null;
  try {
    const found = await loadReleasedBySlug(slug);
    return found ? composerArticle(found.row, found.author) : null;
  } catch (error) {
    console.warn("[articles] public read threw:", error);
    return null;
  }
});

// ---------------------------------------------------------------------------
// Admin reads (cookie-bound; RLS's admin policy shows every row)
// ---------------------------------------------------------------------------

export async function listArticlesForAdmin(): Promise<ArticleRow[]> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("articles")
    .select(ARTICLE_COLUMNS)
    .order("publish_at", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ArticleRow[]).map((row) => ({ ...row, faq: faqOf(row.faq) }));
}

export async function getArticleForAdmin(id: string): Promise<ArticleRow | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("articles").select(ARTICLE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as unknown as ArticleRow;
  return { ...row, faq: faqOf(row.faq) };
}

/** The admin profiles an article may be bylined to (the author picker). */
export async function listAuthorOptions(): Promise<Array<{ id: string; label: string }>> {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_list_article_authors");
  return ((data ?? []) as Array<{ id: string; username: string | null; display_name: string | null }>)
    .filter((row) => row.username)
    .map((row) => ({ id: row.id, label: row.display_name ? `${row.display_name} (@${row.username})` : `@${row.username}` }));
}

/** The byline preview for one author id (the admin preview page). */
export async function getAuthor(id: string | null): Promise<ArticleAuthor | null> {
  if (!id || !isSupabaseConfigured()) return null;
  const supabase = createPublicClient();
  const { data } = await supabase.from("profiles").select(AUTHOR_COLUMNS).eq("id", id).maybeSingle();
  return authorOf(data as AuthorRow | null);
}
