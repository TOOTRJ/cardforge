import "server-only";

import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import type { createAdminClient } from "@/lib/supabase/admin";
import { tagHubHref } from "@/lib/content/articles";
import { categoryPath, isArticleCategory } from "@/lib/content/article-categories";
import { ARTICLES_TAG } from "@/lib/content/db-articles";
import { ARTICLE_COLUMNS, type ArticleRow } from "@/lib/content/article-shared";
import { articleReleaseBlock } from "@/lib/content/article-release-gate";
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
// The purge EXPIRES the cached reads — never `revalidateTag(tag, "max")`,
// which is stale-while-revalidate and served the article as it was (an
// unpublished or deleted one stayed up; lib/cards/frame-profile-override-
// actions.ts and lib/cards/cache-purge.ts document the same trap): a server
// action uses `updateTag` (read-your-own-writes), the cron route
// `revalidateTag(tag, { expire: 0 })` (updateTag is for actions only).
// IndexNow is told only AFTER the purge, so a crawler it sends reads the new
// page.
//
// Plain module, not "use server": these are helpers, not endpoints.
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

type Announceable = { slug: string; category: string | null; tags: string[] | null };

/** Purge every surface that lists or renders guides. `from`: a server
 *  action ("action", updateTag) or a route handler ("route", an immediate
 *  expiry) — Next allows updateTag in a server action only. */
export function revalidateArticleSurfaces(slugs: readonly string[] = [], from: "action" | "route" = "action"): void {
  if (from === "action") updateTag(ARTICLES_TAG);
  else revalidateTag(ARTICLES_TAG, { expire: 0 });
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

export type HeldBackArticle = { slug: string; reason: string };
export type AnnounceResult = { announced: string[]; heldBack: HeldBackArticle[]; indexNow: boolean };

/**
 * Announce every released composer article that hasn't been yet
 * (is_published, publish_at <= now(), announced_at null): gate, purge, stamp,
 * IndexNow. Service role (the cron route). Idempotent — a second run finds
 * nothing to announce.
 *
 * Each due row passes the release gate first (articleReleaseBlock: the
 * checklist's errors and the body's compile). One that fails is HELD BACK —
 * put back to a draft (is_published false: RLS already showed it once its
 * time passed, so leaving it scheduled would keep it public) and logged with
 * the reason; the composer then shows it as a draft with the same list.
 */
export async function announceDueArticles(
  admin: AdminClient,
  now: Date = new Date(),
): Promise<AnnounceResult> {
  const { data, error } = await admin
    .from("articles")
    .select(ARTICLE_COLUMNS)
    .eq("is_published", true)
    .lte("publish_at", now.toISOString())
    .is("announced_at", null)
    .limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as ArticleRow[];
  if (rows.length === 0) return { announced: [], heldBack: [], indexNow: false };

  const due: ArticleRow[] = [];
  const heldBack: Array<HeldBackArticle & { id: string }> = [];
  for (const row of rows) {
    const reason = await articleReleaseBlock(row);
    if (reason) heldBack.push({ id: row.id, slug: row.slug, reason });
    else due.push(row);
  }

  if (heldBack.length > 0) {
    for (const held of heldBack) {
      console.warn(`[articles] held back /articles/${held.slug} (back to a draft): ${held.reason}`);
    }
    const { error: holdError } = await admin
      .from("articles")
      .update({ is_published: false, updated_at: now.toISOString() })
      .in(
        "id",
        heldBack.map((row) => row.id),
      )
      .is("announced_at", null);
    if (holdError) throw new Error(holdError.message);
  }

  if (due.length > 0) {
    const { error: stampError } = await admin
      .from("articles")
      .update({ announced_at: now.toISOString() })
      .in(
        "id",
        due.map((row) => row.id),
      )
      .is("announced_at", null);
    if (stampError) throw new Error(stampError.message);
  }

  // The purge first (a held-back row may already sit in a cached list), and
  // only then IndexNow — for the rows that went out.
  revalidateArticleSurfaces([...due, ...heldBack].map((row) => row.slug), "route");
  const indexNow = due.length > 0 ? await notifyIndexNow(articleAnnouncePaths(due)) : false;
  return {
    announced: due.map((row) => row.slug),
    heldBack: heldBack.map(({ slug, reason }) => ({ slug, reason })),
    indexNow,
  };
}
