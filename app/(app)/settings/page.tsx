import type { Metadata } from "next";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/auth/profile-form";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Spellwright profile and preferences.",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();

  const profileIncomplete = !profile?.username;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your public profile and account."
        actions={
          profileIncomplete ? (
            <Badge variant="accent">Profile incomplete</Badge>
          ) : (
            <Badge variant="primary">Profile complete</Badge>
          )
        }
      />

      <div className="mt-10 grid gap-4">
        <SurfaceCard className="grid gap-6 p-6 sm:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Public profile
            </h3>
            <p className="text-sm leading-6 text-muted">
              Your username, display name, and bio appear on your profile page
              and next to every card you publish.
            </p>
            {profileIncomplete ? (
              <p className="mt-2 text-xs leading-5 text-accent">
                Pick a username so creators can find you in the gallery.
              </p>
            ) : null}
          </div>
          <ProfileForm
            email={user?.email ?? ""}
            defaultValues={{
              username: profile?.username ?? "",
              display_name: profile?.display_name ?? "",
              bio: profile?.bio ?? "",
              website_url: profile?.website_url ?? "",
            }}
          />
        </SurfaceCard>

        <SurfaceCard className="grid gap-6 p-6 sm:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Preferences
            </h3>
            <p className="text-sm leading-6 text-muted">
              Editor defaults applied to new cards. Editable preferences arrive
              with the Creator MVP phase.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Row label="Default visibility" value="Private" />
            <Row label="Default rarity" value="Common" />
            <Row label="Theme" value="Dark (always on)" />
          </div>
        </SurfaceCard>
      </div>
    </DashboardShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
