import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Heart, MessageCircle, Sparkles, UserPlus } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { listNotifications } from "@/lib/notifications/queries";
import { MarkReadOnView } from "@/components/notifications/mark-read-on-view";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const VERB: Record<string, string> = {
  like: "liked",
  comment: "commented on",
  remix: "remixed",
};

const ICON: Record<string, typeof Bell> = {
  like: Heart,
  comment: MessageCircle,
  remix: Sparkles,
  follow: UserPlus,
};

export default async function NotificationsPage() {
  const items = await listNotifications(50);
  const hasUnread = items.some((item) => !item.readAt);

  return (
    <DashboardShell>
      <MarkReadOnView hasUnread={hasUnread} />
      <PageHeader
        eyebrow="Activity"
        title="Notifications"
        description="Likes, comments, and remixes on your cards."
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
              const Icon = ICON[item.type] ?? Bell;
              const actorName =
                item.actor?.displayName ||
                (item.actor?.username ? `@${item.actor.username}` : "Someone");
              const verb = VERB[item.type] ?? "interacted with";
              const href =
                item.card && item.card.ownerUsername
                  ? `/card/${item.card.ownerUsername}/${item.card.slug}`
                  : item.actor?.username
                    ? `/profile/${item.actor.username}`
                    : "#";

              return (
                <Link
                  key={item.id}
                  href={href}
                  className={`flex items-start gap-3 px-5 py-4 transition-colors hover:bg-elevated/50 ${
                    item.readAt ? "" : "bg-primary/5"
                  }`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-primary">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="text-sm leading-6 text-foreground">
                      <span className="font-medium">{actorName}</span>{" "}
                      {item.type === "follow" ? (
                        "started following you."
                      ) : (
                        <>
                          {verb}{" "}
                          {item.card ? (
                            <span className="font-medium">{item.card.title}</span>
                          ) : (
                            "your card"
                          )}
                          .
                        </>
                      )}
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
