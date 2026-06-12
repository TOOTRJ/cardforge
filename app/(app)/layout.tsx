import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CommandPalette } from "@/components/layout/command-palette";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getCreditsUsedThisMonth } from "@/lib/ai/usage-queries";
import { isBillingEnabled } from "@/lib/billing/flags";
import { getUnreadNotificationCount } from "@/lib/notifications/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const configured = isSupabaseConfigured();
  const user = configured ? await getCurrentUser() : null;

  // Defense in depth — middleware should already have redirected unauthed
  // users away from /(app)/* routes.
  if (configured && !user) {
    redirect("/login");
  }

  // The four chrome lookups are independent — run them concurrently
  // instead of serially (same data, ~one round-trip of latency instead
  // of four).
  const [profile, entitlements, creditsUsed, unreadNotifications] = user
    ? await Promise.all([
        getCurrentProfile(),
        getEntitlements(),
        isBillingEnabled() ? getCreditsUsedThisMonth() : Promise.resolve(0),
        getUnreadNotificationCount(),
      ])
    : [null, null, 0, 0];

  return (
    <AppShell
      variant="app"
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
              isAdmin: profile?.is_admin ?? false,
            }
          : null
      }
    >
      {children}
      {/* Global ⌘K palette — mounted once for all authenticated routes
          so the keyboard shortcut works from anywhere in the app group.
          Marketing routes are intentionally out of scope. */}
      <CommandPalette username={profile?.username ?? null} />
    </AppShell>
  );
}
