import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { ArticleComposer } from "@/components/admin/articles/article-composer";
import { loadComposerContext } from "@/lib/content/article-composer-data";
import { getCurrentProfile } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "New article",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NewArticlePage() {
  // Non-admins get a 404 (don't reveal the route exists); RLS gates writes.
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  const context = await loadComposerContext(null);
  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Articles"
        title="New article"
        description="Write it, save it as a draft, check it against the SEO checklist, then schedule it into the backlog."
      />
      <ArticleComposer
        article={null}
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
