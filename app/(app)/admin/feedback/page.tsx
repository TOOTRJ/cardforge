import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackStatusButtons } from "@/components/admin/feedback-status-buttons";
import { listAllFeedback } from "@/lib/feedback/queries";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  type FeedbackStatus,
} from "@/lib/feedback/schemas";
import { FRAME_TEMPLATE_LABELS } from "@/types/card";
import type { FrameTemplate } from "@/types/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Feedback inbox",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const CATEGORY_LABEL = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.key, c.label]),
);

const CATEGORY_TONE: Record<string, string> = {
  bug: "border-danger/50 bg-danger/10 text-foreground",
  frame: "border-accent/50 bg-accent/10 text-foreground",
  feature: "border-primary/50 bg-primary/10 text-foreground",
  frame_request: "border-gold/50 bg-gold/10 text-foreground",
  other: "border-border/60 bg-elevated text-muted",
};

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = (FEEDBACK_STATUSES as readonly string[]).includes(status ?? "")
    ? (status as FeedbackStatus)
    : undefined;

  const items = await listAllFeedback(filter);
  // Non-admins get a 404 (don't reveal the route exists).
  if (items === null) notFound();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Feedback"
        title="Feedback inbox"
        description="Bug reports, frame issues, and feature/frame requests from users. New submissions also ping the notification bell."
      />

      <div className="mt-4 flex items-center gap-2">
        <FilterTab href="/admin/feedback" active={!filter} label="All" />
        {FEEDBACK_STATUSES.map((s) => (
          <FilterTab
            key={s}
            href={`/admin/feedback?status=${s}`}
            active={filter === s}
            label={s[0].toUpperCase() + s.slice(1)}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4">
        {items.length === 0 ? (
          <EmptyState
            title="Inbox zero"
            description={
              filter
                ? `No ${filter} feedback right now.`
                : "No feedback yet — when users submit, it lands here."
            }
          />
        ) : (
          items.map((item) => (
            <SurfaceCard key={item.id} className="flex flex-col gap-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    CATEGORY_TONE[item.category] ?? CATEGORY_TONE.other,
                  )}
                >
                  {CATEGORY_LABEL[item.category] ?? item.category}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {item.subject}
                </span>
                <span className="ml-auto text-xs text-subtle">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>

              <p className="whitespace-pre-wrap text-sm leading-6 text-muted">
                {item.message}
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-subtle">
                <span>
                  From{" "}
                  {item.user?.username ? (
                    <Link
                      href={`/profile/${item.user.username}`}
                      className="font-medium text-primary-bright hover:underline"
                    >
                      {item.user.displayName ?? item.user.username}
                    </Link>
                  ) : (
                    <span className="font-medium">deleted account</span>
                  )}
                </span>
                {item.frameTemplate ? (
                  <span>
                    Frame:{" "}
                    <Link
                      href="/admin/frame-compare"
                      className="font-mono text-primary-bright hover:underline"
                    >
                      {FRAME_TEMPLATE_LABELS[
                        item.frameTemplate as FrameTemplate
                      ] ?? item.frameTemplate}
                    </Link>
                  </span>
                ) : null}
                {item.pageUrl ? <span>Page: {item.pageUrl}</span> : null}
                <span className="ml-auto">
                  <FeedbackStatusButtons
                    feedbackId={item.id}
                    status={item.status}
                  />
                </span>
              </div>
            </SurfaceCard>
          ))
        )}
      </div>
    </DashboardShell>
  );
}

function FilterTab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border/50 text-muted hover:border-border-strong hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}
