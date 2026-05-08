import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
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

  const profile = user ? await getCurrentProfile() : null;

  return (
    <AppShell
      variant="app"
      user={
        user
          ? {
              username: profile?.username ?? null,
              displayName: profile?.display_name ?? null,
            }
          : null
      }
    >
      {children}
    </AppShell>
  );
}
