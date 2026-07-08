import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { getCurrentUser } from "@/lib/supabase/server";
import { listMyFeedback } from "@/lib/feedback/queries";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback/schemas";

export const metadata: Metadata = {
  title: "Feedback",
  description:
    "Report bugs, flag frame or layout issues, and request features or new frames.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "accent" | "primary" }> = {
  new: { label: "New", variant: "accent" },
  reviewed: { label: "Reviewed", variant: "default" },
  resolved: { label: "Resolved", variant: "primary" },
};

const CATEGORY_LABEL = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.key, c.label]),
);

export default async function FeedbackPage() {
  const user = await getCurrentUser();
  const myFeedback = await listMyFeedback();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Feedback"
        title="Help us forge better"
        description="Found a bug? A frame rendering wrong? Want a feature or a new frame? Tell us — every submission lands directly with the team."
      />

      <div className="mt-6 flex flex-col gap-8">
        <SurfaceCard className="p-6">
          <Suspense fallback={null}>
            <FeedbackForm signedIn={Boolean(user)} />
          </Suspense>
        </SurfaceCard>

        {myFeedback.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
              Your recent feedback
            </h2>
            <ul className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/50 bg-elevated/30">
              {myFeedback.map((item) => {
                const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.new;
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3"
                  >
                    <span className="text-xs text-subtle">
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {item.subject}
                    </span>
                    <span className="text-xs text-subtle">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </DashboardShell>
  );
}
