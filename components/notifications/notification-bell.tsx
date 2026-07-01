"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Heart, MessageCircle, Sparkles, UserPlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  fetchNotifications,
  markAllNotificationsRead,
} from "@/lib/notifications/actions";
import type { NotificationItem } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// NotificationBell — header bell that opens an in-place popover instead of
// navigating to /notifications. On open it fetches the latest items and
// auto-marks everything read (clearing the badge); the full-history page is
// still reachable via the "View all" footer link.
// ---------------------------------------------------------------------------

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

type NotificationBellProps = {
  initialUnread: number;
};

export function NotificationBell({ initialUnread }: NotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;

    setLoading(true);
    void (async () => {
      const list = await fetchNotifications(20);
      setItems(list);
      setLoading(false);
      // Auto-mark read on open: zero the badge optimistically, persist, then
      // refresh so server-rendered surfaces (and a future re-open) agree.
      if (list.some((item) => !item.readAt)) {
        setUnread(0);
        await markAllNotificationsRead();
        router.refresh();
      }
    })();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Notifications"
          aria-label={
            unread > 0 ? `Notifications (${unread} unread)` : "Notifications"
          }
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50"
        >
          <Bell className="h-5 w-5" aria-hidden />
          {unread > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <span className="font-display text-sm font-semibold text-foreground">
            Notifications
          </span>
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="text-xs font-semibold text-primary-bright underline-offset-4 hover:underline"
          >
            View all
          </Link>
        </div>

        <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
          {loading && items === null ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              Loading…
            </div>
          ) : items && items.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {items.map((item) => {
                const Icon = ICON[item.type] ?? Bell;
                const actorName =
                  item.actor?.displayName ||
                  (item.actor?.username
                    ? `@${item.actor.username}`
                    : "Someone");
                const verb = VERB[item.type] ?? "interacted with";
                const href =
                  item.card && item.card.ownerUsername
                    ? `/card/${item.card.ownerUsername}/${item.card.slug}`
                    : item.actor?.username
                      ? `/profile/${item.actor.username}`
                      : "#";

                return (
                  <li key={item.id}>
                    <Link
                      href={href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-elevated/50",
                        item.readAt ? "" : "bg-primary/5",
                      )}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-primary-bright">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="text-sm leading-5 text-foreground">
                          <span className="font-medium">{actorName}</span>{" "}
                          {item.type === "follow" ? (
                            "started following you."
                          ) : (
                            <>
                              {verb}{" "}
                              {item.card ? (
                                <span className="font-medium">
                                  {item.card.title}
                                </span>
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
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-gold">
                <Bell className="h-4 w-4" aria-hidden />
              </span>
              <p className="text-sm font-medium text-foreground">
                No notifications yet
              </p>
              <p className="text-xs leading-5 text-muted">
                Likes, comments, and remixes on your cards show up here.
              </p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
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
