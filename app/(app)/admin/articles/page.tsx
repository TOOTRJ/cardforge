import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Plus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { ImportDraftsButton } from "@/components/admin/articles/import-drafts-button";
import { listArticlesForAdmin } from "@/lib/content/db-articles";
import { readArticleDrafts } from "@/lib/content/article-drafts";
import { articleStatus, type ArticleRow, type ArticleStatus } from "@/lib/content/article-shared";
import { articleSeoChecklist, blockingItems } from "@/lib/content/article-seo-checklist";
import { listArticles } from "@/lib/content/articles";
import { getCurrentProfile } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /admin/articles — the backlog: scheduled articles in release order (what
// goes out next first), then drafts, then what is live. Composer articles
// only; the MDX guides in content/articles/ ship with a deploy.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Articles admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const SECTION: Record<ArticleStatus, { title: string; empty: string }> = {
  scheduled: { title: "Scheduled", empty: "Nothing queued. Schedule a draft to start the backlog." },
  draft: { title: "Drafts", empty: "No drafts." },
  live: { title: "Live", empty: "No composer article is live yet." },
};

function utc(iso: string | null): string {
  return iso ? new Date(iso).toUTCString().replace(":00 GMT", " UTC") : "—";
}

export default async function ArticlesAdminPage() {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) notFound();
  let rows: ArticleRow[];
  try {
    rows = await listArticlesForAdmin();
  } catch (error) {
    console.warn("[admin] articles:", error);
    return (
      <DashboardShell readable>
        <PageHeader eyebrow="Admin" title="Articles" />
        <AdminLoadError what="the articles" />
      </DashboardShell>
    );
  }
  const fileSlugs = listArticles().map((a) => a.slug);
  const drafts = readArticleDrafts();
  const missingDrafts = drafts.filter((d) => !rows.some((r) => r.slug === d.slug)).length;
  const by = (status: ArticleStatus) => rows.filter((r) => articleStatus(r) === status);
  const scheduled = by("scheduled").sort((a, b) => (a.publish_at! < b.publish_at! ? -1 : 1));
  const live = by("live").sort((a, b) => (a.publish_at! < b.publish_at! ? 1 : -1));
  const draftRows = by("draft").sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));

  return (
    <DashboardShell readable>
      <PageHeader
        eyebrow="Admin"
        title="Articles"
        description="Compose guides, keep them as drafts, and schedule them so the backlog publishes over time. A scheduled article goes live at its time (UTC) and lands on /articles, /learn, the sitemap, llms.txt and the RSS feed at once."
      />
      <div className="mb-6 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/admin/articles/new">
            <Plus className="h-4 w-4" aria-hidden />
            New article
          </Link>
        </Button>
        <ImportDraftsButton available={missingDrafts} />
      </div>
      <div className="flex flex-col gap-8">
        {(
          [
            ["scheduled", scheduled],
            ["draft", draftRows],
            ["live", live],
          ] as const
        ).map(([status, list]) => (
          <section key={status} aria-labelledby={`articles-${status}`} className="flex flex-col gap-3">
            <h2 id={`articles-${status}`} className="font-display text-xl font-semibold text-foreground">
              {SECTION[status].title} <span className="text-base text-muted">({list.length})</span>
            </h2>
            {list.length === 0 ? (
              <SurfaceCard className="p-5 text-sm text-muted">{SECTION[status].empty}</SurfaceCard>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {list.map((row) => {
                  const blocking = blockingItems(
                    articleSeoChecklist(
                      {
                        slug: row.slug,
                        title: row.title,
                        seoTitle: row.seo_title,
                        description: row.description,
                        body: row.body,
                        tags: row.tags ?? [],
                        category: row.category,
                        faq: row.faq,
                        coverUrl: row.cover_url,
                        coverAlt: row.cover_alt,
                        authorId: row.author_id,
                      },
                      { fileSlugs },
                    ),
                  );
                  return (
                    <li key={row.id}>
                      <SurfaceCard className="flex flex-wrap items-center gap-3 p-4">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <Link
                            href={`/admin/articles/${row.id}`}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {row.title}
                          </Link>
                          <span className="text-xs text-muted">
                            /articles/{row.slug}
                            {status === "draft" ? ` · edited ${utc(row.updated_at)}` : ""}
                          </span>
                        </div>
                        {status !== "draft" ? (
                          <span className="inline-flex items-center gap-1 text-sm text-muted">
                            <CalendarClock className="h-4 w-4" aria-hidden />
                            {utc(row.publish_at)}
                          </span>
                        ) : null}
                        <Badge
                          className={cn(blocking.length > 0 ? "border-danger/40 text-danger" : "border-success/40 text-success")}
                        >
                          {blocking.length > 0 ? `${blocking.length} to fix` : "Checklist ready"}
                        </Badge>
                        {status === "live" ? (
                          <Link href={`/articles/${row.slug}`} className="text-sm text-primary-bright hover:underline">
                            View
                          </Link>
                        ) : (
                          <Link href={`/admin/articles/${row.id}/preview`} className="text-sm text-primary-bright hover:underline">
                            Preview
                          </Link>
                        )}
                      </SurfaceCard>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </div>
    </DashboardShell>
  );
}
