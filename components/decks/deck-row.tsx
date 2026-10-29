import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Flame } from "lucide-react";
import {
  DECK_ROW_GRID_CLASS,
  DECK_ROW_SIZES,
  DeckTile,
  DeckTileSkeleton,
  deckRowTileClass,
  type DeckTileDeck,
} from "@/components/decks/deck-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { listTrendingDecks, DECK_ROW_MAX } from "@/lib/decks/queries";
import { listDeckTileArt, type DeckTileArt } from "@/lib/decks/tile-art";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// One-row deck strips (TODO DK8.2 / DK8.3) — the card rows' shape
// (components/gallery/card-row.tsx) with DeckTile: a header, then one row
// whose tiles past the last column are hidden, never wrapped. Renders
// nothing for an empty list, so a page never shows a header over nothing.
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
}) {
  if (decks.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-heading`}>
      <div className="mb-5 flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-primary-bright">
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
      <div className={DECK_ROW_GRID_CLASS}>
        {decks.slice(0, DECK_ROW_MAX).map((deck, index) => (
          <div key={deck.id} className={cn("min-w-0 flex-col", deckRowTileClass(index))}>
            <DeckTile deck={deck} art={art.get(deck.id)} sizes={DECK_ROW_SIZES} likeRedirect={likeRedirect} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Trending now" — the week's most-liked public decks (list_trending_decks,
 *  migration 0149). Cookie-free reads only, so the /decks and /gallery
 *  landings that draw it stay ISR. Nothing liked this week: no row. */
export async function TrendingDecksRow({
  id = "trending-decks",
  eyebrow = "Trending now",
  heading = "Most liked this week",
  description,
  href,
  hrefLabel,
  likeRedirect,
}: {
  id?: string;
  eyebrow?: string;
  heading?: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  likeRedirect?: string;
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
    />
  );
}

/** The row's shape while it streams in. */
export function DeckRowSkeleton() {
  return (
    <div>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-56" />
      </div>
      <div className={DECK_ROW_GRID_CLASS}>
        {Array.from({ length: DECK_ROW_MAX }).map((_, index) => (
          <DeckTileSkeleton key={index} className={deckRowTileClass(index)} />
        ))}
      </div>
    </div>
  );
}
