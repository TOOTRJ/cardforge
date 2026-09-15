import { Check, CheckCheck, MessageSquareQuote } from "lucide-react";
import { TEAM_DISPLAY_NAME } from "@/lib/messages/schemas";
import type { ThreadDetail, ThreadMessage } from "@/lib/messages/queries";
import { FEEDBACK_CATEGORIES } from "@/lib/feedback/schemas";
import { formatFullTime, formatRelativeTime } from "@/components/messages/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Conversation — the transcript. Server-renderable (no state): the viewer's
// own posts sit on the right in the primary tint, the other side's on the
// left. Users see every admin post as "PipGlyph team"; admins see which
// admin posted (adminNames) and the user's handle.
// ---------------------------------------------------------------------------

const CATEGORY_LABEL = Object.fromEntries(
  FEEDBACK_CATEGORIES.map((c) => [c.key, c.label]),
) as Record<string, string>;

type ConversationProps = {
  messages: ThreadMessage[];
  /** Which side the viewer is on — decides alignment and naming. */
  viewer: "user" | "admin";
  /** The user's display handle, for the admin view. */
  userLabel?: string;
  adminNames?: Record<string, string>;
  /** The feedback the thread answers — rendered as a quoted header. */
  feedback?: ThreadDetail["feedback"];
  /** ADMIN VIEW ONLY — when the user last opened the thread. Admin posts at
   *  or before that instant show "Seen"; the newest later one shows "Not
   *  seen yet". Users never receive the mirror of this. */
  seenAt?: string | null;
  className?: string;
};

export function Conversation({
  messages,
  viewer,
  userLabel = "You",
  adminNames = {},
  feedback = null,
  seenAt = null,
  className,
}: ConversationProps) {
  // Read receipts: only the admin side, only on admin posts. Mark the latest
  // seen admin post and the latest unseen one, not every bubble.
  const seenTime = viewer === "admin" && seenAt ? new Date(seenAt).getTime() : null;
  const adminPosts = viewer === "admin" ? messages.filter((m) => m.senderRole === "admin") : [];
  const lastSeenId =
    seenTime != null
      ? [...adminPosts].reverse().find((m) => new Date(m.createdAt).getTime() <= seenTime)?.id ?? null
      : null;
  const lastUnseenId =
    viewer === "admin"
      ? [...adminPosts]
          .reverse()
          .find((m) => seenTime == null || new Date(m.createdAt).getTime() > seenTime)?.id ?? null
      : null;
  const senderLabel = (m: ThreadMessage): string => {
    if (m.senderRole === "admin") {
      if (viewer === "user") return TEAM_DISPLAY_NAME;
      return m.senderId ? (adminNames[m.senderId] ?? "Admin") : "Admin";
    }
    return viewer === "user" ? "You" : userLabel;
  };

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {feedback ? (
        <blockquote className="flex gap-3 rounded-lg border border-border/60 bg-elevated/40 px-4 py-3">
          <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {viewer === "user" ? "Your feedback" : "Their feedback"} ·{" "}
              {CATEGORY_LABEL[feedback.category] ?? feedback.category} ·{" "}
              {formatRelativeTime(feedback.createdAt)}
            </span>
            <span className="text-sm font-medium text-foreground">{feedback.subject}</span>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted">
              {feedback.message}
            </p>
          </div>
        </blockquote>
      ) : null}

      <ol className="flex flex-col gap-3" aria-label="Messages">
        {messages.map((m) => {
          const mine =
            (viewer === "user" && m.senderRole === "user") ||
            (viewer === "admin" && m.senderRole === "admin");
          return (
            <li
              key={m.id}
              className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}
            >
              <span className="px-1 text-[11px] text-subtle">
                <span className="font-medium text-muted">{senderLabel(m)}</span>
                {" · "}
                <time dateTime={m.createdAt} title={formatFullTime(m.createdAt)}>
                  {formatRelativeTime(m.createdAt)}
                </time>
              </span>
              <div
                className={cn(
                  "max-w-[min(42rem,92%)] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-6",
                  mine
                    ? "rounded-br-md bg-primary/15 text-foreground"
                    : "rounded-bl-md border border-border/60 bg-surface text-foreground",
                )}
              >
                {m.body}
              </div>
              {m.id === lastSeenId && seenAt ? (
                <span className="flex items-center gap-1 px-1 text-[11px] text-subtle">
                  <CheckCheck className="h-3 w-3 text-success" aria-hidden />
                  Seen{" "}
                  <time dateTime={seenAt} title={formatFullTime(seenAt)}>
                    {formatRelativeTime(seenAt)}
                  </time>
                </span>
              ) : m.id === lastUnseenId ? (
                <span className="flex items-center gap-1 px-1 text-[11px] text-subtle">
                  <Check className="h-3 w-3" aria-hidden />
                  Not seen yet
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
