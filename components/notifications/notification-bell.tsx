"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Coins,
  Crown,
  Heart,
  Layers,
  MailWarning,
  MessageCircle,
  MessageSquare,
  ShieldAlert,
  CheckCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  clearNotificationAlerts,
  fetchNotifications,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { NotificationItem } from "@/lib/notifications/queries";
import { describeNotification } from "@/lib/notifications/describe";
import { subscribeNotificationArrivals } from "@/lib/notifications/bus";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// NotificationBell — header bell that opens an in-place popover instead of
// navigating to /notifications. Opening it fetches the latest items; the
// badge and unread dots clear only when the user opens a notification or
// hits "Clear all" (two-step), like most apps — nothing is deleted. The
// full-history page is still reachable via "View all".
// ---------------------------------------------------------------------------

export const NOTIFICATION_ICON: Record<string, typeof Bell> = {
  like: Heart,
  comment: MessageCircle,
  remix: Sparkles,
  follow: UserPlus,
  feedback: MailWarning,
  moderation: ShieldAlert,
  message: MessageSquare,
  credit_grant: Coins,
  comp_plan: Crown,
  card_limit: Layers,
  render_update: Sparkles,
};

type NotificationBellProps = {
  /** Admins' "message" entries deep-link to the team inbox, users' to
   *  their own thread. */
  isAdmin?: boolean;
  initialUnread: number;
};

export function NotificationBell({ initialUnread, isAdmin = false }: NotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  // The server re-renders the header with a fresh count after router.refresh()
  // (a thread or the notifications page marking itself read) — without this
  // sync the badge kept the number it mounted with until a full reload.
  // Adjusting state during render (not in an effect) is React's pattern for
  // "reset local state when a prop changes" and avoids a cascading re-render.
  const [syncedInitial, setSyncedInitial] = useState(initialUnread);
  if (syncedInitial !== initialUnread) {
    setSyncedInitial(initialUnread);
    setUnread(initialUnread);
  }
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // "Clear all": mark everything read — badge to zero and dots gone
  // optimistically, persisted, then a refresh so the dashboard count agrees.
  const clearAll = async () => {
    setClearing(true);
    setConfirmClear(false);
    const now = new Date().toISOString();
    setItems((prev) => prev?.map((item) => (item.readAt ? item : { ...item, readAt: now })) ?? prev);
    setUnread(0);
    try {
      await clearNotificationAlerts();
      router.refresh();
    } finally {
      setClearing(false);
    }
  };

  // Opening one notification marks just that one read.
  const openItem = (item: NotificationItem) => {
    setOpen(false);
    if (item.readAt) return;
    setItems((prev) => prev?.map((it) => (it.id === item.id ? { ...it, readAt: new Date().toISOString() } : it)) ?? prev);
    setUnread((n) => Math.max(0, n - 1));
    void markNotificationRead(item.id).then(() => router.refresh());
  };

  // A real-time arrival (components/notifications/realtime-alerts.tsx) bumps
  // the badge and drops the cached list so the next open refetches.
  useEffect(
    () =>
      subscribeNotificationArrivals(() => {
        setUnread((n) => n + 1);
        setItems(null);
      }),
    [],
  );

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    setConfirmClear(false);
    if (!next) return;
    setLoading(true);
    void (async () => {
      const list = await fetchNotifications(20);
      setItems(list);
      setLoading(false);
    })();
  };

  const hasUnreadItems = Boolean(items?.some((item) => !item.readAt)) || unread > 0;

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
          <span className="flex items-center gap-3">
            {items && items.length > 0 && hasUnreadItems ? (
              confirmClear ? (
                <span className="inline-flex items-center gap-2 text-xs">
                  <span className="text-muted">Clear alerts?</span>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="font-semibold text-muted hover:text-foreground"
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearAll()}
                    disabled={clearing}
                    className="font-semibold text-primary-bright hover:underline disabled:opacity-60"
                  >
                    Clear
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted transition-colors hover:text-foreground"
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                  Clear all
                </button>
              )
            ) : null}
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-primary-bright underline-offset-4 hover:underline"
            >
              View all
            </Link>
          </span>
        </div>

        <div className="max-h-[min(26rem,60vh)] overflow-y-auto">
          {loading && items === null ? (
            <div className="px-4 py-8 text-center text-sm text-muted">
              Loading…
            </div>
          ) : items && items.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {items.map((item) => {
                const Icon = NOTIFICATION_ICON[item.type] ?? Bell;
                const d = describeNotification(item, { isAdmin });

                return (
                  <li key={item.id}>
                    <Link
                      href={d.href}
                      onClick={() => openItem(item)}
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
                          <span className="font-medium">{d.subject}</span> {d.body}
                        </p>
                        <span className="text-xs text-subtle">
                          {formatRelative(item.createdAt)}
                        </span>
                      </div>
                      {item.readAt ? null : (
                        <span role="img" aria-label="Unread" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />
                      )}
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
                Likes, comments, remixes, and messages from the team show up here.
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
