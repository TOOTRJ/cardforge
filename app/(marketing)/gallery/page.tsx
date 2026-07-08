import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { GalleryFilters } from "@/components/gallery/gallery-filters";
import { FeaturedCreators } from "@/components/marketing/featured-creators";
import {
  TrendingCardsSection,
  TrendingCardsSectionSkeleton,
} from "@/components/gallery/trending-cards-section";
import { listPublicCardsRich, listTrendingCards } from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { daysLeft, getFeaturedActiveChallenge } from "@/lib/challenges/queries";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  JsonLd,
} from "@/components/seo/json-ld";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  CARD_TYPE_VALUES,
  COLOR_IDENTITY_VALUES,
  RARITY_VALUES,
  type CardType,
  type ColorIdentity,
  type Rarity,
} from "@/types/card";

export const metadata: Metadata = {
  title: "Gallery",
  description: "Browse public custom cards forged by the PipGlyph community.",
  alternates: { canonical: "/gallery" },
};

const PAGE_SIZE = 24;

type GalleryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type GallerySort = "recent" | "popular" | "viewed";

type ParsedFilters = {
  cardType: CardType | undefined;
  rarity: Rarity | undefined;
  colorIdentity: ColorIdentity | undefined;
  search: string | undefined;
  sort: GallerySort;
  remixesOnly: boolean;
  page: number;
  /** Scryfall provenance filter (Phase 11 chunk 13). When set, the
   *  gallery shows only cards imported from this Scryfall id. */
  sourceScryfallId: string | undefined;
  tag: string | undefined;
  // Raw values preserved so `buildHref` reflects exactly what the user
  // typed (rather than the post-cleanup typed values).
  raw: {
    type: string | null;
    rarity: string | null;
    color: string | null;
    q: string | null;
    sort: string | null;
    source: string | null;
    tag: string | null;
    remixes: string | null;
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
  if (filters.raw.color) qs.set("color", filters.raw.color);
  if (filters.raw.q) qs.set("q", filters.raw.q);
  if (filters.raw.sort) qs.set("sort", filters.raw.sort);
  if (filters.raw.source) qs.set("source", filters.raw.source);
  if (filters.raw.tag) qs.set("tag", filters.raw.tag);
  if (filters.raw.remixes) qs.set("remixes", filters.raw.remixes);
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
  const colorParam = firstString(params.color);
  const searchParam = firstString(params.q);
  const sortParam = firstString(params.sort);
  const pageParam = firstString(params.page);
  const sourceParam = firstString(params.source);
  const tagParam = firstString(params.tag);
  const remixesParam = firstString(params.remixes);
  const remixesOnly = remixesParam === "1";
  const tag = tagParam
    ? tagParam.toLowerCase().trim().slice(0, 30) || undefined
    : undefined;
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
  const colorIdentity = (COLOR_IDENTITY_VALUES as readonly string[]).includes(
    colorParam ?? "",
  )
    ? (colorParam as ColorIdentity)
    : undefined;
  const sort: GallerySort =
    sortParam === "popular"
      ? "popular"
      : sortParam === "viewed"
        ? "viewed"
        : "recent";

  const pageRaw = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const filters: ParsedFilters = {
    cardType,
    rarity,
    colorIdentity,
    search: searchParam ?? undefined,
    sort,
    remixesOnly,
    page,
    sourceScryfallId,
    tag,
    raw: {
      type: cardTypeParam,
      rarity: rarityParam,
      color: colorIdentity ?? null,
      q: searchParam,
      sort: sortParam,
      source: sourceScryfallId ?? null,
      tag: tag ?? null,
      remixes: remixesOnly ? "1" : null,
    },
  };

  const configured = isSupabaseConfigured();
  // When the user is actively searching/filtering, the trending hero is noise —
  // hide it so the (filtered) results are the focus, like most gallery UIs.
  const anyFilterActive =
    Boolean(
      cardType ||
        rarity ||
        colorIdentity ||
        searchParam ||
        tag ||
        remixesOnly ||
        sourceScryfallId,
    ) ||
    sort !== "recent" ||
    page > 1;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Gallery", path: "/gallery" },
        ])}
      />
      <PageHeader
        eyebrow="Public"
        title="Community gallery"
        description="Discover custom cards forged by the PipGlyph community. Filter, sort, and click into any card to view, like, or remix."
        actions={
          <Button asChild>
            <Link href="/create">Forge your own</Link>
          </Button>
        }
      />

      {/* Search + filters lead the page, like most galleries. */}
      <div className="mt-8">
        <GalleryFilters />
      </div>

      <FeaturedChallengeBanner />

      {/* Featured creators — admin-curated spotlight, unfiltered view only. */}
      {configured && !anyFilterActive ? (
        <Suspense fallback={null}>
          <FeaturedCreators />
        </Suspense>
      ) : null}

      {/* Trending hero — only on the unfiltered default view. */}
      {configured && !anyFilterActive ? (
        <div className="mt-10">
          <Suspense fallback={<TrendingCardsSectionSkeleton count={4} />}>
            <GalleryTrending />
          </Suspense>
        </div>
      ) : null}

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
            key={`${filters.raw.type ?? ""}-${filters.raw.rarity ?? ""}-${filters.raw.color ?? ""}-${filters.raw.q ?? ""}-${filters.raw.sort ?? ""}-${filters.raw.source ?? ""}-${filters.raw.tag ?? ""}-${filters.raw.remixes ?? ""}-${page}`}
            fallback={<GallerySkeletonGrid count={PAGE_SIZE} />}
          >
            <GalleryResults filters={filters} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

async function GalleryTrending() {
  const [trending, viewer] = await Promise.all([
    listTrendingCards({ limit: 4 }),
    getCurrentUser(),
  ]);
  if (trending.length === 0) return null;
  return (
    <TrendingCardsSection
      cards={trending}
      isAuthed={Boolean(viewer)}
      eyebrow="Trending now"
      heading="Hot this week"
      description="Cards picking up steam — fresh likes, comments, and remixes from the last 7 days."
      priority
    />
  );
}

async function GalleryResults({ filters }: { filters: ParsedFilters }) {
  const {
    cardType,
    rarity,
    colorIdentity,
    search,
    sort,
    remixesOnly,
    page,
    sourceScryfallId,
    tag,
  } = filters;
  const [cards, viewer] = await Promise.all([
    listPublicCardsRich({
      cardType,
      rarity,
      colorIdentity,
      search,
      sort,
      remixesOnly,
      sourceScryfallId,
      tag,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getCurrentUser(),
  ]);
  const isAuthed = Boolean(viewer);

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No cards match"
        description={
          cardType ||
          rarity ||
          colorIdentity ||
          search ||
          sourceScryfallId ||
          tag ||
          remixesOnly
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

  // ItemList only on the canonical default view — every filtered/paged
  // variant canonicalizes to /gallery, so describing a filtered slice
  // there would mislabel the page's content.
  const isCanonicalView =
    page === 1 &&
    !cardType &&
    !rarity &&
    !colorIdentity &&
    !search &&
    !sourceScryfallId &&
    !tag &&
    !remixesOnly &&
    sort === "recent";

  return (
    <>
      {isCanonicalView ? (
        <JsonLd
          data={itemListJsonLd({
            name: "Community gallery — custom MTG-style cards",
            items: cards.map((card) => ({
              name: card.title,
              path: buildCardPath(card),
            })),
          })}
        />
      ) : null}
      {tag ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs text-foreground">
          <span className="inline-flex items-center gap-2">
            Showing cards tagged <span className="font-semibold">#{tag}</span>
          </span>
          <Link
            href="/gallery"
            className="font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:text-foreground"
          >
            Clear filter
          </Link>
        </div>
      ) : null}
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
          <GalleryCardTile key={card.id} card={card} isAuthed={isAuthed} />
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

// Featured-challenge banner — renders nothing when no featured challenge is
// in its window, so the gallery is unchanged outside challenge seasons.
async function FeaturedChallengeBanner() {
  const challenge = await getFeaturedActiveChallenge();
  if (!challenge) return null;
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-gold/40 bg-surface/80 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-strong">
          Featured challenge
        </span>
        <p className="text-sm text-muted">
          <span className="font-display text-base font-semibold text-foreground">
            {challenge.title}
          </span>{" "}
          · {daysLeft(challenge)} day{daysLeft(challenge) === 1 ? "" : "s"} left
          {" — "}publish a card tagged{" "}
          <Badge variant="gold" className="align-middle">{challenge.tag}</Badge>{" "}
          to enter.
        </p>
      </div>
      <Button asChild variant="outline" className="self-start sm:self-center">
        <Link href={`/challenges/${challenge.slug}`}>View challenge</Link>
      </Button>
    </div>
  );
}
