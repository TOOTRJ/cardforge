import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, FolderOpen, Globe2, Pencil, UserCog } from "lucide-react";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreview } from "@/components/cards/card-preview";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/server";
import { listMyCards } from "@/lib/cards/queries";
import type { ArtPosition, FrameStyle } from "@/types/card";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your CardForge workspace.",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const profile = await getCurrentProfile();
  const greetingName =
    profile?.display_name ||
    profile?.username ||
    user?.email?.split("@")[0] ||
    "Forgemaster";
  const profileIncomplete = !profile?.username;

  const myCards = await listMyCards();
  const recentCards = myCards.slice(0, 6);
  const drafts = myCards.filter((c) => c.visibility === "private");
  const publicCards = myCards.filter((c) => c.visibility === "public");

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
        description="Click any card to open the editor."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link href="/gallery">View gallery</Link>
          </Button>
        }
      >
        {recentCards.length === 0 ? (
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
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentCards.map((card) => (
              <CardLink key={card.id} card={card} />
            ))}
          </div>
        )}
      </DashboardSection>

      <DashboardSection
        title="Drafts"
        description="Private, in-progress cards you haven't published."
      >
        {drafts.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="No drafts"
            description="Drafts you save while creating will live here until you publish."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.slice(0, 6).map((card) => (
              <CardLink key={card.id} card={card} />
            ))}
          </div>
        )}
      </DashboardSection>

      <DashboardSection
        title="Public cards"
        description="Cards visible on your public profile and the gallery."
      >
        {publicCards.length === 0 ? (
          <EmptyState
            icon={Globe2}
            title="Nothing public yet"
            description="Toggle a card's visibility to Public from the editor and it will appear here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {publicCards.slice(0, 6).map((card) => (
              <CardLink key={card.id} card={card} />
            ))}
          </div>
        )}
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

function CardLink({
  card,
}: {
  card: Awaited<ReturnType<typeof listMyCards>>[number];
}) {
  return (
    <Link
      href={`/card/${card.slug}/edit`}
      className="group block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      aria-label={`Edit ${card.title}`}
    >
      <CardPreview
        title={card.title}
        cost={card.cost}
        cardType={card.card_type}
        supertype={card.supertype}
        subtypes={card.subtypes}
        rarity={card.rarity}
        colorIdentity={card.color_identity}
        rulesText={card.rules_text}
        flavorText={card.flavor_text}
        power={card.power}
        toughness={card.toughness}
        loyalty={card.loyalty}
        defense={card.defense}
        artistCredit={card.artist_credit}
        artUrl={card.art_url}
        artPosition={card.art_position as ArtPosition}
        frameStyle={card.frame_style as FrameStyle}
      />
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>{visibilityLabel(card.visibility)}</span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          Click to edit →
        </span>
      </div>
    </Link>
  );
}

function visibilityLabel(visibility: "private" | "unlisted" | "public"): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
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
