import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/auth/profile-form";
import { ProfileMediaUploader } from "@/components/auth/profile-media-uploader";
import { PinnedCardsPicker } from "@/components/auth/pinned-cards-picker";
import { UsagePanel } from "@/components/settings/usage-panel";
import { BillingPanel } from "@/components/settings/billing-panel";
import { BillingReturnToast } from "@/components/billing/billing-return-toast";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import { isBillingEnabled } from "@/lib/billing/flags";
import { listPublicCardsByOwner } from "@/lib/cards/queries";

export const metadata: Metadata = {
  title: "Settings",
  description: "Manage your Spellwright profile and preferences.",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();
  const entitlements = await getEntitlements();
  const renewLabel = entitlements.currentPeriodEnd
    ? new Date(entitlements.currentPeriodEnd).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  const profileIncomplete = !profile?.username;

  return (
    <DashboardShell>
      {isBillingEnabled() ? (
        <Suspense fallback={null}>
          <BillingReturnToast />
        </Suspense>
      ) : null}
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
              Avatar & banner
            </h3>
            <p className="text-sm leading-6 text-muted">
              Customize the imagery on your public profile. PNG, JPEG, WebP,
              or GIF, up to 8 MB.
            </p>
          </div>
          <div className="flex flex-col gap-6 sm:flex-row">
            <ProfileMediaUploader
              kind="avatar"
              currentUrl={profile?.avatar_url ?? null}
              label="Avatar"
              hint="Square crops look best — 256×256 or larger."
              previewClassName="aspect-square w-32"
            />
            <div className="flex-1">
              <ProfileMediaUploader
                kind="banner"
                currentUrl={profile?.banner_url ?? null}
                label="Banner"
                hint="Wide aspect (≈ 4:1). Renders at the top of your profile."
                previewClassName="aspect-[4/1] w-full"
              />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="grid gap-6 p-6 sm:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Public profile
            </h3>
            <p className="text-sm leading-6 text-muted">
              Your identity, bio, accent color, and social links appear on
              your profile page and next to every card you publish.
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
              accent_color: profile?.accent_color ?? "",
              twitter_url: profile?.twitter_url ?? "",
              bluesky_url: profile?.bluesky_url ?? "",
              instagram_url: profile?.instagram_url ?? "",
              youtube_url: profile?.youtube_url ?? "",
              tiktok_url: profile?.tiktok_url ?? "",
              discord_url: profile?.discord_url ?? "",
              github_url: profile?.github_url ?? "",
            }}
          />
        </SurfaceCard>

        <SurfaceCard className="grid gap-6 p-6 sm:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-1">
            <h3 className="font-display text-lg font-semibold text-foreground">
              Pinned cards
            </h3>
            <p className="text-sm leading-6 text-muted">
              Pin up to three public cards to the top of your profile. New
              visitors see these first.
            </p>
          </div>
          <Suspense fallback={<PinnedSkeleton />}>
            <PinnedCardsSection
              userId={user?.id ?? null}
              initialPinned={profile?.pinned_card_ids ?? []}
            />
          </Suspense>
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

        {isBillingEnabled() ? (
          <SurfaceCard
            id="billing"
            className="grid scroll-mt-24 gap-6 p-6 sm:grid-cols-[1fr_2fr]"
          >
            <div className="flex flex-col gap-1">
              <h3 className="font-display text-lg font-semibold text-foreground">
                Subscription &amp; billing
              </h3>
              <p className="text-sm leading-6 text-muted">
                Your plan, renewal, and AI credit balance. Manage or cancel any
                time through the secure Stripe portal.
              </p>
            </div>
            <BillingPanel
              tier={entitlements.tier}
              isPaid={entitlements.isPaid}
              status={entitlements.status}
              credits={entitlements.credits}
              renewLabel={renewLabel}
              cancelAtPeriodEnd={entitlements.cancelAtPeriodEnd}
            />
          </SurfaceCard>
        ) : null}

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
          <Suspense fallback={<UsagePanelSkeleton />}>
            <UsagePanel />
          </Suspense>
        </SurfaceCard>
      </div>
    </DashboardShell>
  );
}

async function PinnedCardsSection({
  userId,
  initialPinned,
}: {
  userId: string | null;
  initialPinned: string[];
}) {
  if (!userId) {
    return (
      <p className="text-sm text-muted">Sign in to pin cards to your profile.</p>
    );
  }
  const cards = await listPublicCardsByOwner(userId, { limit: 48 });
  return <PinnedCardsPicker cards={cards} initialPinned={initialPinned} />;
}

function PinnedSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="aspect-[3/4] w-full rounded-md" />
      ))}
    </div>
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
