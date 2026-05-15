import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, PackageOpen, Pencil } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SetAnalyticsPanel } from "@/components/sets/set-analytics-panel";
import {
  getSetBySlugPublic,
  listCardsInSet,
} from "@/lib/sets/queries";
import { computeSetAnalytics } from "@/lib/sets/analytics";
import { buildCardPath } from "@/lib/cards/utils";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { ArtPosition, FrameStyle } from "@/types/card";
import { Layers } from "lucide-react";

type Params = { slug: string };

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ""))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isSupabaseConfigured()) {
    return { title: titleFromSlug(slug) };
  }
  const set = await getSetBySlugPublic(slug);
  if (!set) return { title: titleFromSlug(slug) };

  const isShareable = set.visibility === "public" || set.visibility === "unlisted";
  const description =
    set.description?.trim() || `A custom card set on Spellwright.`;

  return {
    title: set.title,
    description,
    openGraph: isShareable && set.cover_url
      ? {
          title: `${set.title} · Spellwright`,
          description,
          type: "article",
          url: `/set/${set.slug}`,
          images: [{ url: set.cover_url, alt: `${set.title} cover` }],
        }
      : undefined,
    twitter: isShareable && set.cover_url
      ? {
          card: "summary_large_image",
          title: `${set.title} · Spellwright`,
          description,
          images: [set.cover_url],
        }
      : undefined,
  };
}

export default async function SetDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  // Set + auth are needed to render the header / owner chip — keep them on
  // the page shell. The expensive `listCardsInSet` + analytics live behind
  // a Suspense boundary so the cover + title paint immediately.
  const [set, user] = await Promise.all([
    isSupabaseConfigured() ? getSetBySlugPublic(slug) : null,
    getCurrentUser(),
  ]);
  if (!set) notFound();

  const isOwner = Boolean(user && user.id === set.owner_id);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <Link
        href="/gallery"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to gallery
      </Link>

      {/* Cover + header */}
      <SurfaceCard className="overflow-hidden p-0">
        <div className="relative aspect-[5/2] w-full overflow-hidden bg-elevated">
          {set.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={set.cover_url}
              alt={`${set.title} cover`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-elevated via-surface to-background">
              <Layers className="h-12 w-12 text-subtle" aria-hidden />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4 p-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={set.visibility === "public" ? "primary" : "outline"}>
                {visibilityLabel(set.visibility)}
              </Badge>
              {set.owner?.username ? (
                <Link
                  href={`/profile/${set.owner.username}`}
                  className="text-xs text-muted transition-colors hover:text-foreground"
                >
                  by{" "}
                  <span className="font-mono text-foreground">
                    @{set.owner.username}
                  </span>
                </Link>
              ) : null}
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {set.title}
            </h1>
            {set.description ? (
              <p className="max-w-2xl text-sm leading-6 text-muted">
                {set.description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {items.length > 0 ? (
              <Button asChild variant="outline">
                <Link href={`/set/${set.slug}/booster`}>
                  <PackageOpen className="h-4 w-4" aria-hidden /> Open booster
                </Link>
              </Button>
            ) : null}
            {isOwner ? (
              <Button asChild>
                <Link href={`/set/${set.slug}/edit`}>
                  <Pencil className="h-4 w-4" aria-hidden /> Edit set
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </SurfaceCard>

      <Suspense fallback={<SetBodySkeleton />}>
        <SetBody
          setId={set.id}
          setSlug={set.slug}
          ownerUsername={set.owner?.username ?? null}
          isOwner={isOwner}
        />
      </Suspense>
    </div>
  );
}

async function SetBody({
  setId,
  setSlug,
  ownerUsername,
  isOwner,
}: {
  setId: string;
  setSlug: string;
  ownerUsername: string | null;
  isOwner: boolean;
}) {
  const items = await listCardsInSet(setId);
  const analytics = computeSetAnalytics(items.map((i) => i.card));

  return (
    <>
      <section className="mt-10">
        <PageHeader
          eyebrow="Analytics"
          title="Set breakdown"
          description="Real-time counts and average cost across the cards in this set."
        />
        <div className="mt-6">
          <SetAnalyticsPanel analytics={analytics} />
        </div>
      </section>

      <section className="mt-12">
        <PageHeader
          eyebrow="Cards"
          title={`${items.length} card${items.length === 1 ? "" : "s"}`}
          description="Click any card to view it in full."
        />

        <div className="mt-6">
          {items.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No cards yet"
              description={
                isOwner
                  ? "Add cards from the set editor to start filling it out."
                  : "This set is empty for now."
              }
              action={
                isOwner ? (
                  <Button asChild>
                    <Link href={`/set/${setSlug}/edit`}>Manage cards</Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map(({ card }) => (
                <Link
                  key={card.id}
                  href={buildCardPath({
                    slug: card.slug,
                    owner: { username: ownerUsername },
                  })}
                  className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`Open ${card.title}`}
                  style={{ viewTransitionName: `card-${card.id}` }}
                >
                  <CardHoverEffect>
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
                  </CardHoverEffect>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function SetBodySkeleton() {
  return (
    <>
      <section className="mt-10">
        <header className="mb-6">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Set breakdown
          </h2>
        </header>
        <SurfaceCard className="p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section className="mt-12">
        <header className="mb-6">
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            Cards
          </h2>
        </header>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <CardPreviewSkeleton key={i} />
          ))}
        </div>
      </section>
    </>
  );
}

function visibilityLabel(visibility: string): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
