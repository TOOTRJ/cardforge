import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Flame, Heart } from "lucide-react";
import { CARD_GRID_SIZES } from "@/components/cards/card-grid";
import { ROW_GRID_CLASS, ROW_MAX, rowTileClass } from "@/components/gallery/card-row";
import {
  DeckGrid,
  DECK_ROW_SIZES,
  DeckTile,
  DeckTileSkeleton,
  deckRowTileClass,
  type DeckTileDeck,
} from "@/components/decks/deck-tile";
import { SECTION_EYEBROW_CLASS, TRENDING_HERO_SURFACE_CLASS } from "@/components/gallery/trending-cards-section";
import { TrendingRangeSwitch } from "@/components/gallery/trending-range-switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listTrendingDecksByRange,
  DECK_ROW_MAX,
  type DeckTrendingStats,
  type TrendingDeckListing,
} from "@/lib/decks/queries";
import {
  DEFAULT_DECK_TRENDING_RANGE,
  TRENDING_RANGE_WORDS,
  TRENDING_RANGES,
  trendingOpeningOrder,
  type TrendingRange,
} from "@/lib/cards/trending";
import { listDeckTileArt, type DeckTileArt } from "@/lib/decks/tile-art";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// One-row deck strips (TODO DK8.2 / DK8.3) — the card rows' shape
// (components/gallery/card-row.tsx) with DeckTile: a header, then one row
// whose tiles past the last column are hidden, never wrapped. Renders
// nothing for an empty list, so a page never shows a header over nothing.
// /decks' headline trending block is TrendingDecksRanges (owner 2026-11-03 /
// 2026-11-04): the gallery's glowing surface (TRENDING_HERO_SURFACE_CLASS),
// its Week / Month / Year / All time switch and its rules — never a copy of
// any of them — with a rank badge on each tile. Both open on the YEAR (owner
// 2026-11-05, DK8.9: DEFAULT_DECK_TRENDING_RANGE; the cards keep the month).
// The gallery's own decks row (TrendingDecksRow) stays plain — no switch, no
// glow — and COMPACT: the card rows' columns (2 – 6 across, ROW_GRID_CLASS)
// of DeckTile size="compact".
// ---------------------------------------------------------------------------

export function DeckRowSection({
  id,
  icon: Icon,
  eyebrow,
  heading,
  description,
  href,
  hrefLabel,
  decks,
  art,
  likeRedirect,
  compact = false,
}: {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  heading: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  decks: readonly DeckTileDeck[];
  art: ReadonlyMap<string, DeckTileArt>;
  likeRedirect?: string;
  /** The card rows' shape (DK8.9): 2 – 6 compact tiles across the wide
   *  frame instead of 1 – 4 full ones. */
  compact?: boolean;
}) {
  if (decks.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-5 flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <span className={cn(SECTION_EYEBROW_CLASS, "text-primary-bright")}>
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {eyebrow}
          </span>
          <h2 id={`${id}-heading`} className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {heading}
          </h2>
          {description ? <p className="max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="text-sm font-medium text-primary-bright underline-offset-4 hover:underline">
            {hrefLabel ?? "See all"}
          </Link>
        ) : null}
      </div>
      {compact ? (
        <CompactDeckGrid>
          {decks.slice(0, ROW_MAX).map((deck, index) => (
            <div key={deck.id} className={cn("min-w-0 flex-col", rowTileClass(index))}>
              <DeckTile
                deck={deck}
                art={art.get(deck.id)}
                size="compact"
                sizes={CARD_GRID_SIZES}
                likeRedirect={likeRedirect}
              />
            </div>
          ))}
        </CompactDeckGrid>
      ) : (
        <DeckGrid>
          {decks.slice(0, DECK_ROW_MAX).map((deck, index) => (
            <div key={deck.id} className={cn("min-w-0 flex-col", deckRowTileClass(index))}>
              <DeckTile deck={deck} art={art.get(deck.id)} sizes={DECK_ROW_SIZES} likeRedirect={likeRedirect} />
            </div>
          ))}
        </DeckGrid>
      )}
    </section>
  );
}

/** The card rows' grid (ROW_GRID_CLASS: 2 / 3 / 4 / 5 / 6 columns by the
 *  row's width) in its own query container — the compact deck row. Its
 *  tiles are a card tile's width, so their `sizes` are CARD_GRID_SIZES
 *  (tests/unit/components/card-grid.test.ts). */
function CompactDeckGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container">
      <div className={ROW_GRID_CLASS}>{children}</div>
    </div>
  );
}

/** The trending hero's place badge — the gallery trending tile's look. Over the
 *  tile's cover and click-through (no pointer events), so the tile's one
 *  link still takes the click; read before the tile by a screen reader. */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="pointer-events-none absolute left-3 top-3 z-20 inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-gold/50 bg-background/85 px-2 font-display text-xs font-semibold text-gold-strong shadow backdrop-blur">
      <span className="sr-only">Trending rank </span>#{rank}
    </span>
  );
}

/** The gallery's "Trending decks" row — the most-liked public decks of real
 *  creators (listTrendingDecksByRange: migration 0167's
 *  list_trending_decks_by_range, the gallery's rules), COMPACT (DK8.9) and
 *  opening on the YEAR (DEFAULT_DECK_TRENDING_RANGE), else the next range
 *  with decks (trendingOpeningOrder) — so the row isn't empty while the
 *  switch on /decks could show decks. The description is told which period
 *  it ended up on. Cookie-free reads only, so the landing that draws it
 *  stays ISR. Nothing liked in any range: no row. */
export async function TrendingDecksRow({
  id = "trending-decks",
  eyebrow = "Trending now",
  heading = "Trending decks",
  description,
  href,
  hrefLabel,
  likeRedirect,
}: {
  id?: string;
  eyebrow?: string;
  heading?: string;
  /** Told the period the row opened on ("this year"). */
  description?: (period: string) => string;
  href?: string;
  hrefLabel?: string;
  likeRedirect?: string;
}) {
  const byRange = await listTrendingDecksByRange({ limit: ROW_MAX });
  const opening = trendingOpeningOrder(DEFAULT_DECK_TRENDING_RANGE).find((range) => byRange[range].length > 0);
  if (!opening) return null;
  const decks = byRange[opening];
  const art = await listDeckTileArt(decks, { anonymous: true });
  return (
    <DeckRowSection
      id={id}
      icon={Flame}
      eyebrow={eyebrow}
      heading={heading}
      description={description?.(TRENDING_RANGE_WORDS[opening].period)}
      href={href}
      hrefLabel={hrefLabel}
      decks={decks}
      art={art}
      likeRedirect={likeRedirect}
      compact
    />
  );
}

/** The order /decks' switch opens in: the year (owner 2026-11-05 — a deck is
 *  liked far less often than a card; the cards open on the month), else the
 *  next range with decks, longer first — so the hero is never an empty box
 *  while another range has decks. */
const OPENING_ORDER: readonly TrendingRange[] = trendingOpeningOrder(DEFAULT_DECK_TRENDING_RANGE);

/** What an empty range says (the gallery's words are about cards). */
const EMPTY_RANGE_WORDS: Record<TrendingRange, string> = {
  week: "No deck has been liked this week yet.",
  month: "No deck has been liked this month yet.",
  year: "No deck has been liked this year yet.",
  all: "No deck has been liked yet.",
};

/** /decks' headline trending block: the gallery's hero surface and its
 *  Week / Month / Year / All time switch (TrendingRangeSwitch) over four
 *  rows the SERVER renders — one cached read set at the ISR bake, so the
 *  landing never reads searchParams. Nothing liked in any range: no block. */
export async function TrendingDecksRanges({
  id = "trending-decks",
  likeRedirect,
  browseHref,
}: {
  id?: string;
  likeRedirect?: string;
  /** Where an empty range points ("browse every deck"). */
  browseHref: string;
}) {
  const byRange = await listTrendingDecksByRange({ limit: DECK_ROW_MAX });
  const opening = OPENING_ORDER.find((range) => byRange[range].length > 0);
  if (!opening) return null;
  // ONE tile-art read for every deck the four rows show.
  const unique = new Map<string, TrendingDeckListing>();
  for (const range of TRENDING_RANGES) for (const deck of byRange[range]) unique.set(deck.id, deck);
  const art = await listDeckTileArt(Array.from(unique.values()), { anonymous: true });
  const panels = Object.fromEntries(
    TRENDING_RANGES.map((range) => [
      range,
      byRange[range].length > 0 ? (
        <RankedDeckRow decks={byRange[range]} art={art} likeRedirect={likeRedirect} />
      ) : (
        <p className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted">
          {EMPTY_RANGE_WORDS[range]} Try a longer period, or{" "}
          <Link href={browseHref} className="text-primary-bright underline-offset-4 hover:underline">
            browse every deck
          </Link>
          .
        </p>
      ),
    ]),
  ) as Record<TrendingRange, React.ReactNode>;
  return (
    <section aria-labelledby={`${id}-heading`} className={TRENDING_HERO_SURFACE_CLASS}>
      <TrendingRangeSwitch
        headingId={`${id}-heading`}
        defaultRange={opening}
        eyebrow={
          <span className={cn(SECTION_EYEBROW_CLASS, "text-gold-strong")}>
            <Flame className="h-3.5 w-3.5 animate-pulse motion-reduce:animate-none" aria-hidden />
            Trending now
          </span>
        }
        descriptions={DECK_TRENDING_DESCRIPTIONS}
        panels={panels}
      />
    </section>
  );
}

/** The line under the heading per range — the gallery's, for a deck's one
 *  event (a like). All time has no decay, so it doesn't say "recent". */
const DECK_TRENDING_DESCRIPTIONS: Record<TrendingRange, string> = {
  week: "Ranked by the community's likes — the most recent count most.",
  month: "Ranked by the community's likes — the most recent count most.",
  year: "Ranked by the community's likes — the most recent count most.",
  all: "Ranked by every like from the community — old and new count the same.",
};

/** One range's row: rank badges and the range's likes under each tile. */
function RankedDeckRow({
  decks,
  art,
  likeRedirect,
}: {
  decks: readonly TrendingDeckListing[];
  art: ReadonlyMap<string, DeckTileArt>;
  likeRedirect?: string;
}) {
  return (
    <DeckGrid>
      {decks.slice(0, DECK_ROW_MAX).map((deck, index) => (
        <div key={deck.id} className={cn("relative flex min-w-0 flex-col gap-2", deckRowTileClass(index))}>
          <RankBadge rank={index + 1} />
          <DeckTile deck={deck} art={art.get(deck.id)} sizes={DECK_ROW_SIZES} likeRedirect={likeRedirect} />
          <TrendingDeckStats stats={deck.trending} />
        </div>
      ))}
    </DeckGrid>
  );
}

/** "♥ 3 this month" — the gallery tile's stats line, a deck's one event. */
function TrendingDeckStats({ stats }: { stats: DeckTrendingStats }) {
  if (stats.likes <= 0) return null;
  const period = TRENDING_RANGE_WORDS[stats.range].period;
  const label = `${stats.likes} ${stats.likes === 1 ? "like" : "likes"} ${period}`;
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted" title={label}>
      <Heart className="h-3 w-3 text-gold" aria-hidden />
      <span className="tabular-nums">{stats.likes}</span>
      <span className="sr-only">{stats.likes === 1 ? "like" : "likes"}</span>
      <span className="text-subtle">{period}</span>
    </span>
  );
}

/** The row's shape while it streams in. "compact" = the gallery's decks row. */
export function DeckRowSkeleton({ variant = "plain" }: { variant?: "plain" | "hero" | "compact" }) {
  return (
    <div className={cn(variant === "hero" && TRENDING_HERO_SURFACE_CLASS)}>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-56" />
      </div>
      {variant === "compact" ? (
        <CompactDeckGrid>
          {Array.from({ length: ROW_MAX }).map((_, index) => (
            <DeckTileSkeleton key={index} size="compact" className={rowTileClass(index)} />
          ))}
        </CompactDeckGrid>
      ) : (
        <DeckGrid>
          {Array.from({ length: DECK_ROW_MAX }).map((_, index) => (
            <DeckTileSkeleton key={index} className={deckRowTileClass(index)} />
          ))}
        </DeckGrid>
      )}
    </div>
  );
}
