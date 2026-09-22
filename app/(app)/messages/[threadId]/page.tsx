import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { Conversation } from "@/components/messages/conversation";
import { ReplyForm } from "@/components/messages/reply-form";
import { MarkThreadRead } from "@/components/messages/mark-thread-read";
import { getMyThread } from "@/lib/messages/queries";
import { isUuid } from "@/lib/ids";

export const dynamic = "force-dynamic";

type Params = { threadId: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { threadId } = await params;
  const thread = isUuid(threadId) ? await getMyThread(threadId) : null;
  return {
    title: thread ? `${thread.subject} — Messages` : "Messages",
    robots: { index: false, follow: false },
  };
}

export default async function MessageThreadPage({ params }: { params: Promise<Params> }) {
  const { threadId } = await params;
  if (!isUuid(threadId)) notFound();
  const thread = await getMyThread(threadId);
  if (!thread) notFound();

  return (
    <SurfaceCard className="flex flex-col gap-5 p-5">
      <MarkThreadRead threadId={thread.id} side="user" hasUnread={thread.unreadCount > 0} />
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/messages"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All messages
        </Link>
        <h2 className="min-w-0 flex-1 font-display text-lg font-semibold text-foreground">
          {thread.subject}
        </h2>
        <Badge variant={thread.status === "open" ? "primary" : "outline"}>
          {thread.status === "open" ? "Open" : "Closed"}
        </Badge>
      </div>

      <Conversation
        messages={thread.messages}
        viewer="user"
        feedback={thread.feedback}
      />

      <div className="border-t border-border/50 pt-4">
        <ReplyForm threadId={thread.id} side="user" closed={thread.status === "closed"} />
      </div>
    </SurfaceCard>
  );
}
