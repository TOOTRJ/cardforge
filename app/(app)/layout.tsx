import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getCreditsUsedThisMonth } from "@/lib/ai/usage-queries";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getUnreadNotificationCount } from "@/lib/notifications/queries";
import { getMessageNavState } from "@/lib/messages/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const configured = isSupabaseConfigured();
  const user = configured ? await getCurrentUser() : null;

  // Defense in depth — middleware redirects unauthed users (with a
  // redirectTo) only for its PROTECTED_PREFIXES (/dashboard, /create,
  // /settings); the other (app) routes (/feed, /notifications, /feedback,
  // /deck, /set, /card, /admin) rely on this bare redirect and lose the
  // return path.
  if (configured && !user) {
    redirect("/login");
  }

  // The chrome lookups are independent — run them concurrently instead of
  // serially (same data, ~one round-trip of latency instead of five).
  const [profile, entitlements, creditsUsed, unreadNotifications, messages] = user
    ? await Promise.all([
        getCurrentProfile(),
        getEntitlements(),
        isBillingEnabled() ? getCreditsUsedThisMonth() : Promise.resolve(0),
        getUnreadNotificationCount(),
        getMessageNavState(),
      ])
    : [null, null, 0, 0, { hasThreads: false, unread: 0 }];

  return (
    <AppShell
      user={
        user
          ? {
              username: profile?.username ?? null,
              displayName: profile?.display_name ?? null,
              avatarUrl: profile?.avatar_url ?? null,
              isPaid: entitlements?.isPaid ?? false,
              credits: entitlements?.credits ?? 0,
              creditsUsed,
              unreadNotifications,
              hasMessages: messages.hasThreads,
              unreadMessages: messages.unread,
              isAdmin: profile?.is_admin ?? false,
            }
          : null
      }
    >
      {children}
    </AppShell>
  );
}
