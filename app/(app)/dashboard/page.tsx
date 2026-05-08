import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, FolderOpen, Globe2, Pencil, UserCog } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreviewPlaceholder } from "@/components/cards/card-preview-placeholder";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your CardForge workspace.",
};

const stats = [
  { label: "Cards", value: "0", helper: "Saved drafts and published cards" },
  { label: "Sets", value: "0", helper: "Custom sets you’ve organized" },
  { label: "Likes", value: "0", helper: "Coming soon: community love" },
];

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();
  const greetingName =
    profile?.display_name ||
    profile?.username ||
    user?.email?.split("@")[0] ||
    "Forgemaster";
  const profileIncomplete = !profile?.username;

  return (
    <DashboardShell>
      <PageHeader
        eyebrow="Workspace"
        title={`Welcome back, ${greetingName}`}
        description="A snapshot of your cards, drafts, and sets. Card creation goes live in Phase 4 — for now this workspace is wired to your real account."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/sets">My sets</Link>
            </Button>
            <Button asChild>
              <Link href="/create">
                <FilePlus2 className="h-4 w-4" aria-hidden /> New card
              </Link>
            </Button>
          </>
        }
      />

      {profileIncomplete ? (
        <SurfaceCard className="mt-6 flex flex-col gap-3 border-accent/40 bg-accent/10 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated text-accent">
              <UserCog className="h-4 w-4" aria-hidden />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-display text-sm font-semibold text-foreground">
                Finish your profile
              </p>
              <p className="text-xs leading-5 text-muted">
                Pick a username so other forgers can find you. You can change it
                later in settings.
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link href="/settings">Complete profile</Link>
          </Button>
        </SurfaceCard>
      ) : null}

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <SurfaceCard key={stat.label} className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
              {stat.label}
            </p>
            <p className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground">
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-muted">{stat.helper}</p>
          </SurfaceCard>
        ))}
      </div>

      <DashboardSection
        title="Recent cards"
        description="Your most recently edited drafts and published cards will appear here once card data is wired up."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/gallery">View gallery</Link>
          </Button>
        }
      >
        <EmptyState
          icon={Pencil}
          title="No cards yet"
          description="Open the creator and forge your very first card. Saved drafts will surface here automatically."
          action={
            <Button asChild>
              <Link href="/create">Open creator</Link>
            </Button>
          }
        />
      </DashboardSection>

      <DashboardSection
        title="Drafts"
        description="Private, in-progress cards you haven’t published."
      >
        <EmptyState
          icon={FolderOpen}
          title="No drafts"
          description="Drafts you save while creating will live here until you publish."
        />
      </DashboardSection>

      <DashboardSection
        title="Public cards"
        description="Cards visible on your public profile and the gallery."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardPreviewPlaceholder
            card={{
              title: "Forge Sample I",
              cost: "{1}{R}",
              cardType: "creature",
              rarity: "uncommon",
              colorIdentity: "red",
              artistCredit: greetingName,
            }}
          />
          <CardPreviewPlaceholder
            card={{
              title: "Forge Sample II",
              cost: "{2}{G}",
              cardType: "spell",
              rarity: "common",
              colorIdentity: "green",
              artistCredit: greetingName,
            }}
          />
          <SurfaceCard className="flex aspect-[5/7] flex-col items-center justify-center gap-3 border-dashed p-6 text-center">
            <Globe2 className="h-6 w-6 text-primary" aria-hidden />
            <p className="font-display text-sm font-semibold text-foreground">
              Publish your work
            </p>
            <p className="text-xs leading-5 text-muted">
              Public visibility ships with the sharing phase. Sample cards
              shown here are placeholders.
            </p>
          </SurfaceCard>
        </div>
      </DashboardSection>

      <SurfaceCard className="mt-12 flex flex-col gap-3 p-6">
        <Badge variant="outline" className="self-start">
          Account
        </Badge>
        <p className="text-sm text-muted">
          Signed in as{" "}
          <span className="font-mono text-foreground">{user?.email ?? "unknown"}</span>
          {profile?.username ? (
            <>
              {" "}· profile{" "}
              <Link
                href={`/profile/${profile.username}`}
                className="font-mono text-primary hover:underline"
              >
                @{profile.username}
              </Link>
            </>
          ) : null}
        </p>
      </SurfaceCard>
    </DashboardShell>
  );
}

function DashboardSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <header className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
