import "server-only";

import { revalidatePath, revalidateTag } from "next/cache";
import type { createAdminClient } from "@/lib/supabase/admin";
import { tagHubHref } from "@/lib/content/articles";
import { categoryPath, isArticleCategory } from "@/lib/content/article-categories";
import { ARTICLES_TAG } from "@/lib/content/db-articles";
import { notifyIndexNow } from "@/lib/seo/indexnow";

// ---------------------------------------------------------------------------
// Publishing a composer article — what "it went live" sets off, in ONE place
// for the admin's "Publish now" and the scheduled release
// (/api/cron/publish-articles):
//
//   * the cached reads (ARTICLES_TAG) and every surface that lists guides:
//     /articles (+ its tag hubs and the RSS feed under it), /learn (+ its
//     shelves), the homepage's latest guides, /sitemap.xml and /llms.txt;
//   * IndexNow for the article and the hub pages that now link to it (Bing,
//     and the answer engines that read Bing's index; Google reads the
//     sitemap);
//   * `announced_at`, so the cron announces each release once.
//
// Plain module, not "use server": these are helpers, not endpoints.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

type Announceable = { slug: string; category: string | null; tags: string[] | null };

/** Purge every surface that lists or renders guides. */
export function revalidateArticleSurfaces(slugs: readonly string[] = []): void {
  revalidateTag(ARTICLES_TAG, "max");
  for (const slug of slugs) revalidatePath(`/articles/${slug}`);
  // "layout" = the path and everything under it: every article, the tag
  // hubs, feed.xml; the /learn shelves.
  revalidatePath("/articles", "layout");
  revalidatePath("/learn", "layout");
  revalidatePath("/");
  revalidatePath("/sitemap.xml");
  revalidatePath("/llms.txt");
  revalidatePath("/admin/articles", "layout");
}

/** The public pages a release changes: the article, then the hubs that list
 *  it (its shelf, its tag hubs, the indexes). Site-relative, deduplicated. */
export function articleAnnouncePaths(articles: readonly Announceable[]): string[] {
  const paths = new Set<string>();
  for (const article of articles) {
    paths.add(`/articles/${article.slug}`);
    if (isArticleCategory(article.category)) paths.add(categoryPath(article.category));
    for (const tag of article.tags ?? []) paths.add(tagHubHref(tag));
  }
  if (paths.size > 0) {
    paths.add("/articles");
    paths.add("/learn");
  }
  return [...paths];
}

export type AnnounceResult = { announced: string[]; indexNow: boolean };

/**
 * Announce every released composer article that hasn't been yet
 * (is_published, publish_at <= now(), announced_at null): purge, stamp,
 * IndexNow. Service role (the cron, or an admin action after its own check).
 * Idempotent — a second run finds nothing to announce.
 */
export async function announceDueArticles(
  admin: AdminClient,
  now: Date = new Date(),
): Promise<AnnounceResult> {
  const { data, error } = await admin
    .from("articles")
    .select("id, slug, category, tags")
    .eq("is_published", true)
    .lte("publish_at", now.toISOString())
    .is("announced_at", null)
    .limit(100);
  if (error) throw new Error(error.message);
  const due = (data ?? []) as Array<Announceable & { id: string }>;
  if (due.length === 0) return { announced: [], indexNow: false };

  const { error: stampError } = await admin
    .from("articles")
    .update({ announced_at: now.toISOString() })
    .in(
      "id",
      due.map((row) => row.id),
    )
    .is("announced_at", null);
  if (stampError) throw new Error(stampError.message);

  revalidateArticleSurfaces(due.map((row) => row.slug));
  const indexNow = await notifyIndexNow(articleAnnouncePaths(due));
  return { announced: due.map((row) => row.slug), indexNow };
}
