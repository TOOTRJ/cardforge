import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilePlus2, Globe, Layers, Palette, UserCog } from "lucide-react";
import { CompassStar } from "@/components/ui/compass-star";
import { IconTile } from "@/components/ui/icon-tile";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { DashboardSelectableSections } from "@/components/creator/dashboard-selectable-sections";
import { CreditsSummaryCard } from "@/components/dashboard/credits-summary";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { getPipOverrides } from "@/lib/pips/queries";
import { CUSTOM_PIP_SYMBOLS as PIP_STRIP_SYMBOLS } from "@/lib/pips/override";
import { listLikedCardsByUser, listMyCards } from "@/lib/cards/queries";
import { listMySets } from "@/lib/sets/queries";
import { LikedCardsSection } from "@/components/creator/liked-cards-section";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your PipGlyph workspace.",
};

const QUICK_ACTIONS = [
  {
    title: "New card",
    helper: "Start from scratch",
    href: "/create",
    tone: "gold" as const,
    icon: <FilePlus2 aria-hidden />,
  },
  {
    title: "My sets",
    helper: "Group cards into sets",
    href: "/dashboard/sets",
    tone: "purple" as const,
    icon: <Layers aria-hidden />,
  },
  {
    title: "Custom pips",
    helper: "Upload your own icons",
    href: "/settings",
    tone: "ember" as const,
    icon: <Palette aria-hidden />,
  },
  {
    title: "Explore gallery",
    helper: "Find the community's best",
    href: "/gallery",
    tone: "gold" as const,
    icon: <Globe aria-hidden />,
  },
];

export default async function DashboardPage() {
  // User + profile lookups are cheap (single-row); fetch them in parallel
  // so the header/profile-warning render immediately. The cards listing
  // (more expensive) suspends below with a skeleton fallback.
  const [user, profile] = await Promise.all([
    getCurrentUser(),
    getCurrentProfile(),
  ]);
  const pipOverrides = user ? await getPipOverrides(user.id) : {};

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
              <Link href="/dashboard/sets">My sets</Link>
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

      {/* AI credits — remaining balance, used this month, monthly allotment.
          Independent data, so it streams in behind its own skeleton. */}
      <Suspense fallback={<CreditsSummarySkeleton />}>
        <CreditsSummaryCard />
      </Suspense>

      {/* Quick actions — the mockup's tile row, mapped to real routes. */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.title}
            href={action.href}
            className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <SurfaceCard className="flex h-full items-center gap-3 p-4 transition-colors group-hover:border-gold/40">
              <IconTile tone={action.tone}>{action.icon}</IconTile>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-foreground">
                  {action.title}
                </span>
                <span className="truncate text-xs text-muted">
                  {action.helper}
                </span>
              </div>
            </SurfaceCard>
          </Link>
        ))}
      </div>

      <Suspense fallback={<DashboardCardsSkeleton />}>
        <DashboardCards />
      </Suspense>

      <div className="mt-12 grid gap-4 lg:grid-cols-2">
        <SurfaceCard className="flex flex-col gap-3 p-6">
          <Badge variant="gold" className="self-start">
            Custom pips
          </Badge>
          <p className="flex flex-1 items-center text-sm text-muted">
            Your pip icons:
            {PIP_STRIP_SYMBOLS.map((s) => {
              const url = pipOverrides[s];
              return url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={s}
                  src={url}
                  alt={`Custom ${s} pip`}
                  className="mx-0.5 inline-block h-5 w-5 rounded-full object-cover shadow-[-1px_1px_0_#111]"
                />
              ) : (
                <i
                  key={s}
                  className={`ms ms-${s.toLowerCase()} ms-cost ms-shadow mx-0.5`}
                  aria-label={`Standard ${s} pip`}
                  style={{ fontSize: 15 }}
                />
              );
            })}
          </p>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/settings">Manage in Settings</Link>
          </Button>
        </SurfaceCard>

        <SurfaceCard className="flex flex-col gap-3 p-6">
          <Badge variant="outline" className="self-start">
            Account
          </Badge>
          <p className="text-sm text-muted">
            Signed in as{" "}
            <span className="font-mono text-foreground">
              {user?.email ?? "unknown"}
            </span>
            {profile?.username ? (
              <>
                {" "}· profile{" "}
                <Link
                  href={`/profile/${profile.username}`}
                  className="font-mono text-primary-bright hover:underline"
                >
                  @{profile.username}
                </Link>
              </>
            ) : null}
          </p>
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/settings">Account settings</Link>
          </Button>
        </SurfaceCard>
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Cards-dependent section. Splits out from the page shell so the (cheap)
// header + profile warning paint immediately and the (more expensive)
// listMyCards() query streams in behind a skeleton.
// ---------------------------------------------------------------------------

async function DashboardCards() {
  // Cards + sets + liked cards in parallel. Sets feed the bulk "Add to set"
  // picker; liked cards feed the new "Liked cards" section below.
  const viewer = await getCurrentUser();
  const [myCards, mySets, likedCards] = await Promise.all([
    listMyCards(),
    listMySets(),
    viewer ? listLikedCardsByUser(viewer.id) : Promise.resolve([]),
  ]);
  const drafts = myCards.filter((c) => c.visibility === "private");
  const publicCards = myCards.filter((c) => c.visibility === "public");
  const recentCards = myCards.slice(0, 6);

  const stats = [
    {
      label: "Cards",
      value: String(myCards.length),
      helper: "Saved drafts and published cards",
      tone: "gold" as const,
      icon: <CompassStar className="h-5 w-5" />,
      href: undefined as string | undefined,
    },
    {
      label: "Public",
      value: String(publicCards.length),
      helper: "Listed in the gallery",
      tone: "purple" as const,
      icon: <Globe aria-hidden />,
      href: "#public-cards",
    },
    {
      label: "Drafts",
      value: String(drafts.length),
      helper: "Private, in-progress cards",
      tone: "ember" as const,
      icon: <FilePlus2 aria-hidden />,
      href: "#drafts",
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
        {stats.map((stat) => {
          const body = (
            <>
              <IconTile tone={stat.tone} size="lg">
                {stat.icon}
              </IconTile>
              <div className="flex flex-col">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                  {stat.label}
                </p>
                <p className="font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-subtle">{stat.helper}</p>
              </div>
            </>
          );

          // Public/Drafts jump to their section below; Cards is a plain stat.
          return stat.href ? (
            <Link
              key={stat.label}
              href={stat.href}
              className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <SurfaceCard className="flex h-full items-center gap-4 p-5 transition-colors group-hover:border-gold/40">
                {body}
              </SurfaceCard>
            </Link>
          ) : (
            <SurfaceCard
              key={stat.label}
              className="flex items-center gap-4 p-5"
            >
              {body}
            </SurfaceCard>
          );
        })}
      </div>

      <DashboardSelectableSections
        recentCards={recentCards}
        drafts={drafts}
        publicCards={publicCards}
        userSets={setSummaries}
      />

      <LikedCardsSection likedCards={likedCards} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Skeleton fallback for <DashboardCards>. Mirrors the stats grid + three
// section headers + 3 card placeholders per section so the layout is
// stable from the moment the shell paints.
// ---------------------------------------------------------------------------

function CreditsSummarySkeleton() {
  return (
    <SurfaceCard className="mt-6 flex flex-col gap-5 p-6">
      <div className="flex items-center gap-3">
        <Skeleton shape="circle" className="h-10 w-10" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-2.5 w-56" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <Skeleton className="h-2 w-full" />
    </SurfaceCard>
  );
}

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
