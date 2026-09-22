"use client";

import Link from "next/link";
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
  Sparkles,
  UserPlus,
} from "lucide-react";
import { describeNotification } from "@/lib/notifications/describe";
import type { NotificationItem } from "@/lib/notifications/queries";
import { formatRelativeTime } from "@/lib/format/dates";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// NotificationRow — ONE presentation for a notification, shared by the header
// bell's popover and the /notifications page (they used to carry two copies
// of the same markup). Copy + deep link come from lib/notifications/describe.
// ---------------------------------------------------------------------------

const NOTIFICATION_ICON: Record<string, typeof Bell> = {
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

export function NotificationRow({
  item,
  isAdmin,
  density = "page",
  onNavigate,
}: {
  item: NotificationItem;
  isAdmin: boolean;
  /** "popover" is the bell's tighter spacing. */
  density?: "popover" | "page";
  onNavigate?: () => void;
}) {
  const Icon = NOTIFICATION_ICON[item.type] ?? Bell;
  const d = describeNotification(item, { isAdmin });
  const popover = density === "popover";
  return (
    <Link
      href={d.href}
      onClick={onNavigate}
      className={cn(
        "flex items-start gap-3 transition-colors hover:bg-elevated/50",
        popover ? "px-4 py-3" : "px-5 py-4",
        item.readAt ? "" : "bg-primary/5",
      )}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-elevated text-primary-bright">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className={cn("text-sm text-foreground", popover ? "leading-5" : "leading-6")}>
          <span className="font-medium">{d.subject}</span> {d.body}
        </p>
        <span className="text-xs text-subtle">{formatRelativeTime(item.createdAt)}</span>
      </div>
      {item.readAt ? null : (
        <span
          role="img"
          aria-label="New"
          className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"
        />
      )}
    </Link>
  );
}
