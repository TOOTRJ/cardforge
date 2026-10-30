import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ArticleComposer } from "@/components/admin/articles/article-composer";
import { loadComposerContext } from "@/lib/content/article-composer-data";
import { getArticleForAdmin } from "@/lib/content/db-articles";
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
  const [article, context] = await Promise.all([getArticleForAdmin(id), loadComposerContext(id)]);
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
