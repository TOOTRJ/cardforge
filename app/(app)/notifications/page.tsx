import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { listNotifications } from "@/lib/notifications/queries";
import { getCurrentProfile } from "@/lib/supabase/server";
import { MarkReadOnView } from "@/components/notifications/mark-read-on-view";
import { NOTIFICATION_ICON } from "@/components/notifications/notification-bell";
import { describeNotification } from "@/lib/notifications/describe";
import { ClearNotificationsButton } from "@/components/notifications/clear-notifications-button";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const [items, profile] = await Promise.all([listNotifications(50), getCurrentProfile()]);
  const isAdmin = Boolean(profile?.is_admin);
  const hasUnread = items.some((item) => !item.readAt);

  return (
    <DashboardShell>
      <MarkReadOnView hasUnread={hasUnread} />
      <PageHeader
        eyebrow="Activity"
        title="Notifications"
        description="Likes, comments, remixes — and messages, credits and plan changes from the PipGlyph team."
        actions={<ClearNotificationsButton count={items.length} />}
      />

      <div className="mt-8">
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="When someone likes, comments on, or remixes your cards, it'll show up here."
          />
        ) : (
          <SurfaceCard className="divide-y divide-border/60 p-0">
            {items.map((item) => {
              const Icon = NOTIFICATION_ICON[item.type] ?? Bell;
              const d = describeNotification(item, { isAdmin });

              return (
                <Link
                  key={item.id}
                  href={d.href}
                  className={`flex items-start gap-3 px-5 py-4 transition-colors hover:bg-elevated/50 ${
                    item.readAt ? "" : "bg-primary/5"
                  }`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-primary-bright">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="text-sm leading-6 text-foreground">
                      <span className="font-medium">{d.subject}</span> {d.body}
                    </p>
                    <span className="text-xs text-subtle">
                      {formatRelative(item.createdAt)}
                    </span>
                  </div>
                  {item.readAt ? null : (
                    <span
                      role="img"
                      aria-label="Unread"
                      className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                  )}
                </Link>
              );
            })}
          </SurfaceCard>
        )}
      </div>
    </DashboardShell>
  );
}

function formatRelative(value: string): string {
  try {
    const date = new Date(value);
    const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  } catch {
    return value;
  }
}
