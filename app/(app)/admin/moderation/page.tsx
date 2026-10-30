import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EyeOff, MessageCircle, ShieldCheck } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  getCommentModerationQueue,
  getModerationHiddenCards,
  getModerationQueue,
} from "@/lib/moderation/queries";
import { UnhideCardButton } from "@/components/moderation/unhide-card-button";
import { formatUtcDate } from "@/lib/format/dates";
import {
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/lib/moderation/reasons";
import { ReportActions } from "@/components/moderation/report-actions";
import { CommentReportActions } from "@/components/moderation/comment-report-actions";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The lock's reason code (migration 0156) in words — never report text. */
const HIDDEN_REASON_LABELS: Record<string, string> = {
  report: "Hidden from a report",
  flagged_file: "Hidden by the file rescan",
  backfill: "Hidden before the lock existed (actioned report)",
};

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
  const [cardResult, commentResult, hiddenResult] = await Promise.all([
    getModerationQueue(),
    getCommentModerationQueue(),
    getModerationHiddenCards(),
  ]);
  // Non-admins get a 404 (don't reveal the route exists).
  if (cardResult === null) notFound();
  const cardQueue = cardResult.items;
  const comments = commentResult?.items ?? [];
  const commentsFailed = commentResult?.loadError ?? false;
  const hidden = hiddenResult?.items ?? [];
  const hiddenFailed = hiddenResult?.loadError ?? false;
  const totalFlagged = cardQueue.length + comments.length;
  // Only the live-preview fallback (a card with no bake) reads these.
  const profileOverrides = cardQueue.some((item) => !item.card.rendered_image_url)
    ? await getFrameProfileOverrides()
    : null;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Moderation queue"
        description="Reported content awaiting review. Hiding a card un-publishes it; removing a comment deletes it."
        actions={
          cardResult.loadError || commentsFailed ? null : <Badge variant="primary">{totalFlagged} flagged</Badge>
        }
      />

      <div className="mt-10 flex flex-col gap-10">
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Reported cards
          </h2>
          {cardResult.loadError ? <AdminLoadError what="the reported cards" /> : null}
          {cardQueue.length === 0 && cardResult.loadError ? null : cardQueue.length === 0 ? (
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
                {/* The card's own tile: the 600 px thumb (a 7:5 render
                    letterboxed whole), the live preview when nothing is
                    baked — never the 3 MB PNG. A link to the card. */}
                {item.href ? (
                  <Link
                    href={item.href}
                    className="block w-28 shrink-0 card-corners focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60"
                    aria-label={`Open ${item.title}`}
                  >
                    <BakedCardThumbnail
                      renderedImageUrl={item.card.rendered_image_url}
                      renderedThumbUrl={item.card.rendered_thumb_url}
                      title={item.title}
                      alt=""
                      sizes="112px"
                      previewData={cardToPreviewData(item.card, profileOverrides)}
                    />
                  </Link>
                ) : (
                  <div className="w-28 shrink-0">
                    <BakedCardThumbnail
                      renderedImageUrl={item.card.rendered_image_url}
                      renderedThumbUrl={item.card.rendered_thumb_url}
                      title={item.title}
                      alt=""
                      sizes="112px"
                      previewData={cardToPreviewData(item.card, profileOverrides)}
                    />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-semibold text-foreground">
                      {item.href ? (
                        <Link href={item.href} className="underline-offset-4 hover:underline">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
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

        {/* Cards moderation hid stay private until an admin unhides them
            (migration 0156). Unhide clears the lock and tells the owner;
            it never republishes. */}
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Hidden cards
          </h2>
          {hiddenFailed ? <AdminLoadError what="the hidden cards" /> : null}
          {hidden.length === 0 && hiddenFailed ? null : hidden.length === 0 ? (
            <EmptyState
              icon={EyeOff}
              title="No hidden cards"
              description="No card is held private by moderation."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border/40 rounded-md border border-border/60 bg-surface/60">
              {hidden.map((item) => (
                <li key={item.cardId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.href ? (
                        <Link href={item.href} className="underline-offset-4 hover:underline">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </span>
                    <span className="text-xs text-muted">
                      {item.ownerUsername ? `@${item.ownerUsername} · ` : ""}
                      {HIDDEN_REASON_LABELS[item.reason ?? ""] ?? "Hidden"}
                      {item.hiddenAt ? ` · ${formatUtcDate(item.hiddenAt)}` : ""}
                    </span>
                  </div>
                  <UnhideCardButton cardId={item.cardId} title={item.title} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-subtle">
            Reported comments
          </h2>
          {commentsFailed ? <AdminLoadError what="the reported comments" /> : null}
          {comments.length === 0 && commentsFailed ? null : comments.length === 0 ? (
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
