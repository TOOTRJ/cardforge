import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserCircle } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Conversation } from "@/components/messages/conversation";
import { ReplyForm } from "@/components/messages/reply-form";
import { MarkThreadRead } from "@/components/messages/mark-thread-read";
import { ThreadStatusButtons } from "@/components/admin/thread-status-buttons";
import { getThreadForAdmin } from "@/lib/messages/queries";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { threadId: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { threadId } = await params;
  const thread = UUID_PATTERN.test(threadId) ? await getThreadForAdmin(threadId) : null;
  return {
    title: thread ? `${thread.subject} — Conversations` : "Conversations",
    robots: { index: false, follow: false },
  };
}

export default async function AdminThreadPage({ params }: { params: Promise<Params> }) {
  const { threadId } = await params;
  if (!UUID_PATTERN.test(threadId)) notFound();
  const thread = await getThreadForAdmin(threadId);
  if (!thread) notFound();

  const userLabel =
    thread.user.displayName || (thread.user.username ? `@${thread.user.username}` : "Unknown user");

  return (
    <SurfaceCard className="flex flex-col gap-5 p-5">
      <MarkThreadRead threadId={thread.id} side="admin" hasUnread={thread.unreadCount > 0} />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/messages"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All conversations
        </Link>
        <h2 className="min-w-0 flex-1 basis-full font-display text-lg font-semibold text-foreground sm:basis-auto">
          {thread.subject}
        </h2>
        <Badge variant={thread.status === "open" ? "primary" : "outline"}>
          {thread.status === "open" ? "Open" : "Closed"}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-elevated/30 px-4 py-2 text-sm">
        <UserCircle className="h-4 w-4 text-subtle" aria-hidden />
        <span className="text-muted">With</span>
        <Link
          href={`/admin/users?u=${thread.user.id}`}
          className="font-medium text-primary-bright hover:underline"
        >
          {userLabel}
        </Link>
        {thread.user.username ? (
          <Button asChild variant="ghost" size="sm" className="ml-auto h-8">
            <Link href={`/profile/${thread.user.username}`}>View profile</Link>
          </Button>
        ) : null}
        <ThreadStatusButtons threadId={thread.id} status={thread.status} />
      </div>

      <Conversation
        messages={thread.messages}
        viewer="admin"
        userLabel={userLabel}
        adminNames={thread.adminNames}
        feedback={thread.feedback}
        seenAt={thread.userLastReadAt}
      />

      <div className="border-t border-border/50 pt-4">
        <ReplyForm
          threadId={thread.id}
          side="admin"
          closed={thread.status === "closed"}
          placeholder="Reply as the PipGlyph team…"
        />
      </div>
    </SurfaceCard>
  );
}
