import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/auth/profile-form";
import { UsagePanel } from "@/components/settings/usage-panel";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your CardForge profile and preferences.",
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
            <Row label="Theme" value="Switch via the header toggle" />
          </div>
        </SurfaceCard>

        <SurfaceCard className="grid gap-6 p-6 sm:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Usage
            </h3>
            <p className="text-sm leading-6 text-muted">
              Live counters and a 30-day trend for AI assistant calls and
              Scryfall lookups. Quotas reset on a rolling basis — there&apos;s
              no calendar-day cut-off.
            </p>
          </div>
          {/* Suspend the usage queries so the profile + preferences cards
              paint immediately; the usage tile streams in behind a
              skeleton. */}
          <Suspense fallback={<UsagePanelSkeleton />}>
            <UsagePanel />
          </Suspense>
        </SurfaceCard>
      </div>
    </DashboardShell>
  );
}

function UsagePanelSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[0, 1].map((i) => (
        <SurfaceCard key={i} className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-3">
            <Skeleton shape="circle" className="h-9 w-9" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2.5 w-3/4" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
          <Skeleton className="h-16" />
        </SurfaceCard>
      ))}
    </div>
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
