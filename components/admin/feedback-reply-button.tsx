"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquareReply, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FieldGroup, textareaClass } from "@/components/creator/field-group";
import { adminReplyToFeedbackAction } from "@/lib/messages/actions";
import { MESSAGE_BODY_MAX, replyToFeedbackSchema } from "@/lib/messages/schemas";

// ---------------------------------------------------------------------------
// FeedbackReplyButton — the admin inbox's "Reply" per submission. Opens (or
// reuses) the thread tied to this feedback row and posts the reply; the
// feedback flips to "reviewed". When a thread already exists the button is
// simply a link to it.
// ---------------------------------------------------------------------------

export function FeedbackReplyButton({
  feedbackId,
  subject,
  existingThreadId,
  disabledReason,
}: {
  feedbackId: string;
  subject: string;
  existingThreadId: string | null;
  /** e.g. the submitter's account was deleted — no one to message. */
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (existingThreadId) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link href={`/admin/messages/${existingThreadId}`}>
          <MessageSquareReply className="h-4 w-4" aria-hidden />
          Open conversation
        </Link>
      </Button>
    );
  }

  const submit = () => {
    const parsed = replyToFeedbackSchema.safeParse({ feedbackId, body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the reply.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await adminReplyToFeedbackAction(parsed.data);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Reply sent — the user has been notified.");
      setOpen(false);
      setBody("");
      router.push(`/admin/messages/${result.threadId}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? undefined}
        >
          <MessageSquareReply className="h-4 w-4" aria-hidden />
          Reply
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Reply to “{subject}”</DialogTitle>
          <DialogDescription>
            Opens a conversation with the sender. They&apos;ll see your reply under
            Messages, get a notification, and can answer you there.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FieldGroup
            label="Your reply"
            error={error ?? undefined}
            helper={`Up to ${MESSAGE_BODY_MAX.toLocaleString()} characters. Sent as the PipGlyph team.`}
          >
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              autoFocus
              placeholder="Thanks for the report — here's what we found…"
              className={textareaClass(Boolean(error))}
            />
          </FieldGroup>
          <DialogFooter className="border-t-0 px-0 py-0">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Send reply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
