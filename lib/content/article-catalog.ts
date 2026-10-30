import "server-only";

import {
  articlesByTagOf,
  getArticle,
  listArticles,
  relatedOf,
  shelvesOf,
  tagsOf,
  type Article,
  type ArticleMeta,
  type CategoryShelf,
  type TagInfo,
} from "@/lib/content/articles";
import type { ArticleCategorySlug } from "@/lib/content/article-categories";
import { listReleasedComposerArticles } from "@/lib/content/db-articles";

// ---------------------------------------------------------------------------
// The site's ONE list of guides: the MDX files in content/articles/ JOINED by
// the released composer articles (migration 0153). Every public article
// surface reads it — /articles and its tag hubs, /learn and its shelves, the
// homepage's latest guides, the sitemap, /llms.txt and the RSS feed — so a
// scheduled article lands on all of them at once.
//
// A file wins a slug clash (the composer refuses a file's slug, but a guide
// added to git later could take one): its URL, its frontmatter and its tests
// are the established page.
// ---------------------------------------------------------------------------

/** Files and released composer articles, newest first. */
export async function listPublishedArticles(): Promise<ArticleMeta[]> {
  const files = listArticles();
  const taken = new Set(files.map((a) => a.slug));
  const composed = (await listReleasedComposerArticles())
    .map((a) => a.meta)
    .filter((meta) => !taken.has(meta.slug));
  // Files keep their own order on a tie (a stable sort with a comparator that
  // answers 0 for equal dates).
  return [...files, ...composed].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/** One guide by slug — a file first, else a released composer article. */
export async function getPublishedArticle(slug: string): Promise<Article | null> {
  const file = getArticle(slug);
  if (file) return file;
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  return (await listReleasedComposerArticles()).find((a) => a.meta.slug === slug) ?? null;
}

export async function listPublishedCategoryShelves(): Promise<CategoryShelf[]> {
  return shelvesOf(await listPublishedArticles());
}

export async function listPublishedArticlesInCategory(slug: ArticleCategorySlug): Promise<ArticleMeta[]> {
  return (await listPublishedArticles()).filter((article) => article.category === slug);
}

export async function listPublishedTags(): Promise<TagInfo[]> {
  return tagsOf(await listPublishedArticles());
}

export async function getPublishedArticlesByTag(
  tagSlug: string,
): Promise<{ label: string; articles: ArticleMeta[] } | null> {
  return articlesByTagOf(await listPublishedArticles(), tagSlug);
}

export async function getPublishedRelatedArticles(slug: string, limit = 3): Promise<ArticleMeta[]> {
  return relatedOf(await listPublishedArticles(), slug, limit);
}
