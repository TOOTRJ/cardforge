import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { EmptyState } from "@/components/ui/empty-state";
import { listNotifications, markAllNotificationsSeen } from "@/lib/notifications/queries";
import { getCurrentProfile } from "@/lib/supabase/server";
import { NotificationsSeen } from "@/components/notifications/notifications-seen";
import { NotificationRow } from "@/components/notifications/notification-row";

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const [items, profile] = await Promise.all([listNotifications(50), getCurrentProfile()]);
  const isAdmin = Boolean(profile?.is_admin);
  // Viewing the page is the acknowledgement (same as opening the bell): the
  // list above was read BEFORE this write, so the new items keep their
  // highlight for this visit, while the dashboard count (rendered below,
  // after this await) is already zero.
  if (items.some((item) => !item.readAt)) await markAllNotificationsSeen();

  return (
    <DashboardShell>
      <NotificationsSeen />
      <PageHeader
        eyebrow="Activity"
        title="Notifications"
        description="Likes, comments, remixes — and messages, credits and plan changes from the PipGlyph team."
      />

      <div className="mt-8">
        {items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            description="When someone likes, comments on, or remixes your cards, it'll show up here."
          />
        ) : (
          <SurfaceCard className="divide-y divide-border/60 p-0">
            {items.map((item) => (
              <NotificationRow key={item.id} item={item} isAdmin={isAdmin} />
            ))}
          </SurfaceCard>
        )}
      </div>
    </DashboardShell>
  );
}

