import "server-only";

import { listArticles } from "@/lib/content/articles";
import { listPublishedArticles } from "@/lib/content/article-catalog";
import { articleSeoChecklist, blockingItems } from "@/lib/content/article-seo-checklist";
import { articleBodyCompileError } from "@/lib/content/article-body";
import { faqOf } from "@/lib/content/db-articles";
import type { ArticleRow } from "@/lib/content/article-shared";

// ---------------------------------------------------------------------------
// The ONE gate an article passes before it may be (or stay) public: the SEO
// checklist's ERRORS and a compile of the body with the composer's options
// (the body guard). Every path that releases one runs it on the row as it
// will be stored — schedule, publish now, an edit of a scheduled or live
// article (lib/content/article-actions.ts) and the scheduled release itself
// (announceDueArticles, lib/content/article-publish.ts), which holds back a
// due row that fails it.
// ---------------------------------------------------------------------------

export type ReleaseGateRow = Pick<
  ArticleRow,
  | "slug"
  | "title"
  | "seo_title"
  | "description"
  | "body"
  | "tags"
  | "category"
  | "faq"
  | "cover_url"
  | "cover_alt"
  | "author_id"
>;

/** Why the row can't go out, as one sentence (null = it may). */
export async function articleReleaseBlock(row: ReleaseGateRow): Promise<string | null> {
  const fileSlugs = listArticles().map((a) => a.slug);
  const known = (await listPublishedArticles()).map((a) => a.slug);
  const items = articleSeoChecklist(
    {
      slug: row.slug,
      title: row.title,
      seoTitle: row.seo_title,
      description: row.description,
      body: row.body,
      tags: row.tags ?? [],
      category: row.category,
      faq: faqOf(row.faq),
      coverUrl: row.cover_url,
      coverAlt: row.cover_alt,
      authorId: row.author_id,
    },
    { fileSlugs, knownSlugs: known },
  );
  const blocking = blockingItems(items);
  if (blocking.length > 0) {
    return `Fix before publishing: ${blocking.map((item) => item.label.toLowerCase()).join("; ")}.`;
  }
  // The checklist's body item reads the same rule; the compile is the proof
  // (what the page will run), so a body it can't draw never goes out.
  const compileError = await articleBodyCompileError(row.body);
  if (compileError) return `Fix before publishing: the body doesn't compile — ${compileError.slice(0, 400)}`;
  return null;
}
