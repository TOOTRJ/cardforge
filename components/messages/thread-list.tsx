"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, CheckCheck, CheckCircle2 } from "lucide-react";
import { TEAM_DISPLAY_NAME } from "@/lib/messages/schemas";
import type { AdminThreadSummary, ThreadSummary } from "@/lib/messages/queries";
import { formatBadgeCount, formatRelativeTime } from "@/components/messages/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// ThreadList — the inbox rail. Client-side only for the active-row highlight
// (usePathname); the data is server-fetched by the page. Unread rows carry
// the count badge and a bolder subject; closed rows a small check.
// ---------------------------------------------------------------------------

type ThreadListProps = {
  threads: Array<ThreadSummary | AdminThreadSummary>;
  basePath: "/messages" | "/admin/messages";
  className?: string;
};

function isAdminThread(t: ThreadSummary | AdminThreadSummary): t is AdminThreadSummary {
  return "user" in t;
}

export function ThreadList({ threads, basePath, className }: ThreadListProps) {
  const pathname = usePathname();
  return (
    <ul className={cn("flex flex-col", className)} aria-label="Conversations">
      {threads.map((t) => {
        const href = `${basePath}/${t.id}`;
        const active = pathname === href;
        const unread = t.unreadCount > 0;
        const who = isAdminThread(t)
          ? t.user.displayName || (t.user.username ? `@${t.user.username}` : "Unknown user")
          : TEAM_DISPLAY_NAME;
        const lastFrom =
          t.lastSenderRole === "admin"
            ? basePath === "/messages"
              ? TEAM_DISPLAY_NAME
              : "You"
            : basePath === "/messages"
              ? "You"
              : who;
        return (
          <li key={t.id}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col gap-1 border-b border-border/40 px-4 py-3 transition-colors hover:bg-elevated/60",
                active ? "bg-elevated" : unread ? "bg-primary/5" : "",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    unread ? "font-semibold text-foreground" : "font-medium text-foreground/90",
                  )}
                >
                  {t.subject}
                </span>
                {unread ? (
                  <span
                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                    aria-label={`${t.unreadCount} unread`}
                  >
                    {formatBadgeCount(t.unreadCount)}
                  </span>
                ) : t.status === "closed" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-subtle" aria-label="Closed" />
                ) : null}
              </span>
              <span className="flex items-center gap-2 text-xs text-subtle">
                <span className="min-w-0 flex-1 truncate">
                  {isAdminThread(t) ? <span className="text-muted">{who} · </span> : null}
                  {t.lastMessagePreview ? (
                    <>
                      <span className="text-muted">{lastFrom}:</span> {t.lastMessagePreview}
                    </>
                  ) : (
                    "No messages yet"
                  )}
                </span>
                {/* Admin inbox only: has the user seen the team's last post? */}
                {isAdminThread(t) && t.lastSenderRole === "admin" ? (
                  t.userHasUnseen ? (
                    <span className="inline-flex shrink-0 items-center gap-1" title="The user hasn't opened this yet">
                      <Check className="h-3 w-3" aria-hidden />
                      Unseen
                    </span>
                  ) : (
                    <span
                      className="inline-flex shrink-0 items-center gap-1 text-success"
                      title={t.userLastReadAt ? `Seen ${formatRelativeTime(t.userLastReadAt)}` : "Seen"}
                    >
                      <CheckCheck className="h-3 w-3" aria-hidden />
                      Seen
                    </span>
                  )
                ) : null}
                <time dateTime={t.lastMessageAt} className="shrink-0">
                  {formatRelativeTime(t.lastMessageAt)}
                </time>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
