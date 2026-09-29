import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SurfaceCard } from "@/components/ui/surface-card";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getMyEmailPreferences } from "@/lib/email/preferences";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { drawableMediaUrl } from "@/lib/media/media-urls";

export const metadata: Metadata = {
  title: "Set up your profile",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// A new account's first stop: the (app) layout redirects here while
// profiles.onboarded_at is NULL (migration 0095). Finishing or skipping sets
// it and the wizard sends the user on to `next`.
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (!isSupabaseConfigured()) redirect("/login");
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirectTo=/onboarding");
  const profile = await getCurrentProfile();
  if (!profile) redirect("/dashboard");
  if (profile.onboarded_at) redirect(safeRedirectPath(next));

  const email = await getMyEmailPreferences();

  return (
    <SurfaceCard tone="gold" className="flex flex-col gap-8 p-6 sm:p-8">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          Welcome to PipGlyph
        </p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Set up your profile
        </h1>
        <p className="text-sm leading-6 text-muted">
          Three quick steps — a minute at most. Everything can be changed later
          in settings.
        </p>
      </div>
      <OnboardingWizard
        initial={{
          username: profile.username,
          displayName: profile.display_name ?? "",
          bio: profile.bio ?? "",
          // Only drawable pictures (migration 0127, lib/media/media-urls.ts).
          avatarUrl: drawableMediaUrl("avatar", profile.avatar_url, profile.id),
          bannerUrl: drawableMediaUrl("banner", profile.banner_url, profile.id),
          email: {
            account: email.account,
            activity: email.activity,
            newsletter: email.newsletter,
          },
        }}
        next={safeRedirectPath(next)}
      />
    </SurfaceCard>
  );
}
