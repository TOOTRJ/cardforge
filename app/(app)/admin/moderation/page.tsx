import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { getModerationQueue } from "@/lib/moderation/queries";
import {
  REPORT_REASON_LABELS,
  type ReportReason,
} from "@/lib/moderation/reasons";
import { ReportActions } from "@/components/moderation/report-actions";

export const metadata: Metadata = {
  title: "Moderation",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  const queue = await getModerationQueue();
  // Non-admins get a 404 (don't reveal the route exists).
  if (queue === null) notFound();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin"
        title="Moderation queue"
        description="Reported public cards awaiting review. Hiding a card un-publishes it (sets it private)."
        actions={<Badge variant="primary">{queue.length} flagged</Badge>}
      />

      <div className="mt-10 flex flex-col gap-4">
        {queue.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing to review"
            description="No pending reports — all quiet."
          />
        ) : (
          queue.map((item) => (
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
                  {item.reports.map((report) => (
                    <li key={report.id} className="text-xs leading-5 text-muted">
                      <span className="font-medium text-foreground">
                        {REPORT_REASON_LABELS[report.reason as ReportReason] ??
                          report.reason}
                      </span>
                      {report.details ? <> — {report.details}</> : null}
                    </li>
                  ))}
                </ul>
              </div>

              <ReportActions cardId={item.cardId} />
            </SurfaceCard>
          ))
        )}
      </div>
    </DashboardShell>
  );
}
