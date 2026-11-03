import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Compass, Sparkles, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BrowseSearchBox } from "@/components/browse/browse-search-box";
import { DecksSearch } from "@/components/decks/decks-search";
import { DeckFormatLinks } from "@/components/decks/deck-format-links";
import { NewDeckButton } from "@/components/decks/new-deck-provider";
import {
  COMMANDER_ROW_MAX,
  CommanderCardsSection,
  CommanderCardsSectionSkeleton,
} from "@/components/decks/commander-row";
import { DeckRowSkeleton, TrendingDecksRow } from "@/components/decks/deck-row";
import { FeaturedDeckThemes, FeaturedDeckThemesSkeleton } from "@/components/decks/featured-deck-themes";
import {
  DeckGrid,
  DECK_GRID_SIZES,
  DeckTile,
  DeckTileSkeleton,
} from "@/components/decks/deck-tile";
import { breadcrumbJsonLd, JsonLd } from "@/components/seo/json-ld";
import { listDiscoverDecks, listPublicDecks, type PublicDecksSort } from "@/lib/decks/queries";
import { DISCOVER_DECKS_MAX } from "@/lib/decks/discover";
import { discoverSeedNow } from "@/lib/cards/discover";
import { listDeckTileArt } from "@/lib/decks/tile-art";
import { listCommanderCards } from "@/lib/cards/queries";
import { randomId } from "@/lib/ids";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { isDeckFormat, type DeckFormat } from "@/types/deck";
import { firstString } from "@/lib/routing/search-params";
import { USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "@/lib/auth/usernames";
import { PageContainer } from "@/components/layout/page-container";

// ---------------------------------------------------------------------------
// The community decks browse is two routes with one result grid:
//
//   - /decks (DecksLanding) → static/ISR. Search box + browse-by-format chips
//     on top, then "Featured themed decks" (the admin's themes, migration
//     0167), "Trending now" (the week's most-liked decks, TODO DK8.2 — the
//     gallery's glowing hero block), "Cards to build around" (public
//     legendary creatures, a random sample per regeneration, DK8.4) and
//     "Discover" (a weighted shuffle of non-empty decks, 0167 — it replaced
//     "Newest public decks", which ordered by the last EDIT). Never reads
//     searchParams, so it stays on the CDN.
//   - /decks/browse (DecksBrowse) → dynamic. Search, the sort, the format
//     chips and one creator's decks (?owner=, a profile's "See all decks";
//     DK8.5) with the results; every control navigates WITHIN this route
//     (see lib/routing/browse-params.ts for why the landing can't host them).
//
// All reads are anonymous (public client, no cookies); like-state hydrates
// client-side (QuickLikeButton re-checks the session cookie at click time).
// Every tile is DeckTile (DK8.1).
// ---------------------------------------------------------------------------

const PAGE_SIZE = 24;

/** The one place search, the format filter and paging live. */
export const DECKS_BROWSE_PATH = "/decks/browse";

export type DecksViewParams = {
  page: number;
  search: string | undefined;
  format: DeckFormat | undefined;
  sort: PublicDecksSort;
  /** One creator's decks — their handle (?owner=). */
  owner: string | undefined;
};

/** A handle as profiles store it (lib/auth/usernames.ts, the 0094 rule) —
 *  anything else is no filter. */
function isOwnerHandle(value: string): boolean {
  return value.length >= USERNAME_MIN && value.length <= USERNAME_MAX && USERNAME_PATTERN.test(value);
}

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
  const ownerParam = firstString(params.owner)?.trim().toLowerCase().replace(/^@/, "");
  const owner = ownerParam && isOwnerHandle(ownerParam) ? ownerParam : undefined;
  return { page, search, format, sort, owner };
}

/** /decks/browse with these params (the defaults left out). */
export function decksBrowseHref(params: Partial<Omit<DecksViewParams, "page">> & { page?: number }): string {
  const qs = new URLSearchParams();
  if (params.search) qs.set("q", params.search);
  if (params.format) qs.set("format", params.format);
  if (params.sort && params.sort !== "recent") qs.set("sort", params.sort);
  if (params.owner) qs.set("owner", params.owner);
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  const query = qs.toString();
  return query ? `${DECKS_BROWSE_PATH}?${query}` : DECKS_BROWSE_PATH;
}

const DECKS_DESCRIPTION =
  "MTG decks rebuilt with custom cards — Commander brews, Standard ladders, and kitchen-table classics customized by PipGlyph forgers. Open one to see the real cards side by side with their proxies.";

/** /decks — the static landing. */
export function DecksLanding() {
  const configured = isSupabaseConfigured();

  return (
    <PageContainer size="wide" className="pb-12 pt-6 sm:pt-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Community decks", path: "/decks" },
        ])}
      />
      <PageHeader
        className="pb-6"
        eyebrow="Public"
        title="Community decks"
        description={DECKS_DESCRIPTION}
        actions={
          <NewDeckButton>Build a deck</NewDeckButton>
        }
      />

      {/* Search + browse-by first: a search is a navigation to the browse
          route, and the format chips are the crawlable way in. */}
      <div className="mt-6">
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

      {/* The admin's featured themes, then the week's most-liked decks —
          the two headline blocks, each its own glow — then the commanders
          to build around. Each hides itself when it has nothing to show. */}
      {configured ? (
        <div className="mt-10">
          <Suspense fallback={<FeaturedDeckThemesSkeleton />}>
            <FeaturedDeckThemes />
          </Suspense>
        </div>
      ) : null}
      {configured ? (
        <div className="mt-10">
          <Suspense fallback={<DeckRowSkeleton variant="hero" />}>
            <TrendingDecksRow
              variant="hero"
              heading="Hot this week"
              description="Public decks picking up likes in the last 7 days."
              href={`${DECKS_BROWSE_PATH}?sort=popular`}
              hrefLabel="See the most liked"
            />
          </Suspense>
        </div>
      ) : null}
      {configured ? (
        <div className="mt-12">
          <Suspense fallback={<CommanderCardsSectionSkeleton />}>
            <DecksCommanderCards />
          </Suspense>
        </div>
      ) : null}

      <section aria-labelledby="discover-decks-heading" className="mt-12 border-t border-border/40 pt-8">
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
            <Compass className="h-3.5 w-3.5" aria-hidden />
            Discover
          </span>
          <h2
            id="discover-decks-heading"
            className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
          >
            Explore community decks
          </h2>
          <p className="max-w-2xl text-sm leading-6 text-muted">
            A fresh shuffle on every visit — full decks of 10 cards or more and the ones the community likes and views turn up more often, but every deck gets its turn.
          </p>
        </div>
        <div className="mt-6">
          {!configured ? (
            <DecksOffline />
          ) : (
            <Suspense fallback={<DecksSkeletonGrid count={DISCOVER_DECKS_MAX} />}>
              <DiscoverDecks />
            </Suspense>
          )}
        </div>
      </section>
    </PageContainer>
  );
}

/** "Discover" on /decks (migration 0167, lib/decks/discover.ts): a weighted
 *  shuffle of public, non-empty decks of real creators — never an empty
 *  deck, a deck of 10+ cards and a liked or viewed one more often. A fresh
 *  seed per ISR bake (the gallery's time bucket), so the grid changes
 *  between visits and the page stays static. */
async function DiscoverDecks() {
  const decks = await listDiscoverDecks(discoverSeedNow(), DISCOVER_DECKS_MAX);
  if (decks.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No public decks yet"
        description="Be the first to publish a public deck — they'll show up here for everyone."
        action={<NewDeckButton>Build a deck</NewDeckButton>}
      />
    );
  }
  const art = await listDeckTileArt(decks, { anonymous: true });
  return (
    <>
      <DeckGrid>
        {decks.map((deck) => (
          <DeckTile key={deck.id} deck={deck} art={art.get(deck.id)} sizes={DECK_GRID_SIZES} />
        ))}
      </DeckGrid>
      <div className="mt-10 flex justify-center border-t border-border/40 pt-6">
        <Button asChild variant="outline">
          <Link href={DECKS_BROWSE_PATH}>
            Browse every deck
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </>
  );
}

/** "Cards to build around" on /decks (TODO DK8.4) — its own row: public
 *  legendary creatures, potential commanders, no admin's (0091), a fresh
 *  weighted-random sample at each ISR regeneration (a new seed every
 *  render; the page re-bakes at most every `revalidate` seconds).
 *  Cookie-free so the landing stays ISR. Each tile carries "Build around"
 *  (the New deck dialog, the card as the deck's commander) — every card
 *  here is public, so anyone may build around it (D3). */
async function DecksCommanderCards() {
  const cards = await listCommanderCards({ seed: randomId(), limit: COMMANDER_ROW_MAX, anonymous: true });
  return (
    <CommanderCardsSection
      cards={cards}
      action={
        <Link href="/gallery" className="text-sm font-medium text-primary-bright underline-offset-4 hover:underline">
          Open the gallery
        </Link>
      }
    />
  );
}

/** /decks/browse — the dynamic search + filter surface. */
export function DecksBrowse({ page, search, format, sort, owner }: DecksViewParams) {
  const configured = isSupabaseConfigured();

  return (
    <PageContainer size="wide" className="pb-12 pt-6 sm:pt-8">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Community decks", path: "/decks" },
          { name: "Browse", path: DECKS_BROWSE_PATH },
        ])}
      />
      <PageHeader
        className="pb-6"
        eyebrow="Community decks"
        title="Browse decks"
        description="Search every public deck by name or description, sort it and narrow by format."
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
      <div className="mt-6">
        <Suspense fallback={null}>
          <DecksSearch />
        </Suspense>
      </div>

      {owner ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 px-4 py-2.5 text-xs text-foreground">
          <span>
            Showing decks by{" "}
            <Link href={`/profile/${owner}`} className="font-mono font-semibold underline-offset-4 hover:underline">
              @{owner}
            </Link>
          </span>
          <Link
            href={decksBrowseHref({ search, format, sort })}
            className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
            Every creator
          </Link>
        </div>
      ) : null}

      <div className="mt-6">
        {!configured ? (
          <DecksOffline />
        ) : (
          <Suspense
            key={`${search ?? ""}-${format ?? ""}-${sort}-${owner ?? ""}-${page}`}
            fallback={<DecksSkeletonGrid count={PAGE_SIZE} />}
          >
            <PublicDecksResults
              page={page}
              search={search}
              format={format}
              sort={sort}
              owner={owner}
            />
          </Suspense>
        )}
      </div>

      {configured ? (
        <Suspense fallback={null}>
          <DeckFormatLinks current={format} />
        </Suspense>
      ) : null}
    </PageContainer>
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
  owner,
}: {
  page: number;
  search?: string;
  format?: DeckFormat;
  sort: PublicDecksSort;
  owner?: string;
}) {
  // Anonymous mode (public client, no cookie read) keeps the landing
  // ISR-cacheable. liked_by_viewer is false on the cached page; the
  // QuickLikeButton re-checks the session cookie at click time.
  // One row past the page: it says whether a next page exists. "A full page"
  // alone sent a list of exactly 24, 48… decks to an empty page.
  const fetched = await listPublicDecks({
    limit: PAGE_SIZE + 1,
    offset: (page - 1) * PAGE_SIZE,
    search,
    format,
    sort,
    ownerUsername: owner,
    anonymous: true,
  });
  const decks = fetched.slice(0, PAGE_SIZE);
  const filtered = Boolean(search || format || owner);

  if (decks.length === 0) {
    return (
      <EmptyState
        icon={BookOpen}
        title={filtered ? "No decks match" : "No public decks yet"}
        description={
          owner && !search && !format
            ? `@${owner} has no public decks yet.`
            : filtered
              ? "Try a different search or format, or be the first to publish a deck that matches."
              : "Be the first to publish a public deck — they'll show up here for everyone."
        }
        action={
          <NewDeckButton>Build a deck</NewDeckButton>
        }
      />
    );
  }

  const hasMore = fetched.length > PAGE_SIZE;
  const hasPrev = page > 1;
  // Page links stay within the browse route — the landing is static and
  // would ignore (and, via proxy.ts, 308 away from) the query.
  const pageHref = (p: number) => decksBrowseHref({ search, format, sort, owner, page: p });
  // Each deck's colours (its default cover's pick, its pips) and fan — the
  // same answers its own page reads (lib/decks/tile-art.ts).
  const art = await listDeckTileArt(decks, { anonymous: true });

  return (
    <>
      <DeckGrid>
        {decks.map((deck) => (
          <DeckTile key={deck.id} deck={deck} art={art.get(deck.id)} sizes={DECK_GRID_SIZES} />
        ))}
      </DeckGrid>
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

function DecksSkeletonGrid({ count }: { count: number }) {
  return (
    <DeckGrid>
      {Array.from({ length: count }).map((_, i) => (
        <DeckTileSkeleton key={i} />
      ))}
    </DeckGrid>
  );
}
