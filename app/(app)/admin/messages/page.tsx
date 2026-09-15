import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { ThreadList } from "@/components/messages/thread-list";
import { listAllThreads, type AdminThreadFilter } from "@/lib/messages/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Conversations",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: AdminThreadFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "unread", label: "Needs reply" },
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
];

export default async function AdminMessagesIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const active: AdminThreadFilter = (FILTERS.some((f) => f.key === filter)
    ? filter
    : "all") as AdminThreadFilter;
  const threads = await listAllThreads(active);
  if (threads === null) notFound();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/admin/messages" : `/admin/messages?filter=${f.key}`}
            aria-current={active === f.key ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
              active === f.key
                ? "border-primary/60 bg-primary/15 text-foreground"
                : "border-border/50 text-muted hover:border-border-strong hover:text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {threads.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={active === "unread" ? "Nothing awaiting a reply" : "No conversations yet"}
          description="Start one from a user's page (Users → Message) or reply to a feedback submission."
        />
      ) : (
        <SurfaceCard className="overflow-hidden p-0">
          <ThreadList threads={threads} basePath="/admin/messages" />
        </SurfaceCard>
      )}
    </div>
  );
}
