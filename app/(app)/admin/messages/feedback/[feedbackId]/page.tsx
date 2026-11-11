import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, UserCircle } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Conversation } from "@/components/messages/conversation";
import { ReplyForm } from "@/components/messages/reply-form";
import { getFeedbackConversationStart } from "@/lib/messages/queries";
import { MESSAGE_SUBJECT_MAX } from "@/lib/messages/schemas";
import { isUuid } from "@/lib/ids";

// ---------------------------------------------------------------------------
// /admin/messages/feedback/<feedbackId> — a feedback submission opened AS
// the conversation it is about to become (owner 2026-11-11: the inbox's
// Reply opens this page, not a dialog): the user's whole message, and the
// reply box under it. No thread exists yet and opening the page makes none —
// the first reply does (ReplyForm's `feedbackId`), then the page is that
// thread's. A submission that already has a thread goes straight to it.
// The layout above gates the route (a non-admin gets a 404).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type Params = { feedbackId: string };

/** The subject the thread will carry (adminReplyToFeedbackAction's). */
const threadSubject = (subject: string) => `Re: ${subject}`.slice(0, MESSAGE_SUBJECT_MAX);

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { feedbackId } = await params;
  const start = isUuid(feedbackId) ? await getFeedbackConversationStart(feedbackId) : null;
  return {
    title: start ? `${threadSubject(start.feedback.subject)} — Conversations` : "Conversations",
    robots: { index: false, follow: false },
  };
}

export default async function AdminFeedbackConversationPage({ params }: { params: Promise<Params> }) {
  const { feedbackId } = await params;
  if (!isUuid(feedbackId)) notFound();
  const start = await getFeedbackConversationStart(feedbackId);
  if (!start) notFound();
  // One conversation per submission: it has begun, so that is the page.
  if (start.threadId) redirect(`/admin/messages/${start.threadId}`);

  const { feedback, user } = start;
  const userLabel = user ? user.displayName || (user.username ? `@${user.username}` : "Unknown user") : "Deleted account";

  return (
    <SurfaceCard className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/feedback"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Feedback inbox
        </Link>
        <h2 className="min-w-0 flex-1 basis-full font-display text-lg font-semibold text-foreground sm:basis-auto">
          {threadSubject(feedback.subject)}
        </h2>
        <Badge variant="outline">No reply yet</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-elevated/30 px-4 py-2 text-sm">
        <UserCircle className="h-4 w-4 text-subtle" aria-hidden />
        <span className="text-muted">With</span>
        {user ? (
          <Link href={`/admin/users?u=${user.id}`} className="font-medium text-primary-bright hover:underline">
            {userLabel}
          </Link>
        ) : (
          <span className="font-medium text-foreground">{userLabel}</span>
        )}
        {user?.username ? (
          <Button asChild variant="ghost" size="sm" className="ml-auto h-8">
            <Link href={`/profile/${user.username}`}>View profile</Link>
          </Button>
        ) : null}
      </div>

      <Conversation messages={[]} viewer="admin" userLabel={userLabel} feedback={feedback} />

      <div className="flex flex-col gap-3 border-t border-border/50 pt-4">
        {user ? (
          <>
            <p className="text-sm text-muted">
              Nothing has been sent yet. Your reply starts the conversation: {userLabel} gets a notification and finds it under
              Messages.
            </p>
            <ReplyForm feedbackId={feedback.id} side="admin" placeholder="Reply as the PipGlyph team…" />
          </>
        ) : (
          <p className="text-sm text-muted">The account that sent this was deleted, so there is nobody to reply to.</p>
        )}
      </div>
    </SurfaceCard>
  );
}
