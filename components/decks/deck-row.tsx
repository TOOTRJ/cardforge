import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Flame } from "lucide-react";
import {
  DeckGrid,
  DECK_ROW_SIZES,
  DeckTile,
  DeckTileSkeleton,
  deckRowTileClass,
  type DeckTileDeck,
} from "@/components/decks/deck-tile";
import { SECTION_EYEBROW_CLASS, TRENDING_HERO_SURFACE_CLASS } from "@/components/gallery/trending-cards-section";
import { Skeleton } from "@/components/ui/skeleton";
import { listTrendingDecks, DECK_ROW_MAX } from "@/lib/decks/queries";
import { listDeckTileArt, type DeckTileArt } from "@/lib/decks/tile-art";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// One-row deck strips (TODO DK8.2 / DK8.3) — the card rows' shape
// (components/gallery/card-row.tsx) with DeckTile: a header, then one row
// whose tiles past the last column are hidden, never wrapped. Renders
// nothing for an empty list, so a page never shows a header over nothing.
// The "hero" variant is /decks' headline trending block (owner 2026-11-03:
// it stands out like the gallery's) — the gallery's glowing surface
// (TRENDING_HERO_SURFACE_CLASS, never a copy), a gold eyebrow and a rank
// badge on each tile; the gallery's own decks row stays plain.
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
  variant = "plain",
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
  variant?: "plain" | "hero";
}) {
  if (decks.length === 0) return null;
  const hero = variant === "hero";
  return (
    <section aria-labelledby={`${id}-heading`} className={cn(hero && TRENDING_HERO_SURFACE_CLASS)}>
      <div className={cn("flex flex-col items-start justify-between gap-3 md:flex-row md:items-end", hero ? "mb-6" : "mb-5")}>
        <div className={cn("flex flex-col", hero ? "gap-1.5" : "gap-1")}>
          <span className={cn(SECTION_EYEBROW_CLASS, hero ? "text-gold-strong" : "text-primary-bright")}>
            <Icon className={cn("h-3.5 w-3.5", hero && "animate-pulse motion-reduce:animate-none")} aria-hidden />
            {eyebrow}
          </span>
          <h2
            id={`${id}-heading`}
            className={cn(
              "font-display font-semibold tracking-tight text-foreground",
              hero ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl",
            )}
          >
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
      <DeckGrid>
        {decks.slice(0, DECK_ROW_MAX).map((deck, index) => (
          <div key={deck.id} className={cn("relative min-w-0 flex-col", deckRowTileClass(index))}>
            {hero ? <RankBadge rank={index + 1} /> : null}
            <DeckTile deck={deck} art={art.get(deck.id)} sizes={DECK_ROW_SIZES} likeRedirect={likeRedirect} />
          </div>
        ))}
      </DeckGrid>
    </section>
  );
}

/** The hero row's place badge — the gallery trending tile's look. Over the
 *  tile's cover and click-through (no pointer events), so the tile's one
 *  link still takes the click; read before the tile by a screen reader. */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="pointer-events-none absolute left-3 top-3 z-20 inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-gold/50 bg-background/85 px-2 font-display text-xs font-semibold text-gold-strong shadow backdrop-blur">
      <span className="sr-only">Trending rank </span>#{rank}
    </span>
  );
}

/** "Trending now" — the week's most-liked public decks of real creators
 *  (list_trending_decks, migration 0149: no admin-owned deck, no throwaway
 *  account's). Cookie-free reads only, so the /decks and /gallery
 *  landings that draw it stay ISR. Nothing liked this week: no row. */
export async function TrendingDecksRow({
  id = "trending-decks",
  eyebrow = "Trending now",
  heading = "Most liked this week",
  description,
  href,
  hrefLabel,
  likeRedirect,
  variant,
}: {
  id?: string;
  eyebrow?: string;
  heading?: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  likeRedirect?: string;
  variant?: "plain" | "hero";
}) {
  const decks = await listTrendingDecks(DECK_ROW_MAX);
  if (decks.length === 0) return null;
  const art = await listDeckTileArt(decks, { anonymous: true });
  return (
    <DeckRowSection
      id={id}
      icon={Flame}
      eyebrow={eyebrow}
      heading={heading}
      description={description}
      href={href}
      hrefLabel={hrefLabel}
      decks={decks}
      art={art}
      likeRedirect={likeRedirect}
      variant={variant}
    />
  );
}

/** The row's shape while it streams in. */
export function DeckRowSkeleton({ variant = "plain" }: { variant?: "plain" | "hero" }) {
  return (
    <div className={cn(variant === "hero" && TRENDING_HERO_SURFACE_CLASS)}>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-56" />
      </div>
      <DeckGrid>
        {Array.from({ length: DECK_ROW_MAX }).map((_, index) => (
          <DeckTileSkeleton key={index} className={deckRowTileClass(index)} />
        ))}
      </DeckGrid>
    </div>
  );
}
