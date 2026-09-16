import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { GalleryCardTile } from "@/components/cards/gallery-card-tile";
import { CardPreviewSkeleton } from "@/components/cards/card-preview-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CardWithStats } from "@/lib/cards/queries";

// ---------------------------------------------------------------------------
// One-row card strips. The grid shows 2 / 3 / 4 / 5 columns as the viewport
// grows and the tiles past the last column are hidden (never wrapped), so
// a phone sees two cards and a desktop five — the row never becomes two.
// Fetch ROW_MAX cards; the CSS decides how many are visible.
// ---------------------------------------------------------------------------

export const ROW_MAX = 5;
export const ROW_GRID_CLASS = "grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5";

/** Visibility class for the tile at `index` — matches ROW_GRID_CLASS. */
export function rowTileClass(index: number): string {
  if (index >= 4) return "hidden xl:flex";
  if (index >= 3) return "hidden lg:flex";
  if (index >= 2) return "hidden sm:flex";
  return "flex";
}

export function CardRowSection({
  id,
  icon: Icon,
  eyebrow,
  heading,
  description,
  href,
  hrefLabel,
  cards,
  isAuthed,
}: {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  heading: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  cards: CardWithStats[];
  isAuthed: boolean;
}) {
  if (cards.length === 0) return null;
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
          <Link
            href={href}
            className="text-sm font-medium text-primary-bright underline-offset-4 hover:underline"
          >
            {hrefLabel ?? "See all"}
          </Link>
        ) : null}
      </div>
      <div className={ROW_GRID_CLASS}>
        {cards.slice(0, ROW_MAX).map((card, index) => (
          <div key={card.id} className={cn("flex-col", rowTileClass(index))}>
            <GalleryCardTile card={card} isAuthed={isAuthed} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function CardRowSkeleton() {
  return (
    <section aria-busy="true">
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-48" />
      </div>
      <div className={ROW_GRID_CLASS}>
        {Array.from({ length: ROW_MAX }).map((_, i) => (
          <div key={i} className={cn("flex-col gap-2", rowTileClass(i))}>
            <CardPreviewSkeleton />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
    </section>
  );
}
