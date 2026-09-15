import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { ThreadList } from "@/components/messages/thread-list";
import { listMyThreads } from "@/lib/messages/queries";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function MessagesIndexPage() {
  const threads = await listMyThreads();

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No messages yet"
        description="When the PipGlyph team writes to you — usually in reply to your feedback — the conversation shows up here."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/feedback">Send feedback</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      {/* Phones: the rail IS the index. */}
      <SurfaceCard className="overflow-hidden p-0 lg:hidden">
        <ThreadList threads={threads} basePath="/messages" />
      </SurfaceCard>
      {/* Desktop: the rail is in the layout; prompt to pick one. */}
      <SurfaceCard className="hidden items-center justify-center p-10 text-center lg:flex">
        <p className="text-sm text-muted">Pick a conversation to read it.</p>
      </SurfaceCard>
    </>
  );
}
