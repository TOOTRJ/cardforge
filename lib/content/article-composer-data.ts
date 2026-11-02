import "server-only";

import { listArticles } from "@/lib/content/articles";
import { listArticlesForAdmin, listAuthorOptions } from "@/lib/content/db-articles";
import { articleStatus, nextOpenSlot, type ArticleRow } from "@/lib/content/article-shared";

// ---------------------------------------------------------------------------
// What the composer needs besides the article itself: the slugs it may not
// take (the MDX guides'), the slugs a link may name (every guide and every
// composer article — a link to one still in the backlog is fine once it goes
// out first), the other release times (the checklist's spacing) and the next
// open slot, and the byline choices.
// ---------------------------------------------------------------------------

export type ComposerContext = {
  rows: ArticleRow[];
  fileSlugs: string[];
  knownSlugs: string[];
  otherPublishTimes: string[];
  suggestedSlot: string;
  authors: Array<{ id: string; label: string }>;
};

export async function loadComposerContext(excludeId: string | null): Promise<ComposerContext> {
  const [rows, authors] = await Promise.all([listArticlesForAdmin(), listAuthorOptions()]);
  const fileSlugs = listArticles().map((a) => a.slug);
  const others = rows.filter((r) => r.id !== excludeId);
  const released = others.filter((r) => articleStatus(r) !== "draft" && r.publish_at);
  return {
    rows,
    fileSlugs,
    knownSlugs: [...fileSlugs, ...rows.map((r) => r.slug)],
    otherPublishTimes: released.map((r) => r.publish_at as string),
    suggestedSlot: nextOpenSlot(
      released.filter((r) => articleStatus(r) === "scheduled").map((r) => r.publish_at as string),
    ),
    authors,
  };
}
