import Link from "next/link";
import { Crown } from "lucide-react";
import { CardTile } from "@/components/cards/card-tile";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { BuildDeckAroundButton } from "@/components/decks/build-deck-around-button";
import { SECTION_EYEBROW_CLASS, TRENDING_HERO_SURFACE_CLASS } from "@/components/gallery/trending-cards-section";
import { Skeleton } from "@/components/ui/skeleton";
import { buildCardPath } from "@/lib/cards/utils";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import type { CardWithStats } from "@/lib/cards/queries";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// "Cards to build around" on /decks (TODO DK8.4) — its OWN row, no longer the
// trending cards: public legendary creatures (potential commanders), a fresh
// weighted-random sample at each ISR regeneration (listCommanderCards,
// migration 0157). It wears the "Trending now" block's glow
// (TRENDING_HERO_SURFACE_CLASS — the gallery's and the home page's), with
// SMALLER tiles than a card row so more fit and the row stands lower:
//
//   row width   < 36rem   36–48rem   48–60rem   60–76rem   76–92rem   ≥ 92rem
//   columns         3          4          5          6          7          8
//
// (390 px phone 3 × 97, 1366 px window 7 × 167, 1920 8 × 214 — never past
// the 600 px thumbnail.) ONE row, always: tiles past the last column are
// hidden, never wrapped (the card rows' rule). Each tile is a CardTile (its
// link opens the card; a two-faced card keeps its "2 faces" button outside
// the link) with the author and "Build around" — the New deck dialog with
// the card as the deck's first entry, its commander — UNDER it, siblings of
// the link, never inside it. Every card here is public, so anyone may build
// around it (D3).
// ---------------------------------------------------------------------------

/** Fetch this many; the CSS shows as many as the row's columns. */
export const COMMANDER_ROW_MAX = 8;

export const COMMANDER_ROW_GRID_CLASS =
  "grid grid-cols-3 gap-3 @min-[36rem]:grid-cols-4 @min-[48rem]:grid-cols-5 @min-[60rem]:grid-cols-6 @min-[76rem]:grid-cols-7 @min-[92rem]:grid-cols-8";

/** Visibility class for the tile at `index` — matches the grid's steps. */
export function commanderRowTileClass(index: number): string {
  if (index >= 7) return "hidden @min-[92rem]:flex";
  if (index >= 6) return "hidden @min-[76rem]:flex";
  if (index >= 5) return "hidden @min-[60rem]:flex";
  if (index >= 4) return "hidden @min-[48rem]:flex";
  if (index >= 3) return "hidden @min-[36rem]:flex";
  return "flex";
}

/** The tile's `sizes` on /decks: the WIDE page frame (16 / 24 / 32 px
 *  gutters, 1920 px cap) less the glowing surface's padding (20 / 28 px
 *  from 640 px) and its 1 px border — what a tile measures at every window
 *  width, never less (tests/unit/components/card-grid.test.ts). Window
 *  steps 682 (4) / 874 (5) / 1082 (6) / 1338 (7) / 1594 (8) / 1920 (cap). */
export const COMMANDER_ROW_SIZES =
  "(min-width: 1920px) 215px, (min-width: 1594px) calc((100vw - 206px) / 8), (min-width: 1338px) calc((100vw - 194px) / 7), (min-width: 1082px) calc((100vw - 182px) / 6), (min-width: 1024px) calc((100vw - 170px) / 5), (min-width: 874px) calc((100vw - 154px) / 5), (min-width: 682px) calc((100vw - 142px) / 4), (min-width: 640px) calc((100vw - 130px) / 3), calc((100vw - 98px) / 3)";

const HEADING_ID = "commander-row-heading";

export function CommanderCardsSection({
  cards,
  action,
}: {
  cards: CardWithStats[];
  /** Right-aligned slot — "Open the gallery". */
  action?: React.ReactNode;
}) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby={HEADING_ID} className={TRENDING_HERO_SURFACE_CLASS}>
      <CommanderRowHeader action={action} />
      <div className="@container">
        <ul className={COMMANDER_ROW_GRID_CLASS}>
          {cards.slice(0, COMMANDER_ROW_MAX).map((card, index) => (
            <li key={card.id} className={cn("min-w-0 flex-col gap-1.5", commanderRowTileClass(index))}>
              <CardTile
                body={(slot) => <Link href={buildCardPath(card)} aria-label={`Open ${card.title}`} {...slot} />}
                thumbnail={{
                  renderedImageUrl: card.rendered_image_url,
                  renderedThumbUrl: card.rendered_thumb_url,
                  renderedBackThumbUrl: card.rendered_back_thumb_url,
                  title: card.title,
                  previewData: cardToPreviewData(card, null),
                  sizes: COMMANDER_ROW_SIZES,
                }}
              />
              {card.owner?.username ? (
                <Link
                  href={`/profile/${card.owner.username}`}
                  className="truncate font-mono text-[11px] text-muted transition-colors hover:text-foreground"
                >
                  @{card.owner.username}
                </Link>
              ) : null}
              <BuildDeckAroundButton
                cardId={card.id}
                cardTitle={card.title}
                short
                className="h-auto min-h-9 w-full whitespace-normal px-2 py-1.5 text-xs"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CommanderRowHeader({ action }: { action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
      <div className="flex flex-col gap-1.5">
        <span className={cn(SECTION_EYEBROW_CLASS, "text-gold-strong")}>
          <Crown className="h-3.5 w-3.5" aria-hidden />
          Potential commanders
        </span>
        <h2 id={HEADING_ID} className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Cards to build around
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Legendary creatures from the community, a fresh handful every few minutes — start a Commander deck
          around one, or open it to add it to a deck you have.
        </p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

/** The row's shape while it streams in. */
export function CommanderCardsSectionSkeleton() {
  return (
    <section aria-busy="true" className={TRENDING_HERO_SURFACE_CLASS}>
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-64" />
      </div>
      <div className="@container">
        <div className={COMMANDER_ROW_GRID_CLASS}>
          {Array.from({ length: COMMANDER_ROW_MAX }).map((_, i) => (
            <div key={i} className={cn("flex-col gap-1.5", commanderRowTileClass(i))}>
              <CardPreviewSkeleton />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
