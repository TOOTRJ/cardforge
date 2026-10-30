import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticleView } from "@/components/content/article-view";
import { composerArticle, getArticleForAdmin, getAuthor } from "@/lib/content/db-articles";
import { getPublishedRelatedArticles } from "@/lib/content/article-catalog";
import { articleStatus } from "@/lib/content/article-shared";
import { isUuid } from "@/lib/ids";
import { getCurrentProfile } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// The composer's preview: the SAVED article drawn by the very component the
// public page uses (ArticleView), draft or scheduled alike — never indexed,
// never cached, admins only.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Article preview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ArticlePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const row = await getArticleForAdmin(id);
  if (!row) notFound();
  // A draft has no release time yet: preview it as if it went out now.
  const previewRow = { ...row, publish_at: row.publish_at ?? new Date().toISOString() };
  const article = composerArticle(previewRow, await getAuthor(row.author_id));
  const related = await getPublishedRelatedArticles(row.slug, 3);
  const status = articleStatus(row);
  return (
    <>
      <div className="border-b border-gold/40 bg-gold/10 px-4 py-2 text-center text-sm text-gold-strong" role="note">
        Preview of the saved {status === "live" ? "live article" : status === "scheduled" ? "scheduled article" : "draft"} —
        not public{status === "live" ? " here (the live page is /articles/" + row.slug + ")" : ""}.
      </div>
      <ArticleView article={article} related={related} />
    </>
  );
}
