import { DashboardNav } from "@/components/layout/dashboard-nav";
import { getCurrentProfile } from "@/lib/supabase/server";
import {
  getAdminUnreadThreadCount,
  getMessageNavState,
} from "@/lib/messages/queries";
import { countNewFeedback } from "@/lib/feedback/queries";
import { getUnreadNotificationCount } from "@/lib/notifications/queries";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";

type DashboardShellProps = {
  children: React.ReactNode;
  className?: string;
  /** A page of forms and short lines (Settings, Notifications, Feedback, AI
   *  usage, Messages; the admin inbox, updates, challenges and creator lab):
   *  its column stops at 1024 px, so an input or a row never runs 1,600 px
   *  on a wide screen. */
  readable?: boolean;
};

// Server component: resolves the caller's profile once (getCurrentProfile is
// request-cached) so the rail can show the Admin section on every dashboard
// page for admins — not just on the admin pages themselves.
//
// The WIDE frame (TODO WD4): My Cards, My Decks, the overview, the feed,
// billing and the admin tables are workspaces — more width is more columns,
// not longer lines. The rail sits at the frame's left edge on every
// dashboard page; a `readable` page caps its own column instead.
export async function DashboardShell({
  children,
  className,
  readable = false,
}: DashboardShellProps) {
  const profile = await getCurrentProfile();
  const isAdmin = Boolean(profile?.is_admin);
  // "Messages" only exists for users the team has written to; the badge is
  // their unread admin posts. Admins also get the inbox's awaiting-reply
  // count. Both reads are request-cached (shared with the app layout).
  const [messages, adminUnread, newFeedback, unreadNotifications] = await Promise.all([
    getMessageNavState(),
    isAdmin ? getAdminUnreadThreadCount() : Promise.resolve(0),
    isAdmin ? countNewFeedback() : Promise.resolve(0),
    getUnreadNotificationCount(),
  ]);

  return (
    <PageContainer size="wide" className="py-8">
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        {/* min-w-0: a grid item defaults to min-width:auto, which lets the
            nav's one-line mobile strip widen the whole page instead of
            scrolling inside its own overflow-x-auto. */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <DashboardNav
            isAdmin={isAdmin}
            showMessages={messages.hasThreads}
            badges={{
              "/notifications": unreadNotifications,
              "/messages": messages.unread,
              "/admin/messages": adminUnread,
              "/admin/feedback": newFeedback,
            }}
          />
        </aside>

        <div className={cn("min-w-0", readable && "max-w-5xl", className)}>{children}</div>
      </div>
    </PageContainer>
  );
}
