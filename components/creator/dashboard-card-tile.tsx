"use client";

import { type MouseEvent } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { BakedCardThumbnail } from "@/components/cards/baked-card-thumbnail";
import { CardHoverEffect } from "@/components/cards/card-hover-effect";
import { cn } from "@/lib/utils";
import type { ArtPosition, FrameStyle } from "@/types/card";
import type { listMyCards } from "@/lib/cards/queries";

// ---------------------------------------------------------------------------
// DashboardCardTile — one tile on the dashboard grid that participates in
// bulk selection. Behavior:
//   - Normal mode:
//       - Plain click on the card body → navigates to the edit page
//       - Cmd / Ctrl + click → toggles selection without clearing others
//       - Shift + click → range-selects from the last-clicked card to this one
//       - The corner checkbox appears on hover / focus and toggles selection
//   - Select mode (toggled by the section's "Select" button):
//       - Plain click anywhere on the card toggles its checkmark (no navigate)
//       - Checkboxes are always visible, matching the Google Photos / iOS
//         Photos multi-select pattern
// ---------------------------------------------------------------------------

export type DashboardCard = Awaited<ReturnType<typeof listMyCards>>[number];

type Props = {
  card: DashboardCard;
  isSelected: boolean;
  /** When true, a plain click toggles selection instead of navigating, and
   *  the checkbox is always visible. */
  selectMode: boolean;
  /** A card can appear in more than one section (e.g. a public card is also
   *  a "recent" card). `viewTransitionName` must be unique in the document,
   *  so only the first-rendered instance owns the shared-element transition;
   *  duplicates would abort the transition and spam the console. */
  enableViewTransition?: boolean;
  /** Called for Cmd/Ctrl/Shift-modifier clicks (and plain clicks in select
   *  mode) on the card body, plus any click on the corner checkbox. */
  onToggle: (
    cardId: string,
    modifiers: { meta: boolean; shift: boolean },
  ) => void;
};

export function DashboardCardTile({
  card,
  isSelected,
  selectMode,
  enableViewTransition = true,
  onToggle,
}: Props) {
  const handleLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (selectMode || event.metaKey || event.ctrlKey || event.shiftKey) {
      event.preventDefault();
      onToggle(card.id, {
        meta: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
      });
    }
    // Plain click outside select mode — let the Link navigate normally.
  };

  return (
    <div className="group/tile flex flex-col gap-2">
      <div
        className={cn(
          // The selection ring sits on the outer rectangle so the
          // CardHoverEffect tilt still works without distorting it. The
          // ring transitions in/out on selection-state changes.
          "relative rounded-frame transition-[box-shadow] duration-150",
          isSelected
            ? "ring-2 ring-primary-bright ring-offset-2 ring-offset-background"
            : "",
        )}
      >
        <Link
          href={`/card/${card.slug}/edit`}
          className="group block rounded-frame focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={
            selectMode
              ? isSelected
                ? `Deselect ${card.title}`
                : `Select ${card.title}`
              : `Edit ${card.title}`
          }
          onClick={handleLinkClick}
          style={
            enableViewTransition
              ? { viewTransitionName: `card-${card.id}` }
              : undefined
          }
        >
          <CardHoverEffect>
            <BakedCardThumbnail
              renderedImageUrl={card.rendered_image_url}
              title={card.title}
              previewData={{
                title: card.title,
                cost: card.cost,
                cardType: card.card_type,
                supertype: card.supertype,
                subtypes: card.subtypes,
                rarity: card.rarity,
                colorIdentity: card.color_identity,
                rulesText: card.rules_text,
                flavorText: card.flavor_text,
                power: card.power,
                toughness: card.toughness,
                loyalty: card.loyalty,
                defense: card.defense,
                artistCredit: card.artist_credit,
                artUrl: card.art_url,
                artPosition: card.art_position as ArtPosition,
                frameStyle: card.frame_style as FrameStyle,
                setIconUrl: card.set_icon_url,
                setIconCode: card.set_icon_code,
              }}
            />
          </CardHoverEffect>
        </Link>
        {/* Corner checkbox. z-30 keeps it above CardHoverEffect's glare
            (z-20) so the tile's hover sheen never covers the click target. */}
        <button
          type="button"
          onClick={(event) => {
            // Independent of modifiers — checkbox is always a single-toggle.
            event.stopPropagation();
            onToggle(card.id, {
              meta: event.metaKey || event.ctrlKey,
              shift: event.shiftKey,
            });
          }}
          aria-pressed={isSelected}
          aria-label={isSelected ? `Deselect ${card.title}` : `Select ${card.title}`}
          className={cn(
            "absolute right-3 top-3 z-30 flex h-7 w-7 items-center justify-center rounded-md border shadow-md transition-all",
            "focus-visible:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary-bright/60",
            // Always visible when selected or in select mode; otherwise it
            // reveals on hover/focus so the grid stays clean at rest.
            isSelected || selectMode
              ? "opacity-100"
              : "opacity-0 group-hover/tile:opacity-100",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/80 bg-background/80 text-transparent hover:border-border-strong hover:text-foreground",
          )}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>{visibilityLabel(card.visibility)}</span>
        <span
          className={cn(
            "transition-opacity",
            selectMode
              ? isSelected
                ? "text-primary-bright"
                : "opacity-100"
              : "opacity-0 group-hover/tile:opacity-100",
          )}
        >
          {selectMode
            ? isSelected
              ? "Selected"
              : "Click to select"
            : "Click to edit →"}
        </span>
      </div>
    </div>
  );
}

function visibilityLabel(visibility: "private" | "unlisted" | "public"): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "unlisted":
      return "Unlisted";
    default:
      return "Private";
  }
}
