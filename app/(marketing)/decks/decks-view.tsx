import Link from "next/link";
import Image from "next/image";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SurfaceCard } from "@/components/ui/surface-card";
import { Badge } from "@/components/ui/badge";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { BrowseSearchBox } from "@/components/browse/browse-search-box";
import { DecksSearch } from "@/components/decks/decks-search";
import { DeckFormatLinks } from "@/components/decks/deck-format-links";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import { listPublicDecks, type PublicDecksSort } from "@/lib/decks/queries";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  DECK_FORMAT_LABELS,
  coverObjectPosition,
  isDeckFormat,
  type DeckFormat,
} from "@/types/deck";
import { firstString } from "@/lib/routing/search-params";

// ---------------------------------------------------------------------------
// The community decks browse is two routes with one result grid:
//
//   - /decks (DecksLanding) → static/ISR. Search box + browse-by-format chips
//     on top, then the newest public decks. Never reads searchParams, so it
//     stays on the CDN.
//   - /decks/browse (DecksBrowse) → dynamic. Search + format chips and the
//     results; every search/filter/page control navigates WITHIN this route
//     (see lib/routing/browse-params.ts for why the landing can't host them).
//
// All reads are anonymous (public client, no cookies); like-state hydrates
// client-side (QuickLikeButton re-checks the session cookie at click time).
// ---------------------------------------------------------------------------

const PAGE_SIZE = 24;

/** The one place search, the format filter and paging live. */
export const DECKS_BROWSE_PATH = "/decks/browse";

const FRAME = "mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8";

export type DecksViewParams = {
  page: number;
  search: string | undefined;
  format: DeckFormat | undefined;
  sort: PublicDecksSort;
};

export function parseDecksParams(
  params: Record<string, string | string[] | undefined>,
): DecksViewParams {
  const pageParam = firstString(params.page);
  const pageRaw = Number.parseInt(pageParam ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const search = firstString(params.q)?.trim() || undefined;
  const formatParam = firstString(params.format);
  const format = isDeckFormat(formatParam) ? formatParam : undefined;
  const sortParam = firstString(params.sort);
  const sort: PublicDecksSort =
    sortParam === "popular" || sortParam === "viewed" ? sortParam : "recent";
  return { page, search, format, sort };
}

const DECKS_DESCRIPTION =
  "MTG decks rebuilt with custom cards — Commander brews, Standard ladders, and kitchen-table classics remixed by PipGlyph forgers. Open one to see the originals side by side with their proxies.";

/** /decks — the static landing. */
export function DecksLanding() {
  const configured = isSupabaseConfigured();

  return (
    <div className={FRAME}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Community decks", path: "/decks" },
        ])}
      />
      <PageHeader
        eyebrow="Public"
        title="Community decks"
        description={DECKS_DESCRIPTION}
        actions={
          <Button asChild>
            <Link href="/dashboard/decks/new">Build a deck</Link>
          </Button>
        }
      />

      {/* Search + browse-by first: a search is a navigation to the browse
          route, and the format chips are the crawlable way in. */}
      <div className="mt-8">
        <BrowseSearchBox
          browsePath={DECKS_BROWSE_PATH}
          placeholder="Search decks by name or description"
          label="Search decks"
          browseLabel="Browse all decks"
        />
      </div>
      {configured ? (
        <Suspense fallback={null}>
          <DeckFormatLinks placement="top" />
        </Suspense>
      ) : null}

      <div className="mt-10 flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Newest public decks
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          The latest builds published by the community.
        </p>
      </div>
      <div className="mt-6">
        {!configured ? (
          <DecksOffline />
        ) : (
          <Suspense fallback={<DecksSkeletonGrid count={PAGE_SIZE} />}>
            <PublicDecksResults page={1} sort="recent" />
          </Suspense>
        )}
      </div>
    </div>
  );
}

/** /decks/browse — the dynamic search + filter surface. */
export function DecksBrowse({ page, search, format, sort }: DecksViewParams) {
  const configured = isSupabaseConfigured();

  return (
    <div className={FRAME}>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Community decks", path: "/decks" },
          { name: "Browse", path: DECKS_BROWSE_PATH },
        ])}
      />
      <PageHeader
        eyebrow="Community decks"
        title="Browse decks"
        description="Search every public deck by name or description and narrow by format."
        actions={
          <Button asChild variant="outline">
            <Link href="/decks">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to decks
            </Link>
          </Button>
        }
      />

      {/* The Suspense boundary contains DecksSearch's useSearchParams() CSR
          bailout so the shell still server-renders. */}
      <div className="mt-8">
        <Suspense fallback={null}>
          <DecksSearch />
        </Suspense>
      </div>

      <div className="mt-8">
        {!configured ? (
          <DecksOffline />
        ) : (
          <Suspense
            key={`${search ?? ""}-${format ?? ""}-${sort}-${page}`}
            fallback={<DecksSkeletonGrid count={PAGE_SIZE} />}
          >
            <PublicDecksResults
              page={page}
              search={search}
              format={format}
              sort={sort}
            />
          </Suspense>
        )}
      </div>

      {configured ? (
        <Suspense fallback={null}>
          <DeckFormatLinks current={format} />
        </Suspense>
      ) : null}
    </div>
  );
}

function DecksOffline() {
  return (
    <EmptyState
      icon={Sparkles}
      title="Decks are offline"
      description="Supabase isn't configured for this deployment. The decks browse will populate once env vars land."
    />
  );
}

async function PublicDecksResults({
  page,
  search,
  format,
  sort,
}: {
  page: number;
  search?: string;
  format?: DeckFormat;
  sort: PublicDecksSort;
}) {
  // Anonymous mode (public client, no cookie read) keeps the landing
  // ISR-cacheable. liked_by_viewer is false on the cached page; the
  // QuickLikeButton re-checks the session cookie at click time.
  const decks = await listPublicDecks({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    search,
    format,
    sort,
    anonymous: true,
  });

  if (decks.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title={search || format ? "No decks match" : "No public decks yet"}
        description={
          search || format
            ? "Try a different search or format, or be the first to publish a deck that matches."
            : "Be the first to publish a public deck — they'll show up here for everyone."
        }
        action={
          <Button asChild>
            <Link href="/dashboard/decks/new">Build a deck</Link>
          </Button>
        }
      />
    );
  }

  const hasMore = decks.length === PAGE_SIZE;
  const hasPrev = page > 1;
  // Page links stay within the browse route — the landing is static and
  // would ignore (and, via proxy.ts, 308 away from) the query.
  const pageHref = (p: number) => {
    const parts = [
      search ? `q=${encodeURIComponent(search)}` : "",
      format ? `format=${format}` : "",
      sort !== "recent" ? `sort=${sort}` : "",
      p > 1 ? `page=${p}` : "",
    ].filter(Boolean);
    return parts.length ? `${DECKS_BROWSE_PATH}?${parts.join("&")}` : DECKS_BROWSE_PATH;
  };

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {decks.map((deck) => (
          <PublicDeckTile key={deck.id} deck={deck} />
        ))}
      </div>
      {hasPrev || hasMore ? (
        <div className="mt-10 flex items-center justify-between gap-3 border-t border-border/40 pt-6">
          <span className="text-xs text-subtle">Page {page}</span>
          <div className="flex items-center gap-2">
            {hasPrev ? (
              <Button asChild variant="outline" size="sm">
                <Link href={pageHref(page - 1)} scroll>
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  Previous
                </Link>
              </Button>
            ) : null}
            {hasMore ? (
              <Button asChild size="sm">
                <Link href={pageHref(page + 1)} scroll>
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

export function PublicDeckTile({
  deck,
}: {
  deck: Awaited<ReturnType<typeof listPublicDecks>>[number];
}) {
  const ownerLabel =
    deck.owner?.display_name?.trim() ||
    deck.owner?.username ||
    "Anonymous forger";
  const remixPct =
    deck.cards_count > 0
      ? Math.round((deck.remixed_count / deck.cards_count) * 100)
      : 0;

  // Avoid nesting <a> inside <a> (invalid HTML): the cover + title/description
  // are wrapped in one Link, then the owner chip is a sibling Link below.
  return (
    <SurfaceCard className="flex h-full flex-col gap-0 overflow-hidden p-0 transition-colors hover:border-border-strong">
      <Link
        href={`/deck/${deck.slug}`}
        className="group flex flex-1 flex-col rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Open ${deck.title}`}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-elevated">
          {deck.cover_url ? (
            <Image
              src={deck.cover_url}
              alt={`${deck.title} — custom card deck cover`}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform group-hover:scale-[1.03]"
              style={{
                objectPosition: coverObjectPosition(deck.cover_position),
              }}
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-linear-to-br from-elevated via-surface to-background">
              <BookOpen className="h-10 w-10 text-subtle" aria-hidden />
            </div>
          )}
          <div className="absolute left-3 top-3">
            <Badge variant="outline" className="bg-background/70 backdrop-blur">
              {DECK_FORMAT_LABELS[deck.format]}
            </Badge>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-5 pb-3">
          <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
            {deck.title}
          </h3>
          {deck.description ? (
            <p className="line-clamp-2 text-sm leading-6 text-muted">
              {deck.description}
            </p>
          ) : null}
          {deck.cards_count > 0 ? (
            <div className="mt-auto flex items-center gap-2 text-[11px] text-subtle">
              <div
                className="h-1 flex-1 overflow-hidden rounded-full bg-elevated"
                role="progressbar"
                aria-valuenow={remixPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Proxy progress"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${remixPct}%` }}
                />
              </div>
              <span className="shrink-0">{remixPct}% proxied</span>
            </div>
          ) : null}
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-5 py-3 text-xs">
        {deck.owner?.username ? (
          <Link
            href={`/profile/${deck.owner.username}`}
            className="truncate font-mono text-muted transition-colors hover:text-foreground"
          >
            @{deck.owner.username}
          </Link>
        ) : (
          <span className="truncate text-muted">{ownerLabel}</span>
        )}
        <div className="flex items-center gap-3 text-muted">
          <span>
            {deck.cards_count} card{deck.cards_count === 1 ? "" : "s"}
          </span>
          <QuickLikeButton
            kind="deck"
            deckId={deck.id}
            deckSlug={deck.slug}
            ownerUsername={deck.owner?.username ?? null}
            initialLiked={deck.liked_by_viewer}
            initialCount={deck.likes_count}
            requiresSignIn
            redirectAfterLogin="/decks"
          />
        </div>
      </div>
    </SurfaceCard>
  );
}

function DecksSkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SurfaceCard key={i} className="flex flex-col gap-0 overflow-hidden p-0">
          <Skeleton className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </SurfaceCard>
      ))}
    </div>
  );
}
