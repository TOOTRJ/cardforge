"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { QuickLikeButton } from "@/components/cards/quick-like-button";
import { buildCardPath } from "@/lib/cards/utils";
import type { CardWithStats } from "@/lib/cards/queries";
import { cardToPreviewData } from "@/lib/cards/preview-data";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// LikedCardTile — one card the current user has liked, on the My Cards
// "Liked" tab. Read-only (the user doesn't own it) with a QuickLikeButton so
// they can unlike from here. Distinct from DashboardCardTile because the
// actions differ: no edit, and the only bulk action is "Print / download"
// (TODO 6.15) — so it takes part in selection the same way (`selection`):
// the corner checkbox, Cmd/Ctrl/Shift-click, and in select mode a plain
// click toggles instead of opening the card.
// ---------------------------------------------------------------------------

export type LikedCardSelection = {
  isSelected: boolean;
  selectMode: boolean;
  onToggle: (cardId: string, modifiers: { meta: boolean; shift: boolean }) => void;
};

export function LikedCardTile({
  card,
  profileOverrides = null,
  selection,
}: {
  card: CardWithStats;
  profileOverrides?: FrameProfileOverridesMap | null;
  selection?: LikedCardSelection;
}) {
  const ownerLabel =
    card.owner?.username ?? card.owner?.display_name ?? "Anonymous forger";
  const selected = selection?.isSelected ?? false;
  const selectMode = selection?.selectMode ?? false;

  return (
    <div className="group/tile flex flex-col gap-2">
      <div
        className={cn(
          "relative card-corners transition-[box-shadow] duration-150",
          selected && "ring-2 ring-primary-bright ring-offset-2 ring-offset-background",
        )}
      >
        <Link
          href={buildCardPath(card)}
          className="block card-corners focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={selectMode ? `${selected ? "Deselect" : "Select"} ${card.title}` : `Open ${card.title}`}
          onClick={
            selection
              ? (event) => {
                  const modified = event.metaKey || event.ctrlKey || event.shiftKey;
                  if (!selectMode && !modified) return;
                  event.preventDefault();
                  selection.onToggle(card.id, {
                    meta: event.metaKey || event.ctrlKey,
                    shift: event.shiftKey,
                  });
                }
              : undefined
          }
        >
          <CardHoverEffect>
            <BakedCardThumbnail
              renderedImageUrl={card.rendered_image_url}
              renderedThumbUrl={card.rendered_thumb_url}
              renderedBackThumbUrl={card.rendered_back_thumb_url}
              title={card.title}
              previewData={cardToPreviewData(card, profileOverrides)}
            />
          </CardHoverEffect>
        </Link>
        {selection ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              selection.onToggle(card.id, {
                meta: event.metaKey || event.ctrlKey,
                shift: event.shiftKey,
              });
            }}
            aria-pressed={selected}
            aria-label={selected ? `Deselect ${card.title}` : `Select ${card.title}`}
            className={cn(
              "absolute right-3 top-3 z-40 flex h-7 w-7 items-center justify-center rounded-md border shadow-md transition-all",
              "focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-bright/60",
              selected || selectMode ? "opacity-100" : "opacity-0 group-hover/tile:opacity-100",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border/80 bg-background/80 text-transparent hover:border-border-strong hover:text-foreground",
            )}
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
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
        <QuickLikeButton
          kind="card"
          cardId={card.id}
          cardSlug={card.slug}
          ownerUsername={card.owner?.username ?? null}
          initialLiked={card.liked_by_viewer}
          initialCount={card.likes_count}
          redirectAfterLogin={buildCardPath(card)}
        />
      </div>
    </div>
  );
}
