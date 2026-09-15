import { DashboardNav } from "@/components/layout/dashboard-nav";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getAdminUnreadThreadCount,
  getMessageNavState,
} from "@/lib/messages/queries";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  children: React.ReactNode;
  className?: string;
};

// Server component: resolves the caller's profile once (getCurrentProfile is
// request-cached) so the rail can show the Admin section on every dashboard
// page for admins — not just on the admin pages themselves.
export async function DashboardShell({
  children,
  className,
}: DashboardShellProps) {
  const profile = await getCurrentProfile();
  const isAdmin = Boolean(profile?.is_admin);
  // "Messages" only exists for users the team has written to; the badge is
  // their unread admin posts. Admins also get the inbox's awaiting-reply
  // count. Both reads are request-cached (shared with the app layout).
  const [messages, adminUnread] = await Promise.all([
    getMessageNavState(),
    isAdmin ? getAdminUnreadThreadCount() : Promise.resolve(0),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <DashboardNav
            isAdmin={isAdmin}
            showMessages={messages.hasThreads}
            badges={{ "/messages": messages.unread, "/admin/messages": adminUnread }}
          />
        </aside>

        <div className={cn("min-w-0", className)}>{children}</div>
      </div>
    </div>
  );
}
