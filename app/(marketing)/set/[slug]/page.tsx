import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, PackageOpen, Pencil } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
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
import { getSiteBaseUrl } from "@/lib/site-url";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  JsonLd,
} from "@/components/seo/json-ld";
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
    set.description?.trim() || `A custom card set on PipGlyph.`;

  // og:image comes from the sibling opengraph-image.tsx file route (which
  // embeds the cover when one exists and falls back to a branded card) —
  // file-convention images take precedence over any set here anyway.
  return {
    title: set.title,
    description,
    // Unlisted sets are reachable by link but shouldn't enter the index.
    robots:
      set.visibility !== "public" ? { index: false, follow: false } : undefined,
    alternates: { canonical: `/set/${set.slug}` },
    openGraph: isShareable
      ? {
          title: `${set.title} · PipGlyph`,
          description,
          type: "article",
          url: `/set/${set.slug}`,
        }
      : undefined,
    twitter: isShareable
      ? {
          card: "summary_large_image",
          title: `${set.title} · PipGlyph`,
          description,
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
  const isPublic = set.visibility === "public";

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Structured data only for indexable (public) sets — unlisted pages
          are noindex, so schema there is dead weight. */}
      {isPublic ? (
        <>
          <JsonLd
            data={breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: "Community sets", path: "/sets" },
              { name: set.title, path: `/set/${set.slug}` },
            ])}
          />
          <JsonLd
            data={buildSetCollectionJsonLd({
              title: set.title,
              description: set.description,
              slug: set.slug,
              ownerUsername: set.owner?.username ?? null,
              ownerDisplay:
                set.owner?.display_name || set.owner?.username || null,
            })}
          />
        </>
      ) : null}
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
            {/* Always exposed in the header; the booster page renders an
                empty-state when the set has no cards yet. */}
            <Button asChild variant="outline">
              <Link href={`/set/${set.slug}/booster`}>
                <PackageOpen className="h-4 w-4" aria-hidden /> Open booster
              </Link>
            </Button>
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
          setTitle={set.title}
          ownerUsername={set.owner?.username ?? null}
          isOwner={isOwner}
          emitJsonLd={isPublic}
        />
      </Suspense>
    </div>
  );
}

async function SetBody({
  setId,
  setSlug,
  setTitle,
  ownerUsername,
  isOwner,
  emitJsonLd,
}: {
  setId: string;
  setSlug: string;
  setTitle: string;
  ownerUsername: string | null;
  isOwner: boolean;
  emitJsonLd: boolean;
}) {
  const items = await listCardsInSet(setId);
  const analytics = computeSetAnalytics(items.map((i) => i.card));

  return (
    <>
      {emitJsonLd && items.length > 0 ? (
        <JsonLd
          data={itemListJsonLd({
            name: `${setTitle} — cards in this set`,
            items: items.map(({ card }) => ({
              name: card.title,
              path: buildCardPath({
                slug: card.slug,
                owner: { username: ownerUsername },
              }),
            })),
          })}
        />
      ) : null}
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
                  className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`Open ${card.title}`}
                  style={{ viewTransitionName: `card-${card.id}` }}
                >
                  <CardHoverEffect>
                    <BakedCardThumbnail
                      renderedImageUrl={card.rendered_image_url}
                      title={card.title}
                      previewData={{
                        title: card.title,
                        cost: card.cost,
                        cardType: card.card_type,
                        supertype: card.supertype,
                        subtypes: card.subtypes,
                        rarity: card.rarity,
                        colorIdentity: card.color_identity,
                        rulesText: card.rules_text,
                        flavorText: card.flavor_text,
                        power: card.power,
                        toughness: card.toughness,
                        loyalty: card.loyalty,
                        defense: card.defense,
                        artistCredit: card.artist_credit,
                        artUrl: card.art_url,
                        artPosition: card.art_position as ArtPosition,
                        frameStyle: card.frame_style as FrameStyle,
                        setIconUrl: card.set_icon_url,
                        setIconCode: card.set_icon_code,
                      }}
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

// ---------------------------------------------------------------------------
// CollectionPage JSON-LD — tells search engines this page is a curated
// collection authored by a community member, distinct from the site-level
// WebSite/Organization graph in the root layout.
// ---------------------------------------------------------------------------

function buildSetCollectionJsonLd({
  title,
  description,
  slug,
  ownerUsername,
  ownerDisplay,
}: {
  title: string;
  description: string | null;
  slug: string;
  ownerUsername: string | null;
  ownerDisplay: string | null;
}): Record<string, unknown> {
  const base = getSiteBaseUrl();
  const canonical = `${base}/set/${slug}`;
  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    description:
      description?.trim() || "A custom card set on PipGlyph.",
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "PipGlyph", url: base },
  };
  if (ownerDisplay) {
    schema.author = {
      "@type": "Person",
      name: ownerDisplay,
      ...(ownerUsername
        ? { url: `${base}/profile/${ownerUsername}` }
        : {}),
    };
  }
  return schema;
}
