import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { CardPreview } from "@/components/cards/card-preview";
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
    set.description?.trim() || `A custom card set on CardForge.`;

  return {
    title: set.title,
    description,
    openGraph: isShareable && set.cover_url
      ? {
          title: `${set.title} · CardForge`,
          description,
          type: "article",
          url: `/set/${set.slug}`,
          images: [{ url: set.cover_url, alt: `${set.title} cover` }],
        }
      : undefined,
    twitter: isShareable && set.cover_url
      ? {
          card: "summary_large_image",
          title: `${set.title} · CardForge`,
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
  const set = isSupabaseConfigured() ? await getSetBySlugPublic(slug) : null;
  if (!set) notFound();

  const user = await getCurrentUser();
  const isOwner = Boolean(user && user.id === set.owner_id);

  const items = await listCardsInSet(set.id);
  const analytics = computeSetAnalytics(items.map((i) => i.card));

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

          {isOwner ? (
            <Button asChild>
              <Link href={`/set/${set.slug}/edit`}>
                <Pencil className="h-4 w-4" aria-hidden /> Edit set
              </Link>
            </Button>
          ) : null}
        </div>
      </SurfaceCard>

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
                    <Link href={`/set/${set.slug}/edit`}>Manage cards</Link>
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map(({ card }) => (
                <Link
                  key={card.id}
                  href={`/card/${card.slug}`}
                  className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`Open ${card.title}`}
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
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
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
