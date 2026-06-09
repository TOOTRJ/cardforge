import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { getCreditsUsedThisMonth } from "@/lib/ai/usage-queries";
import { isBillingEnabled } from "@/lib/billing/flags";

export const dynamic = "force-dynamic";

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const profile = user ? await getCurrentProfile() : null;
  const entitlements = user ? await getEntitlements() : null;
  const creditsUsed =
    user && isBillingEnabled() ? await getCreditsUsedThisMonth() : 0;

  return (
    <AppShell
      variant="marketing"
      user={
        user
          ? {
              username: profile?.username ?? null,
              displayName: profile?.display_name ?? null,
              avatarUrl: profile?.avatar_url ?? null,
              isPaid: entitlements?.isPaid ?? false,
              credits: entitlements?.credits ?? 0,
              creditsUsed,
              isAdmin: profile?.is_admin ?? false,
            }
          : null
      }
    >
      {children}
    </AppShell>
  );
}
