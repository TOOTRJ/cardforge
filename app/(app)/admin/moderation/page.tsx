import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MessageCircle, ShieldCheck } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  getCommentModerationQueue,
  getModerationQueue,
} from "@/lib/moderation/queries";
import {
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/lib/moderation/reasons";
import { ReportActions } from "@/components/moderation/report-actions";
import { CommentReportActions } from "@/components/moderation/comment-report-actions";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function reasonLine(reason: string, details: string | null, key: string) {
  return (
    <li key={key} className="text-xs leading-5 text-muted">
      <span className="font-medium text-foreground">
        {REPORT_REASON_LABELS[reason as ReportReason] ?? reason}
      </span>
      {details ? <> — {details}</> : null}
    </li>
  );
}

export default async function ModerationPage() {
  const [cardQueue, commentQueue] = await Promise.all([
    getModerationQueue(),
    getCommentModerationQueue(),
  ]);
  // Non-admins get a 404 (don't reveal the route exists).
  if (cardQueue === null) notFound();
  const comments = commentQueue ?? [];
  const totalFlagged = cardQueue.length + comments.length;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Moderation queue"
        description="Reported content awaiting review. Hiding a card un-publishes it; removing a comment deletes it."
        actions={<Badge variant="primary">{totalFlagged} flagged</Badge>}
      />

      <div className="mt-10 flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Reported cards
          </h2>
          {cardQueue.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No flagged cards"
              description="No pending card reports."
            />
          ) : (
            cardQueue.map((item) => (
              <SurfaceCard
                key={item.cardId}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start"
              >
                <div className="aspect-[5/7] w-28 shrink-0 overflow-hidden rounded-md bg-elevated">
                  {item.renderedImageUrl || item.artUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.renderedImageUrl ?? item.artUrl ?? ""}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <Badge variant="default">
                      {item.reports.length} report
                      {item.reports.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {item.reports.map((report) =>
                      reasonLine(report.reason, report.details, report.id),
                    )}
                  </ul>
                </div>
                <ReportActions cardId={item.cardId} />
              </SurfaceCard>
            ))
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Reported comments
          </h2>
          {comments.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="No flagged comments"
              description="No pending comment reports."
            />
          ) : (
            comments.map((item) => (
              <SurfaceCard
                key={item.commentId}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-semibold text-foreground">
                      Comment
                    </span>
                    <Badge variant="default">
                      {item.reports.length} report
                      {item.reports.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-line rounded-md border border-border/40 bg-background/40 px-3 py-2 text-sm text-foreground">
                    {item.body}
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {item.reports.map((report) =>
                      reasonLine(report.reason, report.details, report.id),
                    )}
                  </ul>
                </div>
                <CommentReportActions commentId={item.commentId} />
              </SurfaceCard>
            ))
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
