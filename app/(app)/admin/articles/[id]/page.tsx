import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ArticleComposer } from "@/components/admin/articles/article-composer";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { loadComposerContext, type ComposerContext } from "@/lib/content/article-composer-data";
import { getArticleForAdmin } from "@/lib/content/db-articles";
import type { ArticleRow } from "@/lib/content/article-shared";
import { isUuid } from "@/lib/ids";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Edit article",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  let article: ArticleRow | null;
  let context: ComposerContext;
  try {
    [article, context] = await Promise.all([getArticleForAdmin(id), loadComposerContext(id)]);
  } catch (error) {
    // A database without the table (0160 not applied) — the list's card.
    console.warn("[admin] edit article:", error);
    return (
      <DashboardShell readable>
        <PageHeader eyebrow="Admin · Articles" title="Edit article" />
        <AdminLoadError what="the article" />
      </DashboardShell>
    );
  }
  if (!article) notFound();
  return (
    <DashboardShell>
      <PageHeader eyebrow="Admin · Articles" title={article.title} description={`/articles/${article.slug}`} />
      <ArticleComposer
        key={article.updated_at}
        article={article}
        fileSlugs={context.fileSlugs}
        knownSlugs={context.knownSlugs}
        otherPublishTimes={context.otherPublishTimes}
        suggestedSlot={context.suggestedSlot}
        authors={context.authors}
        viewerId={profile.id}
      />
    </DashboardShell>
  );
}
