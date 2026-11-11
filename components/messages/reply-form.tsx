"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { textareaClass } from "@/components/creator/field-group";
import { adminReplyToFeedbackAction, adminSendMessageAction, sendMessageAction } from "@/lib/messages/actions";
import { MESSAGE_BODY_MAX, messageBodySchema } from "@/lib/messages/schemas";

// ---------------------------------------------------------------------------
// ReplyForm — the composer at the bottom of a thread. Same component for
// both sides; `side` picks the server action. ⌘/Ctrl+Enter sends; the
// counter turns red past the limit (the schema rejects it before a round
// trip). A closed thread shows a locked notice instead (users can't reopen;
// an admin reply reopens it server-side).
//
// An admin's FIRST reply to a feedback submission uses it too (`feedbackId`
// in place of `threadId`; owner 2026-11-11: the conversation opens with the
// reply box under the message, no dialog): there is no thread yet — sending
// opens one (adminReplyToFeedbackAction) and the form moves on to it.
// ---------------------------------------------------------------------------

type ReplyFormProps = {
  side: "user" | "admin";
  closed?: boolean;
  placeholder?: string;
} & (
  | { threadId: string; feedbackId?: undefined }
  // Admin side only: the feedback row the first reply answers.
  | { feedbackId: string; threadId?: undefined }
);

export function ReplyForm({
  threadId,
  feedbackId,
  side,
  closed = false,
  placeholder = "Write a reply…",
}: ReplyFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const submit = () => {
    const parsed = messageBodySchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your message.");
      return;
    }
    setError(null);
    startTransition(async () => {
      if (feedbackId !== undefined) {
        // The first reply: it opens the thread, and the conversation is
        // that thread's page from here on (replace — Back goes to the
        // inbox, not to a page that no longer has anything to send).
        const opened = await adminReplyToFeedbackAction({ feedbackId, body: parsed.data });
        if (!opened.ok) {
          setError(opened.error);
          toast.error(opened.error);
          return;
        }
        toast.success("Reply sent — the user has been notified.");
        setBody("");
        router.replace(`/admin/messages/${opened.threadId}`);
        return;
      }
      const action = side === "admin" ? adminSendMessageAction : sendMessageAction;
      const result = await action({ threadId, body: parsed.data });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setBody("");
      router.refresh();
      requestAnimationFrame(() => ref.current?.focus());
    });
  };

  if (closed && side === "user") {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-border/60 bg-elevated/40 px-4 py-3 text-sm text-muted">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        This conversation is closed. Send new feedback if you need anything else.
      </p>
    );
  }

  const over = body.length > MESSAGE_BODY_MAX;
  const fieldId = `reply-${threadId ?? feedbackId}`;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="sr-only" htmlFor={fieldId}>
        Reply
      </label>
      <textarea
        id={fieldId}
        ref={ref}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        rows={4}
        placeholder={
          closed ? "Replying will reopen this conversation…" : placeholder
        }
        aria-invalid={Boolean(error) || over}
        className={textareaClass(Boolean(error) || over)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={over ? "text-xs text-danger" : "text-xs text-subtle"}>
          {error ?? `${body.length.toLocaleString("en-US")} / ${MESSAGE_BODY_MAX.toLocaleString("en-US")} · ⌘/Ctrl+Enter to send`}
        </span>
        <Button type="submit" size="sm" disabled={pending || !body.trim() || over}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          {closed ? "Reply & reopen" : "Send"}
        </Button>
      </div>
    </form>
  );
}
