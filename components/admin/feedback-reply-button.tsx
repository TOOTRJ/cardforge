import Link from "next/link";
import { MessageSquareReply } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// FeedbackReplyButton — the admin inbox's "Reply" per submission. A LINK,
// never a dialog (owner 2026-11-11: "I now want the conversation to just
// open up rather than having a modal open up"):
//   - a submission with a conversation → that thread;
//   - one without → /admin/messages/feedback/<id>, the conversation as it
//     will be: the user's whole message with the reply box under it. The
//     thread itself is made by the first reply (adminReplyToFeedbackAction),
//     so the user never finds an empty conversation.
// ---------------------------------------------------------------------------

/** Where a feedback row's conversation opens before it has a thread. */
export function feedbackConversationHref(feedbackId: string): string {
  return `/admin/messages/feedback/${feedbackId}`;
}

export function FeedbackReplyButton({
  feedbackId,
  existingThreadId,
  disabledReason,
}: {
  feedbackId: string;
  existingThreadId: string | null;
  /** e.g. the submitter's account was deleted — no one to message. */
  disabledReason?: string | null;
}) {
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
  if (disabledReason) {
    return (
      <Button type="button" variant="outline" size="sm" disabled title={disabledReason}>
        <MessageSquareReply className="h-4 w-4" aria-hidden />
        Reply
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={feedbackConversationHref(feedbackId)}>
        <MessageSquareReply className="h-4 w-4" aria-hidden />
        Reply
      </Link>
    </Button>
  );
}
