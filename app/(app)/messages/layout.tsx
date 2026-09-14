import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { ThreadList } from "@/components/messages/thread-list";
import { listMyThreads } from "@/lib/messages/queries";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// /messages — the user's inbox shell: conversation rail on the left (desktop)
// with the selected thread on the right. On phones the rail is the index
// page and a thread is its own page (see page.tsx / [threadId]/page.tsx).
// ---------------------------------------------------------------------------

export default async function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const threads = await listMyThreads();
  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Support"
        title="Messages"
        description="Conversations with the PipGlyph team. We'll notify you here and by email when we reply."
      />
      <div className="mt-6 grid gap-4 lg:grid-cols-[300px_1fr]">
        <SurfaceCard as="aside" className="hidden overflow-hidden p-0 lg:block">
          {threads.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No conversations yet.</p>
          ) : (
            <ThreadList threads={threads} basePath="/messages" />
          )}
        </SurfaceCard>
        <div className="min-w-0">{children}</div>
      </div>
    </DashboardShell>
  );
}
