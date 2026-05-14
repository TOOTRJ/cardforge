import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Heart, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreview } from "@/components/cards/card-preview";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GalleryFilters } from "@/components/gallery/gallery-filters";
import { listPublicCardsRich } from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  CARD_TYPE_VALUES,
  RARITY_VALUES,
  type ArtPosition,
  type CardType,
  type FrameStyle,
  type Rarity,
} from "@/types/card";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Browse public custom cards forged by the CardForge community.",
  alternates: { canonical: "/gallery" },
};

const PAGE_SIZE = 24;

type GalleryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type ParsedFilters = {
  cardType: CardType | undefined;
  rarity: Rarity | undefined;
  search: string | undefined;
  sort: "recent" | "popular";
  page: number;
  /** Scryfall provenance filter (Phase 11 chunk 13). When set, the
   *  gallery shows only cards imported from this Scryfall id. */
  sourceScryfallId: string | undefined;
  // Raw values preserved so `buildHref` reflects exactly what the user
  // typed (rather than the post-cleanup typed values).
  raw: {
    type: string | null;
    rarity: string | null;
    q: string | null;
    sort: string | null;
    source: string | null;
  };
};

function firstString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function buildHref(filters: ParsedFilters, nextPage: number): string {
  const qs = new URLSearchParams();
  if (filters.raw.type) qs.set("type", filters.raw.type);
  if (filters.raw.rarity) qs.set("rarity", filters.raw.rarity);
  if (filters.raw.q) qs.set("q", filters.raw.q);
  if (filters.raw.sort) qs.set("sort", filters.raw.sort);
  if (filters.raw.source) qs.set("source", filters.raw.source);
  if (nextPage > 1) qs.set("page", String(nextPage));
  const query = qs.toString();
  return query ? `/gallery?${query}` : "/gallery";
}

export default async function GalleryPage({ searchParams }: GalleryPageProps) {
  // Param parsing is synchronous + fast, so it stays on the page shell.
  // The expensive bit (listPublicCardsRich) lives behind a <Suspense> in
  // <GalleryResults> so the page can paint skeletons immediately.
  const params = await searchParams;
  const cardTypeParam = firstString(params.type);
  const rarityParam = firstString(params.rarity);
  const searchParam = firstString(params.q);
  const sortParam = firstString(params.sort);
  const pageParam = firstString(params.page);
  const sourceParam = firstString(params.source);
  // UUID-format check on the source filter. Scryfall ids are UUIDs;
  // anything else (e.g. a probe with `?source=' OR 1=1`) is silently
  // ignored. Same posture as the cardType/rarity guards above.
  const SCRYFALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const sourceScryfallId =
    sourceParam && SCRYFALL_ID_PATTERN.test(sourceParam)
      ? sourceParam
      : undefined;

  const cardType = (CARD_TYPE_VALUES as readonly string[]).includes(
    cardTypeParam ?? "",
  )
    ? (cardTypeParam as CardType)
    : undefined;
  const rarity = (RARITY_VALUES as readonly string[]).includes(
    rarityParam ?? "",
  )
    ? (rarityParam as Rarity)
    : undefined;
  const sort: "recent" | "popular" =
    sortParam === "popular" ? "popular" : "recent";

  const pageRaw = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const filters: ParsedFilters = {
    cardType,
    rarity,
    search: searchParam ?? undefined,
    sort,
    page,
    sourceScryfallId,
    raw: {
      type: cardTypeParam,
      rarity: rarityParam,
      q: searchParam,
      sort: sortParam,
      source: sourceScryfallId ?? null,
    },
  };

  const configured = isSupabaseConfigured();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Public"
        title="Community gallery"
        description="Discover custom cards forged by the CardForge community. Filter, sort, and click into any card to view, like, or remix."
        actions={
          <Button asChild>
            <Link href="/create">Forge your own</Link>
          </Button>
        }
      />

      <div className="mt-8">
        <GalleryFilters />
      </div>

      <div className="mt-10">
        {!configured ? (
          <EmptyState
            icon={Sparkles}
            title="Gallery is offline"
            description="Supabase isn't configured for this deployment. The gallery will populate once env vars land."
          />
        ) : (
          // Suspense + skeleton fallback while the server query runs. The
          // page shell (header + filters) is sent ahead of the streamed
          // results, so users see a populated frame immediately.
          // The key forces Suspense to re-suspend when filters change so
          // the skeletons reappear during the new fetch instead of holding
          // the previous result.
          <Suspense
            key={`${filters.raw.type ?? ""}-${filters.raw.rarity ?? ""}-${filters.raw.q ?? ""}-${filters.raw.sort ?? ""}-${filters.raw.source ?? ""}-${page}`}
            fallback={<GallerySkeletonGrid count={PAGE_SIZE} />}
          >
            <GalleryResults filters={filters} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

async function GalleryResults({ filters }: { filters: ParsedFilters }) {
  const { cardType, rarity, search, sort, page, sourceScryfallId } = filters;
  const cards = await listPublicCardsRich({
    cardType,
    rarity,
    search,
    sort,
    sourceScryfallId,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No cards match"
        description={
          cardType || rarity || search || sourceScryfallId
            ? "Try clearing the filters above, or be the first to publish a card that matches."
            : "Be the first to publish a public card — it'll show up here for everyone."
        }
        action={
          <Button asChild>
            <Link href="/create">Forge your own</Link>
          </Button>
        }
      />
    );
  }

  // hasMore is a heuristic: a full page strongly suggests there's at least
  // one more. The Next button disappears once we return < PAGE_SIZE rows.
  const hasMore = cards.length === PAGE_SIZE;
  const hasPrev = page > 1;

  return (
    <>
      {sourceScryfallId ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/10 px-4 py-2.5 text-xs text-foreground">
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
            Showing remixes of a single Scryfall card.
          </span>
          <Link
            href="/gallery"
            className="font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:text-foreground"
          >
            Clear filter
          </Link>
        </div>
      ) : null}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <GalleryCardTile key={card.id} card={card} />
        ))}
      </div>
      {hasPrev || hasMore ? (
        <div className="mt-10 flex items-center justify-between gap-3 border-t border-border/40 pt-6">
          <span className="text-xs text-subtle">Page {page}</span>
          <div className="flex items-center gap-2">
            {hasPrev ? (
              <Button asChild variant="outline" size="sm">
                <Link href={buildHref(filters, page - 1)} scroll>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Previous
                </Link>
              </Button>
            ) : null}
            {hasMore ? (
              <Button asChild size="sm">
                <Link href={buildHref(filters, page + 1)} scroll>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function GalleryCardTile({
  card,
}: {
  card: Awaited<ReturnType<typeof listPublicCardsRich>>[number];
}) {
  const ownerLabel =
    card.owner?.username ?? card.owner?.display_name ?? "Anonymous forger";

  return (
    <div className="flex flex-col gap-2">
      <Link
        href={buildCardPath(card)}
        className="block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${card.title}`}
        // view-transition-name lets chromium-class browsers pair this
        // thumbnail with the matching hero element on the detail page for
        // a shared-element animation. Unique per card so multiple grid
        // cells don't collide.
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
      <div className="flex items-center justify-between gap-2 text-xs">
        {card.owner?.username ? (
          <Link
            href={`/profile/${card.owner.username}`}
            className="truncate font-mono text-muted transition-colors hover:text-foreground"
          >
            @{card.owner.username}
          </Link>
        ) : (
          <span className="truncate text-muted">{ownerLabel}</span>
        )}
        <span className="inline-flex items-center gap-1 text-muted">
          <Heart className="h-3 w-3" aria-hidden />
          {card.likes_count}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton fallback — shape-matches the grid + a single tile's metadata
// row so the layout doesn't shift when real cards stream in.
// ---------------------------------------------------------------------------

function GallerySkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <CardPreviewSkeleton />
          <div className="flex items-center justify-between gap-2 text-xs">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-8" />
          </div>
        </div>
      ))}
    </div>
  );
}
