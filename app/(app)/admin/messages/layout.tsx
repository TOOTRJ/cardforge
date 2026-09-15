import { notFound } from "next/navigation";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { getAdminUnreadThreadCount, listAllThreads } from "@/lib/messages/queries";
import { isUserEmailConfigured } from "@/lib/messages/notify";

export const dynamic = "force-dynamic";

// /admin/messages — the team inbox shell. The rail (all threads, newest
// activity first, unread-for-admin badges) renders in the pages themselves
// so the filter tabs can drive it; this layout owns the header + gate.
export default async function AdminMessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Non-admins get a 404 (don't reveal the route exists).
  const threads = await listAllThreads("all");
  if (threads === null) notFound();
  const unread = await getAdminUnreadThreadCount();

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Admin · Messages"
        title="Conversations"
        description={
          isUserEmailConfigured()
            ? "Every thread between the team and a user. Replies reach the user's Messages tab, their notification bell, and their email."
            : "Every thread between the team and a user. Replies reach the user's Messages tab and notification bell. Email is OFF — set RESEND_API_KEY and a verified ADMIN_ALERT_FROM to also email them."
        }
        actions={
          unread > 0 ? <Badge variant="primary">{unread} awaiting reply</Badge> : null
        }
      />
      <div className="mt-6">{children}</div>
    </DashboardShell>
  );
}
