"use client";

import { type MouseEvent } from "react";
import { VISIBILITY_LABELS } from "@/types/card";
import Link from "next/link";
import { Check, Eye, Heart, Pencil } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type DashboardCard } from "@/components/creator/dashboard-card-tile";
import { formatRelativeTime } from "@/components/messages/format";
import { buildTypeLine } from "@/lib/cards/card-display";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import type { CardWithStats } from "@/lib/cards/queries";
import { buildCardPath } from "@/lib/cards/utils";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// List-view rows for My Cards. Same data + actions as the grid tiles
// (DashboardCardTile / LikedCardTile), laid out as one scannable line:
// thumbnail · title + type line · status · last edited · actions.
// ---------------------------------------------------------------------------

const ROW_CLASS =
  "flex items-center gap-3 rounded-lg border bg-surface p-2 pr-3 transition-colors";

function RowThumb({
  card,
  profileOverrides,
}: {
  card: DashboardCard | CardWithStats;
  profileOverrides: FrameProfileOverridesMap | null;
}) {
  return (
    <BakedCardThumbnail
      renderedImageUrl={card.rendered_image_url}
      renderedThumbUrl={card.rendered_thumb_url}
      title={card.title}
      previewData={cardToPreviewData(card, profileOverrides)}
      sizes="48px"
      className="shadow-none"
    />
  );
}

function typeLineOf(card: DashboardCard | CardWithStats): string {
  return buildTypeLine({
    supertype: card.supertype,
    cardType: card.card_type,
    subtypes: card.subtypes,
  });
}

/** Relative on purpose ("3h ago") — the server and the browser can land on
 *  either side of a minute boundary, hence suppressHydrationWarning. */
function EditedAt({ value, className }: { value: string; className?: string }) {
  return (
    <time
      dateTime={value}
      suppressHydrationWarning
      className={cn("shrink-0 text-xs text-subtle", className)}
    >
      {formatRelativeTime(value)}
    </time>
  );
}

type MyCardListRowProps = {
  card: DashboardCard;
  profileOverrides?: FrameProfileOverridesMap | null;
  isSelected: boolean;
  selectMode: boolean;
  /** "Remixed from …" credit, when the card is a remix. */
  caption?: React.ReactNode;
  onToggle: (
    cardId: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
};

export function MyCardListRow({
  card,
  profileOverrides = null,
  isSelected,
  selectMode,
  caption,
  onToggle,
}: MyCardListRowProps) {
  const editHref = `/card/${card.slug}/edit`;
  const viewHref = `/go/card/${card.id}`;

  const toggle = (event: MouseEvent) =>
    onToggle(card.id, {
      meta: event.metaKey || event.ctrlKey,
      shift: event.shiftKey,
    });

  return (
    <li
      // Select mode: every click in the row (links included) is a toggle,
      // matching the grid tiles. Capture phase so the links never navigate.
      onClickCapture={
        selectMode
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              toggle(event);
            }
          : undefined
      }
      className={cn(
        ROW_CLASS,
        selectMode && "cursor-pointer",
        isSelected
          ? "border-primary-bright bg-primary/10"
          : "border-border/70 hover:border-border-strong",
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-pressed={isSelected}
        aria-label={isSelected ? `Deselect ${card.title}` : `Select ${card.title}`}
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60",
          isSelected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border/80 bg-background/80 text-transparent hover:border-border-strong hover:text-foreground",
        )}
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
      </button>

      <Link
        href={viewHref}
        tabIndex={-1}
        aria-hidden
        className="block w-12 shrink-0"
      >
        <RowThumb card={card} profileOverrides={profileOverrides} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={viewHref}
          className="truncate text-sm font-semibold text-foreground hover:text-primary-bright focus-visible:outline-none focus-visible:underline"
        >
          {card.title}
        </Link>
        <span className="truncate text-xs text-muted">{typeLineOf(card)}</span>
        {caption}
      </div>

      {card.likes_count > 0 ? (
        <span
          className="hidden shrink-0 items-center gap-1 text-xs text-muted sm:inline-flex"
          aria-label={`${card.likes_count} like${card.likes_count === 1 ? "" : "s"}`}
        >
          <Heart className="h-3 w-3" aria-hidden />
          {card.likes_count}
        </span>
      ) : null}
      <Badge
        variant={card.visibility === "public" ? "primary" : "default"}
        className="hidden shrink-0 sm:inline-flex"
      >
        {VISIBILITY_LABELS[card.visibility]}
      </Badge>
      <EditedAt value={card.updated_at} className="hidden w-16 text-right md:block" />

      <div className="flex shrink-0 items-center gap-1">
        <Button asChild size="sm" variant="ghost">
          <Link href={editHref} aria-label={`Edit ${card.title}`}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Edit</span>
          </Link>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link href={viewHref} aria-label={`View ${card.title}`}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">View</span>
          </Link>
        </Button>
      </div>
    </li>
  );
}

export function LikedCardListRow({
  card,
  profileOverrides = null,
}: {
  card: CardWithStats;
  profileOverrides?: FrameProfileOverridesMap | null;
}) {
  const path = buildCardPath(card);
  return (
    <li className={cn(ROW_CLASS, "border-border/70 hover:border-border-strong")}>
      <Link href={path} tabIndex={-1} aria-hidden className="block w-12 shrink-0">
        <RowThumb card={card} profileOverrides={profileOverrides} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          href={path}
          className="truncate text-sm font-semibold text-foreground hover:text-primary-bright focus-visible:outline-none focus-visible:underline"
        >
          {card.title}
        </Link>
        <span className="truncate text-xs text-muted">{typeLineOf(card)}</span>
      </div>
      {card.owner?.username ? (
        <Link
          href={`/profile/${card.owner.username}`}
          className="hidden shrink-0 truncate font-mono text-xs text-muted transition-colors hover:text-foreground sm:block"
        >
          @{card.owner.username}
        </Link>
      ) : null}
      <QuickLikeButton
        kind="card"
        cardId={card.id}
        cardSlug={card.slug}
        ownerUsername={card.owner?.username ?? null}
        initialLiked={card.liked_by_viewer}
        initialCount={card.likes_count}
        redirectAfterLogin={path}
      />
    </li>
  );
}
