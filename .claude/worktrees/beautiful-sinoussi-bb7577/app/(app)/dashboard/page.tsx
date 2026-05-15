import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilePlus2, UserCog } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { DashboardSelectableSections } from "@/components/creator/dashboard-selectable-sections";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { listMyCards } from "@/lib/cards/queries";
import { listMySets } from "@/lib/sets/queries";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your CardForge workspace.",
};

export default async function DashboardPage() {
  // User + profile lookups are cheap (single-row); fetch them in parallel
  // so the header/profile-warning render immediately. The cards listing
  // (more expensive) suspends below with a skeleton fallback.
  const [user, profile] = await Promise.all([
    getCurrentUser(),
    getCurrentProfile(),
  ]);

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
        description="A snapshot of your cards, drafts, and sets. Click any card to edit it."
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

      <Suspense fallback={<DashboardCardsSkeleton />}>
        <DashboardCards />
      </Suspense>

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

// ---------------------------------------------------------------------------
// Cards-dependent section. Splits out from the page shell so the (cheap)
// header + profile warning paint immediately and the (more expensive)
// listMyCards() query streams in behind a skeleton.
// ---------------------------------------------------------------------------

async function DashboardCards() {
  // Cards + sets in parallel — sets feed the bulk "Add to set" picker so
  // the dashboard doesn't need a follow-up client fetch when the user
  // opens it.
  const [myCards, mySets] = await Promise.all([listMyCards(), listMySets()]);
  const drafts = myCards.filter((c) => c.visibility === "private");
  const publicCards = myCards.filter((c) => c.visibility === "public");
  const recentCards = myCards.slice(0, 6);

  const stats = [
    {
      label: "Cards",
      value: String(myCards.length),
      helper: "Saved drafts and published cards",
    },
    {
      label: "Public",
      value: String(publicCards.length),
      helper: "Listed in the gallery",
    },
    {
      label: "Drafts",
      value: String(drafts.length),
      helper: "Private, in-progress cards",
    },
  ];

  // Trim set rows down to what the picker dialog actually consumes — the
  // full `CardSetWithCount` carries description / cover / etc. that we
  // don't want serialized down to the client.
  const setSummaries = mySets.map((s) => ({
    id: s.id,
    title: s.title,
    slug: s.slug,
  }));

  return (
    <>
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

      <DashboardSelectableSections
        recentCards={recentCards}
        drafts={drafts}
        publicCards={publicCards}
        userSets={setSummaries}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Skeleton fallback for <DashboardCards>. Mirrors the stats grid + three
// section headers + 3 card placeholders per section so the layout is
// stable from the moment the shell paints.
// ---------------------------------------------------------------------------

function DashboardCardsSkeleton() {
  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SurfaceCard key={i} className="p-6">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-3/4" />
          </SurfaceCard>
        ))}
      </div>
      {["Recent cards", "Drafts", "Public cards"].map((title) => (
        <section key={title} className="mt-12">
          <header className="mb-4">
            <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
          </header>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <CardPreviewSkeleton key={i} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
