import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FeedbackStatusButtons } from "@/components/admin/feedback-status-buttons";
import { FeedbackReplyButton } from "@/components/admin/feedback-reply-button";
import { AdminLoadError } from "@/components/admin/admin-load-error";
import { listAllFeedback } from "@/lib/feedback/queries";
import { feedbackInboxHref, parseFeedbackInboxParams } from "@/lib/feedback/inbox-filters";
import { threadIdsForFeedback } from "@/lib/messages/queries";
import {
  FEEDBACK_AREAS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  type FeedbackArea,
} from "@/lib/feedback/schemas";
import { FRAME_TEMPLATE_LABELS } from "@/types/card";
import type { FrameTemplate } from "@/types/card";
import { cn } from "@/lib/utils";
import { formatUtcDateTime } from "@/lib/format/dates";

export const metadata: Metadata = {
  title: "Feedback inbox",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const CATEGORY_LABEL = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.key, c.label]),
);

const AREA_LABEL = Object.fromEntries(
  FEEDBACK_AREAS.map((a) => [a.key, a.label]),
) as Record<FeedbackArea, string>;

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
  searchParams: Promise<{ status?: string; area?: string }>;
}) {
  // Default view: everything still needing a look (new + reviewed), newest
  // first with untouched reports on top. "All" and the single statuses are
  // explicit tabs; the Area row (0146, TODO DK10.1) narrows either to one
  // area — the deck dialog's — or shows every area, /feedback's included.
  const { filter, area } = parseFeedbackInboxParams(await searchParams);
  const inbox = await listAllFeedback(filter, area);
  // Non-admins get a 404 (don't reveal the route exists).
  if (inbox === null) notFound();
  const { items } = inbox;
  // Submissions that already have a conversation link to it instead of
  // opening a second one (one thread per feedback row, migration 0070).
  const links = await threadIdsForFeedback(items.map((item) => item.id));
  const threadByFeedback = links.threads;
  const loadError = inbox.loadError || links.loadError;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Feedback"
        title="Feedback inbox"
        description="Bug reports, frame issues, feature/frame requests and the deck builder's feedback from users. New submissions ping the notification bell; Reply opens a conversation the user sees under Messages."
      />

      <nav aria-label="Status" className="mt-4 flex flex-wrap items-center gap-2">
        <FilterTab href={feedbackInboxHref("unresolved", area)} active={filter === "unresolved"} label="Unresolved" />
        <FilterTab href={feedbackInboxHref("all", area)} active={filter === "all"} label="All" />
        {FEEDBACK_STATUSES.map((s) => (
          <FilterTab
            key={s}
            href={feedbackInboxHref(s, area)}
            active={filter === s}
            label={s[0].toUpperCase() + s.slice(1)}
          />
        ))}
      </nav>
      <nav aria-label="Area" className="mt-2 flex flex-wrap items-center gap-2">
        <FilterTab href={feedbackInboxHref(filter, null)} active={area === null} label="All areas" />
        {FEEDBACK_AREAS.map((a) => (
          <FilterTab
            key={a.key}
            href={feedbackInboxHref(filter, a.key)}
            active={area === a.key}
            label={a.label}
          />
        ))}
      </nav>

      <div className="mt-6 flex flex-col gap-4">
        {loadError ? <AdminLoadError what="the feedback inbox" /> : null}
        {items.length === 0 && !loadError ? (
          <EmptyState
            title="Inbox zero"
            description={
              (filter === "unresolved"
                ? "Nothing needs a look right now — every submission is resolved."
                : filter === "all"
                  ? "No feedback yet — when users submit, it lands here."
                  : `No ${filter} feedback right now.`) +
              (area ? ` (Area: ${AREA_LABEL[area]}.)` : "")
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
                {item.area ? (
                  <span className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {AREA_LABEL[item.area]}
                  </span>
                ) : null}
                <span className="text-sm font-medium text-foreground">
                  {item.subject}
                </span>
                <span className="ml-auto text-xs text-subtle">
                  {formatUtcDateTime(item.createdAt)}
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
                      {/* The template key beside the label: labels repeat
                          across eras ("Standard", "Land"; TODO 4.48a). A
                          retired key (alphatoken, TODO 4.54) on an old
                          row has no label and prints as the key. */}
                      {FRAME_TEMPLATE_LABELS[item.frameTemplate as FrameTemplate]
                        ? `${FRAME_TEMPLATE_LABELS[item.frameTemplate as FrameTemplate]} · ${item.frameTemplate}`
                        : item.frameTemplate}
                    </Link>
                  </span>
                ) : null}
                {item.deck ? (
                  <span>
                    Deck:{" "}
                    {item.deck.isPrivate ? (
                      // Its page opens for its owner only (decks' RLS).
                      <span className="font-medium">{item.deck.title} (private)</span>
                    ) : (
                      <Link
                        href={`/deck/${item.deck.slug}`}
                        className="font-medium text-primary-bright hover:underline"
                      >
                        {item.deck.title}
                      </Link>
                    )}
                  </span>
                ) : null}
                {item.pageUrl ? <span>Page: {item.pageUrl}</span> : null}
                {item.viewport ? <span>Window: {item.viewport.replace("x", " × ")} px</span> : null}
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <FeedbackReplyButton
                    feedbackId={item.id}
                    subject={item.subject}
                    existingThreadId={threadByFeedback.get(item.id) ?? null}
                    disabledReason={item.user ? null : "The sender's account was deleted."}
                  />
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
      // "true", never "page": two filter rows each mark their own choice,
      // and neither link is the page itself.
      aria-current={active ? "true" : undefined}
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
